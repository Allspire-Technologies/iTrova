import { supabase } from "@/integrations/supabase/client";
import {
  bumpAttempt, listQueuedSales, markSaleFailed, markSaleSyncing, moveToReview, removeQueuedSale,
  bumpPaymentAttempt, listQueuedPayments, markPaymentFailed, markPaymentSyncing, movePaymentToReview, removeQueuedPayment,
  bumpInvoiceAttempt, listQueuedInvoices, markInvoiceFailed, markInvoiceSyncing, removeQueuedInvoice,
} from "./offlineStore";
import type { QueuedInvoice, QueuedPayment, QueuedSale } from "./offlineTypes";

// Drains the offline sale queue through the idempotent commit_offline_sale RPC. Serial (one sale at
// a time, oldest first) so a flaky connection can't stampede, and a single in-flight guard so two
// triggers (reconnect + "Sync now") don't double-drain.

export type SyncOutcome =
  | { saleId: string; result: "committed" | "duplicate" }
  | { saleId: string; result: "review"; reason: string }
  | { saleId: string; result: "transient"; error: string };

/** Server-rejected for stock -> review; anything else (network/auth/5xx) -> transient (retry later). */
export function classifyError(message: string | undefined): "review" | "transient" {
  return message?.includes("NEEDS_REVIEW") ? "review" : "transient";
}

function toPayload(s: QueuedSale) {
  return {
    sale_id: s.saleId,
    invoice_id: s.invoiceId,
    invoice_number: s.invoiceNumber,
    business_id: s.businessId,
    staff_id: s.staffId,
    created_at: s.createdAt,
    payment_method: s.paymentMethod,
    payments: s.payments ?? null, // per-method breakdown; RPC falls back to payment_method when null
    discount: s.discount,
    subtotal: s.subtotal,
    tax: s.tax ?? 0, // sales queued before offline VAT shipped default to 0
    total: s.total,
    customer_name: s.customerName,
    customer_phone: s.customerPhone ?? null,
    customer_email: s.customerEmail ?? null,
    notes: s.notes ?? null,
    items: s.items.map((i) => ({ product_id: i.product_id, name: i.name, quantity: i.quantity, unit_price: i.unit_price })),
  };
}

export async function syncOne(sale: QueuedSale): Promise<SyncOutcome> {
  await markSaleSyncing(sale.saleId);
  await bumpAttempt(sale.saleId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await supabase.rpc("commit_offline_sale" as any, { _sale: toPayload(sale) });
  if (error) {
    if (classifyError(error.message) === "review") {
      const reason = error.message.split("NEEDS_REVIEW:")[1]?.trim() || "Insufficient stock";
      await moveToReview(sale.saleId, reason);
      return { saleId: sale.saleId, result: "review", reason };
    }
    await markSaleFailed(sale.saleId, error.message);
    return { saleId: sale.saleId, result: "transient", error: error.message };
  }
  await removeQueuedSale(sale.saleId);
  const status = (data as { status?: string } | null)?.status === "duplicate" ? "duplicate" : "committed";
  return { saleId: sale.saleId, result: status };
}

let draining = false;

export interface DrainOpts {
  /** Skip sales that have already failed this many times (auto-drain only; "Sync now" omits it). */
  maxAttempts?: number;
  onOutcome?: (o: SyncOutcome) => void;
}

export async function drainQueue(businessId: string, opts: DrainOpts = {}): Promise<SyncOutcome[]> {
  if (draining) return [];
  draining = true;
  const outcomes: SyncOutcome[] = [];
  try {
    for (const sale of await listQueuedSales(businessId)) {
      if (opts.maxAttempts != null && sale.attempts >= opts.maxAttempts) continue; // give up auto-retrying
      const outcome = await syncOne(sale);
      outcomes.push(outcome);
      opts.onOutcome?.(outcome);
      if (outcome.result === "transient") break; // connection likely dropped — resume on next trigger
    }
  } finally {
    draining = false;
  }
  return outcomes;
}

// ---- offline deposits: replay queued payments through record_invoice_payment ----
// Same shape as the sale drain: serial, idempotent on paymentId, NEEDS_REVIEW -> hold for review.

function paymentArgs(p: QueuedPayment) {
  return { _payment_id: p.paymentId, _invoice_id: p.invoiceId, _amount: p.amount, _method: p.method, _note: p.note };
}

export async function syncOnePayment(payment: QueuedPayment): Promise<SyncOutcome> {
  await markPaymentSyncing(payment.paymentId);
  await bumpPaymentAttempt(payment.paymentId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await supabase.rpc("record_invoice_payment" as any, paymentArgs(payment));
  if (error) {
    if (classifyError(error.message) === "review") {
      const reason = error.message.split("NEEDS_REVIEW:")[1]?.trim() || "Balance changed";
      await movePaymentToReview(payment.paymentId, reason);
      return { saleId: payment.paymentId, result: "review", reason };
    }
    await markPaymentFailed(payment.paymentId, error.message);
    return { saleId: payment.paymentId, result: "transient", error: error.message };
  }
  await removeQueuedPayment(payment.paymentId);
  const status = (data as { status?: string } | null)?.status === "duplicate" ? "duplicate" : "committed";
  return { saleId: payment.paymentId, result: status };
}

let drainingPayments = false;

export async function drainPayments(businessId: string, opts: DrainOpts = {}): Promise<SyncOutcome[]> {
  if (drainingPayments) return [];
  drainingPayments = true;
  const outcomes: SyncOutcome[] = [];
  try {
    for (const payment of await listQueuedPayments(businessId)) {
      if (opts.maxAttempts != null && payment.attempts >= opts.maxAttempts) continue;
      const outcome = await syncOnePayment(payment);
      outcomes.push(outcome);
      opts.onOutcome?.(outcome);
      if (outcome.result === "transient") break;
    }
  } finally {
    drainingPayments = false;
  }
  return outcomes;
}

// ---- offline manual invoices: replay through commit_offline_invoice ----------

function invoiceArgs(inv: QueuedInvoice) {
  return {
    invoice_id: inv.invoiceId,
    business_id: inv.businessId,
    invoice_number: inv.invoiceNumber,
    customer_name: inv.customerName,
    customer_phone: inv.customerPhone,
    customer_email: inv.customerEmail,
    due_date: inv.dueDate,
    notes: inv.notes,
    created_at: inv.createdAt,
    subtotal: inv.subtotal,
    total: inv.total,
    items: inv.items.map((i) => ({ description: i.description, quantity: i.quantity, unit_price: i.unit_price })),
  };
}

export async function syncOneInvoice(invoice: QueuedInvoice): Promise<SyncOutcome> {
  await markInvoiceSyncing(invoice.invoiceId);
  await bumpInvoiceAttempt(invoice.invoiceId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await supabase.rpc("commit_offline_invoice" as any, { _invoice: invoiceArgs(invoice) });
  if (error) {
    await markInvoiceFailed(invoice.invoiceId, error.message);
    return { saleId: invoice.invoiceId, result: "transient", error: error.message };
  }
  await removeQueuedInvoice(invoice.invoiceId);
  const status = (data as { status?: string } | null)?.status === "duplicate" ? "duplicate" : "committed";
  return { saleId: invoice.invoiceId, result: status };
}

let drainingInvoices = false;

export async function drainInvoices(businessId: string, opts: DrainOpts = {}): Promise<SyncOutcome[]> {
  if (drainingInvoices) return [];
  drainingInvoices = true;
  const outcomes: SyncOutcome[] = [];
  try {
    for (const invoice of await listQueuedInvoices(businessId)) {
      if (opts.maxAttempts != null && invoice.attempts >= opts.maxAttempts) continue;
      const outcome = await syncOneInvoice(invoice);
      outcomes.push(outcome);
      opts.onOutcome?.(outcome);
      if (outcome.result === "transient") break;
    }
  } finally {
    drainingInvoices = false;
  }
  return outcomes;
}

/**
 * Sync all offline invoicing work for a business. Invoices commit FIRST so the deposits that
 * reference them (record_invoice_payment needs the invoice to exist) replay against real rows.
 */
export async function drainInvoicing(businessId: string, opts: DrainOpts = {}): Promise<SyncOutcome[]> {
  const invoices = await drainInvoices(businessId, opts);
  // If an invoice couldn't sync, hold its deposits too — they'd just NEEDS_REVIEW without it.
  if (invoices.some((o) => o.result === "transient")) return invoices;
  const payments = await drainPayments(businessId, opts);
  return [...invoices, ...payments];
}
