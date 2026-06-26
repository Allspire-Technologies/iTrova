export function toWaNumber(phone: string): string {
  return phone.replace(/[^\d+]/g, "").replace(/^\+/, "");
}

/** A usable wa.me number: 7–15 digits once country code and separators are stripped. */
export function isValidWaNumber(phone: string): boolean {
  return /^\d{7,15}$/.test(toWaNumber(phone));
}

export function waLink(phone: string, text: string): string {
  return `https://wa.me/${toWaNumber(phone)}?text=${encodeURIComponent(text)}`;
}

type Money = (n: number) => string;

export function buildReceiptMessage(p: {
  businessName: string;
  date: string;
  invoiceNumber?: string | null;
  items: { qty: number; name: string; lineTotal: number }[];
  subtotal: number;
  discount: number;
  total: number;
  method: string;
  servedBy?: string | null;
  fmt: Money;
}): string {
  return [
    `*${p.businessName}*`,
    p.invoiceNumber ? `Receipt ${p.invoiceNumber}` : null,
    p.date,
    "—",
    ...p.items.map(i => `${i.qty} × ${i.name} — ${p.fmt(i.lineTotal)}`),
    "—",
    ...(p.discount > 0 ? [`Subtotal: ${p.fmt(p.subtotal)}`, `Discount: -${p.fmt(p.discount)}`] : []),
    `*Total: ${p.fmt(p.total)}*`,
    `Paid via ${p.method}`,
    p.servedBy ? `Served by ${p.servedBy}` : null,
    "Thank you for your patronage!",
  ].filter(Boolean).join("\n");
}

export function buildInvoiceMessage(p: {
  businessName: string;
  invoiceNumber: string;
  customerName: string;
  issueDate: string;
  dueDate?: string | null;
  status?: string | null;
  items: { description: string; quantity: number; lineTotal: number }[];
  subtotal: number;
  discount: number;
  total: number;
  notes?: string | null;
  fmt: Money;
}): string {
  return [
    `*Invoice ${p.invoiceNumber}*`,
    p.businessName,
    `Bill to: ${p.customerName}`,
    `Date: ${p.issueDate}`,
    p.dueDate ? `Due: ${p.dueDate}` : null,
    p.status ? `Status: ${p.status}` : null,
    "—",
    ...p.items.map(i => `${i.quantity} × ${i.description} — ${p.fmt(i.lineTotal)}`),
    "—",
    ...(p.discount > 0 ? [`Subtotal: ${p.fmt(p.subtotal)}`, `Discount: -${p.fmt(p.discount)}`] : []),
    `*Total: ${p.fmt(p.total)}*`,
    p.notes ? `\n${p.notes}` : null,
  ].filter(Boolean).join("\n");
}

export function buildReorderMessage(p: {
  businessName: string;
  contactName: string;
  materialName: string;
  sku?: string | null;
  unit: string;
  quantity: number;
  currentStock: number;
  reorderLevel: number;
}): string {
  return [
    `*Reorder request — ${p.businessName}*`,
    `Hello ${p.contactName},`,
    `We'd like to reorder:`,
    `${p.materialName}${p.sku ? ` (${p.sku})` : ""}`,
    `Quantity: ${p.quantity} ${p.unit}`,
    `Current stock: ${p.currentStock} ${p.unit}`,
    `Reorder level: ${p.reorderLevel} ${p.unit}`,
    `Please confirm availability and price. Thank you!`,
  ].join("\n");
}
