export interface HeldProduct {
  id: string;
  name: string;
  selling_price: number;
  stock_quantity: number;
}

export interface HeldCartItem {
  product: HeldProduct;
  qty: number;
}

export interface HeldSale {
  id: string;
  createdAt: string;
  items: HeldCartItem[];
  discount: number;
}

export function cartSubtotal(items: { product: { selling_price: number }; qty: number }[]): number {
  return items.reduce((a, i) => a + i.qty * Number(i.product.selling_price), 0);
}

export interface HeldSaleSummary {
  count: number;
  subtotal: number;
  total: number;
}

export function summarizeHeldSale(sale: { items: HeldCartItem[]; discount: number }): HeldSaleSummary {
  const subtotal = cartSubtotal(sale.items);
  return {
    count: sale.items.length,
    subtotal,
    total: Math.max(0, subtotal - Number(sale.discount || 0)),
  };
}

export function heldItemsPreview(items: HeldCartItem[], max = 3): string {
  const shown = items.slice(0, max).map((i) => `${i.qty}× ${i.product.name}`);
  const extra = items.length - max;
  return extra > 0 ? `${shown.join(", ")} +${extra} more` : shown.join(", ");
}

export interface ReconcileResult<P> {
  items: { product: P; qty: number }[];
  removed: number;
  capped: number;
}

/**
 * Reconcile a held cart against live stock. A held sale snapshots stock at hold time,
 * which goes stale if the item sells elsewhere before the sale is resumed. This drops
 * items that are no longer in stock and caps each quantity to what's actually available.
 * Returns the cleaned items plus how many were removed / capped, so the UI can explain.
 */
export function reconcileHeldItems<P extends { id: string; stock_quantity: number }>(
  items: { product: { id: string }; qty: number }[],
  live: Map<string, P>,
): ReconcileResult<P> {
  let removed = 0;
  let capped = 0;
  const out: { product: P; qty: number }[] = [];
  for (const it of items) {
    const p = live.get(it.product.id);
    const avail = p ? Number(p.stock_quantity) : 0;
    if (!p || avail <= 0) {
      removed += 1;
      continue;
    }
    const qty = Math.min(it.qty, avail);
    if (qty < it.qty) capped += 1;
    out.push({ product: p, qty });
  }
  return { items: out, removed, capped };
}

export function heldStorageKey(businessId: string): string {
  return `itrova:held-sales:${businessId}`;
}

export function parseHeldSales(raw: string | null): HeldSale[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s) => s && typeof s.id === "string" && Array.isArray(s.items));
  } catch {
    return [];
  }
}

export function serializeHeldSales(sales: HeldSale[]): string {
  return JSON.stringify(sales);
}
