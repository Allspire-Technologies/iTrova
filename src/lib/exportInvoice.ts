import { supabase } from "@/integrations/supabase/client";
import { loadPdf } from "./pdf";

// International commercial ("export") invoice. Product-linked lines deplete inventory (boxes ×
// units/box) via the atomic create_export_invoice RPC, which also numbers and saves the invoice.

export type ExportInvoiceItem = {
  product_id: string | null; // set = deducts stock on save
  description: string;
  size: string;
  units_per_box: number;
  boxes: number;
  unit_price: number; // per box
  total: number; // boxes × unit_price
};

export type ExportSeller = { name: string; address: string; email: string; phone: string; rc: string };
export type ExportBuyer = { name: string; address: string; country: string };
export type ExportShipping = { mode_of_shipment: string; delivery_terms: string; packaging: string; payment_terms: string };
export type ExportBank = { bank_name: string; account_name: string; account_number: string; swift: string };

export type ExportInvoiceDraft = {
  invoice_number: string; // blank until the server assigns it
  invoice_date: string;
  country_of_origin: string;
  currency: string;
  seller: ExportSeller;
  buyer: ExportBuyer;
  shipping: ExportShipping;
  bank: ExportBank;
  items: ExportInvoiceItem[];
  notes: string;
};

export type ExportInvoiceRecord = ExportInvoiceDraft & {
  id: string; subtotal: number; total: number; total_cartons: number; amount_in_words: string; created_at: string;
};

export function emptyItem(): ExportInvoiceItem {
  return { product_id: null, description: "", size: "", units_per_box: 0, boxes: 0, unit_price: 0, total: 0 };
}

/** Line total = boxes × unit price (guards NaN/negatives). */
export function lineTotal(item: Pick<ExportInvoiceItem, "boxes" | "unit_price">): number {
  return Math.max(0, Number(item.boxes) || 0) * Math.max(0, Number(item.unit_price) || 0);
}

/** Grand total = Σ (boxes × unit price). */
export function invoiceTotal(items: ExportInvoiceItem[]): number {
  return items.reduce((sum, it) => sum + lineTotal(it), 0);
}

/** Invoice summary — total cartons/boxes across all lines. */
export function totalCartons(items: ExportInvoiceItem[]): number {
  return items.reduce((sum, it) => sum + (Math.max(0, Number(it.boxes) || 0)), 0);
}

/** Stock units a product-linked line removes from inventory (boxes × units/box). */
export function depletionQty(item: Pick<ExportInvoiceItem, "boxes" | "units_per_box">): number {
  return Math.max(0, Number(item.boxes) || 0) * Math.max(0, Number(item.units_per_box) || 0);
}

export function formatExportMoney(amount: number, currency: string): string {
  const n = (Number(amount) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${currency} ${n}`;
}

// ---------------------------------------------------------------- amount in words
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const SCALES = ["", "Thousand", "Million", "Billion", "Trillion"];

function threeDigitsToWords(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const restWords = rest >= 20 ? TENS[Math.floor(rest / 10)] + (rest % 10 ? `-${ONES[rest % 10]}` : "") : (rest > 0 ? ONES[rest] : "");
  if (hundreds && restWords) return `${ONES[hundreds]} Hundred and ${restWords}`;
  if (hundreds) return `${ONES[hundreds]} Hundred`;
  return restWords;
}

/** English words for a non-negative integer, e.g. 31927000 → "Thirty-One Million, Nine Hundred and Twenty-Seven Thousand". */
export function numberToWords(value: number): string {
  let n = Math.floor(Math.abs(Number(value) || 0));
  if (n === 0) return "Zero";
  const groups: number[] = [];
  while (n > 0) { groups.push(n % 1000); n = Math.floor(n / 1000); }
  const chunks: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i] === 0) continue;
    chunks.push(`${threeDigitsToWords(groups[i])}${SCALES[i] ? ` ${SCALES[i]}` : ""}`);
  }
  return chunks.join(", ");
}

const CURRENCY_WORD: Record<string, string> = {
  NGN: "Naira", USD: "US Dollars", EUR: "Euros", GBP: "Pounds Sterling",
  GHS: "Cedis", CAD: "Canadian Dollars", ZAR: "Rand", KES: "Shillings",
};

/** "Thirty-One Million, Nine Hundred and Twenty-Seven Thousand Naira Only" (kobo/cents omitted). */
export function amountInWords(amount: number, currency: string): string {
  const word = CURRENCY_WORD[currency] ?? currency;
  return `${numberToWords(Math.floor(Number(amount) || 0))} ${word} Only`;
}

// ---------------------------------------------------------------- persistence
export async function nextExportInvoiceNumber(businessId: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await supabase.rpc("next_export_invoice_number" as any, { _business_id: businessId });
  if (error) throw error;
  return data as string;
}

function toPayload(businessId: string, draft: ExportInvoiceDraft, items: ExportInvoiceItem[], words: string) {
  return {
    business_id: businessId,
    invoice_number: draft.invoice_number.trim() || null,
    invoice_date: draft.invoice_date,
    country_of_origin: draft.country_of_origin || null,
    currency: draft.currency,
    seller_name: draft.seller.name || null,
    seller_address: draft.seller.address || null,
    seller_email: draft.seller.email || null,
    seller_phone: draft.seller.phone || null,
    seller_rc: draft.seller.rc || null,
    buyer_name: draft.buyer.name || null,
    buyer_address: draft.buyer.address || null,
    buyer_country: draft.buyer.country || null,
    mode_of_shipment: draft.shipping.mode_of_shipment || null,
    delivery_terms: draft.shipping.delivery_terms || null,
    packaging: draft.shipping.packaging || null,
    payment_terms: draft.shipping.payment_terms || null,
    bank_name: draft.bank.bank_name || null,
    account_name: draft.bank.account_name || null,
    account_number: draft.bank.account_number || null,
    swift: draft.bank.swift || null,
    amount_in_words: words,
    notes: draft.notes || null,
    items,
  };
}

/** Save via the atomic RPC: deducts stock for product-linked lines, numbers, and inserts. */
export async function saveExportInvoice(businessId: string, draft: ExportInvoiceDraft): Promise<ExportInvoiceRecord> {
  const items = draft.items.map((it) => ({ ...it, total: lineTotal(it) }));
  const total = invoiceTotal(items);
  const words = amountInWords(total, draft.currency);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await supabase.rpc("create_export_invoice" as any, { _data: toPayload(businessId, draft, items, words) });
  if (error) throw error;
  const res = data as { id: string; invoice_number: string; total: number; total_cartons: number };
  return { ...draft, items, invoice_number: res.invoice_number, id: res.id, subtotal: res.total, total: res.total, total_cartons: res.total_cartons, amount_in_words: words, created_at: new Date().toISOString() };
}

/** Update a saved invoice, atomically reconciling stock (reverse old lines, apply new). */
export async function updateExportInvoice(id: string, businessId: string, draft: ExportInvoiceDraft): Promise<ExportInvoiceRecord> {
  const items = draft.items.map((it) => ({ ...it, total: lineTotal(it) }));
  const total = invoiceTotal(items);
  const words = amountInWords(total, draft.currency);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await supabase.rpc("update_export_invoice" as any, { _id: id, _data: toPayload(businessId, draft, items, words) });
  if (error) throw error;
  const res = data as { id: string; invoice_number: string; total: number; total_cartons: number };
  return { ...draft, items, invoice_number: res.invoice_number, id: res.id, subtotal: res.total, total: res.total, total_cartons: res.total_cartons, amount_in_words: words, created_at: new Date().toISOString() };
}

/** Fetch one saved invoice by id (RLS scopes it to the caller's business). */
export async function getExportInvoice(id: string): Promise<ExportInvoiceRecord | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await supabase.from("export_invoices" as any).select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? fromRow(data) : null;
}

export async function listExportInvoices(limit = 50): Promise<ExportInvoiceRecord[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await supabase.from("export_invoices" as any)
    .select("*").order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map(fromRow);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromRow(r: any): ExportInvoiceRecord {
  return {
    id: r.id,
    invoice_number: r.invoice_number,
    invoice_date: r.invoice_date,
    country_of_origin: r.country_of_origin ?? "",
    currency: r.currency,
    seller: { name: r.seller_name ?? "", address: r.seller_address ?? "", email: r.seller_email ?? "", phone: r.seller_phone ?? "", rc: r.seller_rc ?? "" },
    buyer: { name: r.buyer_name ?? "", address: r.buyer_address ?? "", country: r.buyer_country ?? "" },
    shipping: { mode_of_shipment: r.mode_of_shipment ?? "", delivery_terms: r.delivery_terms ?? "", packaging: r.packaging ?? "", payment_terms: r.payment_terms ?? "" },
    bank: { bank_name: r.bank_name ?? "", account_name: r.account_name ?? "", account_number: r.account_number ?? "", swift: r.swift ?? "" },
    items: (r.items ?? []) as ExportInvoiceItem[],
    notes: r.notes ?? "",
    subtotal: Number(r.subtotal) || 0,
    total: Number(r.total) || 0,
    total_cartons: Number(r.total_cartons) || 0,
    amount_in_words: r.amount_in_words ?? "",
    created_at: r.created_at,
  };
}

// ---------------------------------------------------------------- PDF
export async function buildExportInvoicePdf(inv: ExportInvoiceDraft) {
  const { jsPDF, autoTable } = await loadPdf();
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M = 40;
  const money = (n: number) => formatExportMoney(n, inv.currency);
  const items = inv.items.map((it) => ({ ...it, total: lineTotal(it) }));
  const total = invoiceTotal(items);

  const wrap = (t: string, w: number) => doc.splitTextToSize(t, w) as string[];
  const bold = (s = 10) => doc.setFont("helvetica", "bold").setFontSize(s);
  const norm = (s = 9) => doc.setFont("helvetica", "normal").setFontSize(s);
  // Advance to a new page if we're near the bottom.
  const ensure = (y: number, need = 60) => (y > pageH - need ? (doc.addPage(), M + 20) : y);

  bold(18); doc.text("INTERNATIONAL COMMERCIAL INVOICE", pageW / 2, 50, { align: "center" });

  // Seller (left) + invoice details (right)
  let ly = 84;
  bold(10); doc.text("SELLER (EXPORTER)", M, ly); ly += 14;
  bold(11); doc.text(inv.seller.name || "—", M, ly); ly += 14;
  norm(9);
  for (const l of wrap(inv.seller.address || "", 260)) { doc.text(l, M, ly); ly += 12; }
  if (inv.seller.email) { doc.text(`Email: ${inv.seller.email}`, M, ly); ly += 12; }
  if (inv.seller.phone) { doc.text(`Phone: ${inv.seller.phone}`, M, ly); ly += 12; }
  if (inv.seller.rc) { doc.text(`RC: ${inv.seller.rc}`, M, ly); ly += 12; }

  let ry = 84;
  bold(10); doc.text("INVOICE DETAILS", pageW - M - 220, ry); ry += 14;
  norm(9);
  doc.text(`Invoice No: ${inv.invoice_number}`, pageW - M - 220, ry); ry += 12;
  doc.text(`Date: ${inv.invoice_date}`, pageW - M - 220, ry); ry += 12;
  if (inv.country_of_origin) { doc.text(`Country of Origin: ${inv.country_of_origin}`, pageW - M - 220, ry); ry += 12; }

  // Buyer
  let by = Math.max(ly, ry) + 14;
  bold(10); doc.text("BUYER (IMPORTER)", M, by); by += 14;
  bold(11); doc.text(inv.buyer.name || "—", M, by); by += 14;
  norm(9);
  for (const l of wrap(inv.buyer.address || "", 320)) { doc.text(l, M, by); by += 12; }
  if (inv.buyer.country) { doc.text(inv.buyer.country, M, by); by += 12; }

  // Items
  autoTable(doc, {
    startY: by + 10,
    head: [["No", "Product Description", "Size", "Units/Box", "Boxes", `Unit Price (${inv.currency})`, `Total (${inv.currency})`]],
    body: items.map((it, i) => [
      String(i + 1), it.description, it.size, it.units_per_box ? String(it.units_per_box) : "", String(it.boxes),
      money(it.unit_price), money(it.total),
    ]),
    styles: { fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255 },
    columnStyles: { 0: { halign: "right", cellWidth: 26 }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" } },
    margin: { left: M, right: M },
  });

  // @ts-expect-error autoTable adds lastAutoTable
  let y: number = doc.lastAutoTable.finalY + 22;

  // Invoice summary + total value (with amount in words)
  y = ensure(y, 90);
  bold(10); doc.text("INVOICE SUMMARY", M, y); y += 14;
  norm(9); doc.text(`Total Cartons: ${totalCartons(items)} Boxes`, M, y); y += 20;
  bold(10); doc.text("TOTAL INVOICE VALUE", M, y); y += 14;
  bold(11); doc.text(money(total), M, y); y += 14;
  norm(9);
  for (const l of wrap(`${amountInWords(total, inv.currency)}`, pageW - M * 2)) { doc.text(l, M, y); y += 12; }

  // Shipping details
  const details: [string, string][] = [];
  if (inv.shipping.mode_of_shipment) details.push(["Mode of Shipment", inv.shipping.mode_of_shipment]);
  if (inv.shipping.delivery_terms) details.push(["Delivery Terms", inv.shipping.delivery_terms]);
  if (inv.shipping.packaging) details.push(["Packaging", inv.shipping.packaging]);
  if (inv.shipping.payment_terms) details.push(["Payment", inv.shipping.payment_terms]);
  if (details.length) {
    y = ensure(y + 8, 40 + details.length * 12);
    bold(10); doc.text("SHIPPING DETAILS", M, y); y += 14; norm(9);
    for (const [k, v] of details) { doc.text(`${k}: ${v}`, M, y); y += 12; }
  }

  // Bank details
  const bank: [string, string][] = [];
  if (inv.bank.bank_name) bank.push(["Bank", inv.bank.bank_name]);
  if (inv.bank.account_name) bank.push(["Account Name", inv.bank.account_name]);
  if (inv.bank.account_number) bank.push(["Account Number", inv.bank.account_number]);
  if (inv.bank.swift) bank.push(["SWIFT/IBAN", inv.bank.swift]);
  if (bank.length) {
    y = ensure(y + 8, 40 + bank.length * 12);
    bold(10); doc.text("BANK DETAILS", M, y); y += 14; norm(9);
    for (const [k, v] of bank) { doc.text(`${k}: ${v}`, M, y); y += 12; }
  }

  if (inv.notes) {
    y = ensure(y + 8, 40);
    bold(10); doc.text("Notes", M, y); y += 14; norm(9);
    for (const l of wrap(inv.notes, pageW - M * 2)) { doc.text(l, M, y); y += 12; }
  }

  doc.setFontSize(8).setTextColor(120);
  doc.text("Generated by iTrova", M, pageH - 24);
  return doc;
}

export async function downloadExportInvoicePdf(inv: ExportInvoiceDraft, filename: string) {
  (await buildExportInvoicePdf(inv)).save(filename);
}
