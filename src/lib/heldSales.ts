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
