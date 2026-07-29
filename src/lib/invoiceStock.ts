// Pure stock-reconciliation helpers for invoicing inventory items. Mirrors the server-side delta
// logic in save_invoice: an inventory line deducts finished stock; editing an invoice, the stock it
// already holds is "available" to it, so only the net increase is checked against live stock.

export const CUSTOM = "__custom__"; // productKey sentinel for a free-text (non-inventory) line

export type StockLine = { productKey: string; quantity: number };
export type StockProduct = { id: string; name: string; stock_quantity: number };

/** Quantity requested per product across inventory lines (custom lines are ignored). */
export function qtyByProduct(lines: StockLine[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const l of lines) {
    if (l.productKey && l.productKey !== CUSTOM) m[l.productKey] = (m[l.productKey] || 0) + Number(l.quantity || 0);
  }
  return m;
}

/** Stock available to this invoice for a product: live stock plus whatever it already holds
 *  (`committed`) — because saving an edit returns the old quantity before taking the new one. */
export function availableFor(productKey: string, products: StockProduct[], committed: Record<string, number> = {}): number {
  const p = products.find((x) => x.id === productKey);
  return p ? Number(p.stock_quantity) + (committed[productKey] || 0) : 0;
}

/** Products whose requested quantity exceeds what's available — one human-readable message each.
 *  Empty array means the invoice can be saved without overselling. */
export function stockShortfalls(lines: StockLine[], products: StockProduct[], committed: Record<string, number> = {}): string[] {
  const desired = qtyByProduct(lines);
  const errs: string[] = [];
  for (const pid of Object.keys(desired)) {
    const p = products.find((x) => x.id === pid);
    if (!p) continue;
    const avail = availableFor(pid, products, committed);
    if (desired[pid] > avail + 1e-9) errs.push(`${p.name}: ${desired[pid]} requested, only ${avail} in stock`);
  }
  return errs;
}
