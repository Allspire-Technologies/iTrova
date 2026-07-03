import { supabase } from "@/integrations/supabase/client";
import { loadPdf } from "./pdf";

// International commercial ("export") invoice: a downloadable document generated from Inventory.
// The seller block is snapshotted from the business's exporter profile; buyer/meta/line items are
// entered on the form. Numbers come from the next_export_invoice_number RPC (atomic per year).

export type ExportInvoiceItem = {
  description: string;
  size: string;
  units_per_box: string; // free text (e.g. "200g x 32") — kept as entered
  boxes: number;
  unit_price: number;
  total: number; // boxes * unit_price
};

export type ExportSeller = { name: string; address: string; email: string; phone: string };
export type ExportBuyer = { name: string; address: string; country: string };

export type ExportInvoiceDraft = {
  invoice_number: string;
  invoice_date: string; // YYYY-MM-DD
  country_of_origin: string;
  currency: string;
  seller: ExportSeller;
  buyer: ExportBuyer;
  items: ExportInvoiceItem[];
  notes: string;
};

export type ExportInvoiceRecord = ExportInvoiceDraft & { id: string; subtotal: number; total: number; created_at: string };

/** A blank line item. */
export function emptyItem(): ExportInvoiceItem {
  return { description: "", size: "", units_per_box: "", boxes: 0, unit_price: 0, total: 0 };
}

/** Total for one line = boxes × unit price (guards NaN/negatives). */
export function lineTotal(item: Pick<ExportInvoiceItem, "boxes" | "unit_price">): number {
  const boxes = Number(item.boxes) || 0;
  const price = Number(item.unit_price) || 0;
  return Math.max(0, boxes) * Math.max(0, price);
}

/** Grand total across all lines (sum of each line's boxes × unit price — never a stale stored value). */
export function invoiceTotal(items: ExportInvoiceItem[]): number {
  return items.reduce((sum, it) => sum + lineTotal(it), 0);
}

/** Currency formatter for the document (ISO code + grouped amount, no forced symbol). */
export function formatExportMoney(amount: number, currency: string): string {
  const n = (Number(amount) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${currency} ${n}`;
}

/** Ask the server for the next atomic per-year number for this business. */
export async function nextExportInvoiceNumber(businessId: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await supabase.rpc("next_export_invoice_number" as any, { _business_id: businessId });
  if (error) throw error;
  return data as string;
}

/** Persist a completed export invoice (totals recomputed here, never trusted from the form). */
export async function saveExportInvoice(businessId: string, userId: string | null, draft: ExportInvoiceDraft): Promise<ExportInvoiceRecord> {
  const items = draft.items.map((it) => ({ ...it, total: lineTotal(it) }));
  const total = invoiceTotal(items);
  const row = {
    business_id: businessId,
    invoice_number: draft.invoice_number,
    invoice_date: draft.invoice_date,
    country_of_origin: draft.country_of_origin || null,
    currency: draft.currency,
    seller_name: draft.seller.name || null,
    seller_address: draft.seller.address || null,
    seller_email: draft.seller.email || null,
    seller_phone: draft.seller.phone || null,
    buyer_name: draft.buyer.name || null,
    buyer_address: draft.buyer.address || null,
    buyer_country: draft.buyer.country || null,
    items,
    subtotal: total,
    total,
    notes: draft.notes || null,
    created_by: userId,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await supabase.from("export_invoices" as any).insert(row as any).select().single();
  if (error) throw error;
  return fromRow(data);
}

/** Recent saved export invoices for the business (for the history / re-download list). */
export async function listExportInvoices(limit = 20): Promise<ExportInvoiceRecord[]> {
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
    seller: { name: r.seller_name ?? "", address: r.seller_address ?? "", email: r.seller_email ?? "", phone: r.seller_phone ?? "" },
    buyer: { name: r.buyer_name ?? "", address: r.buyer_address ?? "", country: r.buyer_country ?? "" },
    items: (r.items ?? []) as ExportInvoiceItem[],
    notes: r.notes ?? "",
    subtotal: Number(r.subtotal) || 0,
    total: Number(r.total) || 0,
    created_at: r.created_at,
  };
}

/** Build the commercial-invoice PDF (jsPDF + autotable, loaded on demand). */
export async function buildExportInvoicePdf(inv: ExportInvoiceDraft) {
  const { jsPDF, autoTable } = await loadPdf();
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const M = 40;
  const money = (n: number) => formatExportMoney(n, inv.currency);

  // Title
  doc.setFont("helvetica", "bold").setFontSize(18);
  doc.text("INTERNATIONAL COMMERCIAL INVOICE", pageW / 2, 50, { align: "center" });

  const label = (t: string, x: number, y: number) => { doc.setFont("helvetica", "bold").setFontSize(10); doc.text(t, x, y); };
  const line = (t: string, x: number, y: number) => { doc.setFont("helvetica", "normal").setFontSize(9); doc.text(t, x, y); };
  const wrap = (t: string, w: number) => doc.splitTextToSize(t, w) as string[];

  // Seller (left) + Invoice details (right)
  let ly = 84;
  label("SELLER (EXPORTER)", M, ly); ly += 14;
  doc.setFont("helvetica", "bold").setFontSize(11); doc.text(inv.seller.name || "—", M, ly); ly += 14;
  for (const l of wrap(inv.seller.address || "", 260)) { line(l, M, ly); ly += 12; }
  if (inv.seller.email) { line(`Email: ${inv.seller.email}`, M, ly); ly += 12; }
  if (inv.seller.phone) { line(`Phone: ${inv.seller.phone}`, M, ly); ly += 12; }

  let ry = 84;
  label("INVOICE DETAILS", pageW - M - 220, ry); ry += 14;
  line(`Invoice No: ${inv.invoice_number}`, pageW - M - 220, ry); ry += 12;
  line(`Date: ${inv.invoice_date}`, pageW - M - 220, ry); ry += 12;
  if (inv.country_of_origin) { line(`Country of Origin: ${inv.country_of_origin}`, pageW - M - 220, ry); ry += 12; }

  // Buyer
  let by = Math.max(ly, ry) + 14;
  label("BUYER (IMPORTER)", M, by); by += 14;
  doc.setFont("helvetica", "bold").setFontSize(11); doc.text(inv.buyer.name || "—", M, by); by += 14;
  for (const l of wrap(inv.buyer.address || "", 320)) { line(l, M, by); by += 12; }
  if (inv.buyer.country) { line(inv.buyer.country, M, by); by += 12; }

  // Items
  const items = inv.items.map((it) => ({ ...it, total: lineTotal(it) }));
  autoTable(doc, {
    startY: by + 10,
    head: [["No", "Product Description", "Size", "Units/Box", "Boxes", `Unit Price (${inv.currency})`, `Total (${inv.currency})`]],
    body: items.map((it, i) => [
      String(i + 1), it.description, it.size, it.units_per_box, String(it.boxes),
      money(it.unit_price), money(it.total),
    ]),
    styles: { fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255 },
    columnStyles: { 0: { halign: "right", cellWidth: 26 }, 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" } },
    margin: { left: M, right: M },
  });

  // @ts-expect-error autoTable adds lastAutoTable
  let endY: number = doc.lastAutoTable.finalY + 18;
  doc.setFont("helvetica", "bold").setFontSize(12);
  doc.text("Total", pageW - M - 180, endY);
  doc.text(money(invoiceTotal(items)), pageW - M, endY, { align: "right" });

  if (inv.notes) {
    endY += 28;
    doc.setFont("helvetica", "normal").setFontSize(9);
    doc.text("Notes:", M, endY);
    doc.text(wrap(inv.notes, pageW - M * 2), M, endY + 12);
  }

  doc.setFontSize(8).setTextColor(120);
  doc.text("Generated by iTrova", M, doc.internal.pageSize.getHeight() - 24);
  return doc;
}

export async function downloadExportInvoicePdf(inv: ExportInvoiceDraft, filename: string) {
  (await buildExportInvoicePdf(inv)).save(filename);
}
