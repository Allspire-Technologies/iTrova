import { supabase } from "@/integrations/supabase/client";
import { bumpAttempt, listQueuedSales, markSaleFailed, markSaleSyncing, moveToReview, removeQueuedSale } from "./offlineStore";
import type { QueuedSale } from "./offlineTypes";

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
    discount: s.discount,
    subtotal: s.subtotal,
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
