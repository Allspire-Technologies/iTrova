export interface ReceiptItem {
  description: string;
  quantity: number;
  line_total: number;
}

export interface ReceiptData {
  businessName: string;
  docNumber: string;
  date: string;
  customerName?: string | null;
  servedBy?: string | null;
  items: ReceiptItem[];
  subtotal: number;
  discount?: number;
  tax?: number;              // VAT on the sale (shown as a line when > 0)
  tin?: string | null;       // business Tax ID, printed under the name when present
  total: number;
  paid?: boolean;
  formatMoney: (n: number) => string;
  widthMm?: number;
  footer?: string;
}

const DEFAULT_WIDTH_MM = 80;

function escapeHtml(value: unknown): string {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string),
  );
}

export function buildReceiptHtml(r: ReceiptData): string {
  const money = (n: number) => escapeHtml(r.formatMoney(n));
  const width = r.widthMm ?? DEFAULT_WIDTH_MM;
  const hasDiscount = !!r.discount && r.discount > 0;

  const itemsHtml = r.items
    .map(
      (it) =>
        `<div class="row"><span class="qty">${escapeHtml(it.quantity)}×</span><span class="name">${escapeHtml(it.description)}</span><span class="amt">${money(it.line_total)}</span></div>`,
    )
    .join("");

  const hasTax = !!r.tax && r.tax > 0;
  // When there's VAT, show the NET subtotal (total − VAT) so the receipt adds up: subtotal + VAT =
  // total. (Prices are typically VAT-inclusive, so the stored subtotal already contains the VAT.)
  // The discount is already reflected in the total, so it isn't itemised again on a taxed receipt.
  const netSubtotal = hasTax ? r.total - (r.tax as number) : r.subtotal;
  const subtotalHtml = (hasDiscount || hasTax)
    ? `<div class="row"><span class="name">Subtotal</span><span class="amt">${money(netSubtotal)}</span></div>`
    : "";
  const discountHtml = (hasDiscount && !hasTax)
    ? `<div class="row"><span class="name">Discount</span><span class="amt">-${money(r.discount as number)}</span></div>`
    : "";
  const taxHtml = hasTax
    ? `<div class="row"><span class="name">VAT</span><span class="amt">${money(r.tax as number)}</span></div>`
    : "";
  const paidBadge = r.paid ? `<div class="paid">*** PAID ***</div>` : "";
  const tinHtml = r.tin ? `<div class="muted">TIN: ${escapeHtml(r.tin)}</div>` : "";
  const customerHtml = r.customerName ? `<div class="meta">Customer: ${escapeHtml(r.customerName)}</div>` : "";
  const servedHtml = r.servedBy ? `Served by ${escapeHtml(r.servedBy)}<br/>` : "";
  const footer = escapeHtml(r.footer ?? "Thank you for your patronage");

  return `<!doctype html><html><head><meta charset="utf-8"><title>Receipt ${escapeHtml(r.docNumber)}</title><style>
@page { size: ${width}mm auto; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: ui-monospace, "Cascadia Mono", Menlo, Consolas, "Courier New", monospace; width: ${width}mm; padding: 4mm 3mm; color: #000; font-size: 12px; line-height: 1.35; }
h1 { font-size: 15px; text-align: center; margin: 0 0 2px; }
.muted { text-align: center; font-size: 11px; margin: 0; }
.meta { font-size: 11px; margin: 4px 0 0; }
hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
.row { display: flex; gap: 6px; font-size: 12px; margin: 2px 0; }
.row .name { flex: 1; word-break: break-word; }
.row .qty { white-space: nowrap; }
.row .amt { white-space: nowrap; text-align: right; }
.total { font-size: 14px; font-weight: bold; margin-top: 4px; }
.paid { text-align: center; font-weight: bold; margin: 6px 0; }
.foot { text-align: center; font-size: 11px; margin-top: 8px; }
</style></head><body>
<h1>${escapeHtml(r.businessName)}</h1>
${tinHtml}
<div class="muted">Receipt ${escapeHtml(r.docNumber)}</div>
<div class="muted">${escapeHtml(r.date)}</div>
${customerHtml}
<hr/>
${itemsHtml}
<hr/>
${subtotalHtml}
${discountHtml}
${taxHtml}
<div class="row total"><span class="name">TOTAL</span><span class="amt">${money(r.total)}</span></div>
${paidBadge}
<div class="foot">${servedHtml}${footer}</div>
<script>window.onload=function(){window.print();setTimeout(function(){window.close()},300)}</script>
</body></html>`;
}
