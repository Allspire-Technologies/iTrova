export interface SaleLike {
  total_amount: number;
  staff_id?: string | null;
}
export interface SaleItemLike {
  product_id: string | null;
  quantity: number;
  unit_price?: number;
}
export interface ProductCostLike {
  id: string;
  cost_price?: number | null;
}
export interface StockLike {
  stock_quantity: number;
  reorder_level: number;
}

export function salesRevenue(sales: { total_amount: number }[]): number {
  return sales.reduce((a, s) => a + Number(s.total_amount), 0);
}

export function unitsSold(items: { quantity: number }[]): number {
  return items.reduce((a, i) => a + Number(i.quantity), 0);
}

export function computeCogs(items: SaleItemLike[], products: ProductCostLike[]): number {
  const costById = new Map(products.map((p) => [p.id, Number(p.cost_price || 0)]));
  return items.reduce(
    (a, i) => a + (i.product_id ? costById.get(i.product_id) || 0 : 0) * Number(i.quantity),
    0,
  );
}

export interface SalesSummary {
  revenue: number;
  txns: number;
  avg: number;
  units: number;
  cogs: number;
  grossProfit: number;
}

export function salesSummary(
  sales: { total_amount: number }[],
  items: SaleItemLike[],
  products: ProductCostLike[],
): SalesSummary {
  const revenue = salesRevenue(sales);
  const txns = sales.length;
  const units = unitsSold(items);
  const cogs = computeCogs(items, products);
  return { revenue, txns, avg: txns ? revenue / txns : 0, units, cogs, grossProfit: revenue - cogs };
}

export function pctChange(cur: number, prev: number): number | null {
  return prev === 0 ? null : ((cur - prev) / prev) * 100;
}

export function outOfStockProducts<T extends { stock_quantity: number }>(products: T[]): T[] {
  return products.filter((p) => Number(p.stock_quantity) === 0);
}

export function lowStockProducts<T extends StockLike>(products: T[]): T[] {
  return products.filter(
    (p) => Number(p.stock_quantity) > 0 && Number(p.stock_quantity) <= Number(p.reorder_level),
  );
}

export function totalStockUnits(products: { stock_quantity: number }[]): number {
  return products.reduce((a, p) => a + Number(p.stock_quantity), 0);
}

export interface TopProduct {
  name: string;
  qty: number;
  revenue: number;
}

export function topProductsByRevenue(
  items: SaleItemLike[],
  products: { id: string; name: string }[],
  limit = 10,
): TopProduct[] {
  const nameById = new Map(products.map((p) => [p.id, p.name]));
  const map = new Map<string, TopProduct>();
  items.forEach((i) => {
    const id = i.product_id || "—";
    const name = (i.product_id && nameById.get(i.product_id)) || "Unknown";
    const cur = map.get(id) || { name, qty: 0, revenue: 0 };
    cur.qty += Number(i.quantity);
    cur.revenue += Number(i.quantity) * Number(i.unit_price);
    map.set(id, cur);
  });
  return Array.from(map.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);
}

export interface StaffRevenue {
  name: string;
  revenue: number;
}

export function staffRevenue(
  sales: SaleLike[],
  staffNames: Record<string, string>,
): StaffRevenue[] {
  const map = new Map<string, StaffRevenue>();
  sales.forEach((s) => {
    const name = (s.staff_id && staffNames[s.staff_id]) || (s.staff_id ? "Staff" : "Walk-in");
    const cur = map.get(name) || { name, revenue: 0 };
    cur.revenue += Number(s.total_amount);
    map.set(name, cur);
  });
  return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
}

export interface PaymentMethodRow {
  method: string;
  total: number;
  pct: number; // share of the total, 1 dp
}

/** Money collected per payment method, highest first. Takes per-method amount lines (from
 *  sale_payments), so a split sale contributes to each of its methods. `pct` is the share of the
 *  grand total (0 when nothing was collected). */
export function paymentMethodBreakdown(lines: { method: string; amount: number }[]): PaymentMethodRow[] {
  const map = new Map<string, number>();
  for (const l of lines) {
    const m = (l.method || "other").trim() || "other";
    map.set(m, (map.get(m) ?? 0) + (Number(l.amount) || 0));
  }
  const total = [...map.values()].reduce((s, v) => s + v, 0);
  return [...map.entries()]
    .map(([method, amt]) => ({ method, total: amt, pct: total > 0 ? Math.round((amt / total) * 1000) / 10 : 0 }))
    .filter((r) => r.total !== 0)
    .sort((a, b) => b.total - a.total);
}

export interface TurnoverRow {
  name: string;
  sold: number;
  stock: number;
  rate: number | null;
}

export function productTurnover(
  items: SaleItemLike[],
  products: { id: string; name: string; stock_quantity: number }[],
  limit = 10,
): TurnoverRow[] {
  const soldById = new Map<string, number>();
  items.forEach((i) => {
    if (i.product_id) soldById.set(i.product_id, (soldById.get(i.product_id) || 0) + Number(i.quantity));
  });
  return products
    .filter((p) => soldById.has(p.id))
    .map((p) => ({
      name: p.name,
      sold: soldById.get(p.id) || 0,
      stock: Number(p.stock_quantity),
      rate: Number(p.stock_quantity) > 0 ? (soldById.get(p.id) || 0) / Number(p.stock_quantity) : null,
    }))
    .sort((a, b) => (b.rate ?? Infinity) - (a.rate ?? Infinity))
    .slice(0, limit);
}

export interface SupplierSpendRow {
  name: string;
  total: number;
}

export function supplierSpendTotal(purchases: { total_cost: number }[]): number {
  return purchases.reduce((a, p) => a + Number(p.total_cost), 0);
}

export function supplierSpendRows(
  purchases: { supplier_id: string | null; total_cost: number }[],
  suppliers: { id: string; name: string }[],
): SupplierSpendRow[] {
  const nameById = new Map(suppliers.map((s) => [s.id, s.name]));
  const map = new Map<string, number>();
  purchases.forEach((p) => {
    const k = p.supplier_id || "—";
    map.set(k, (map.get(k) || 0) + Number(p.total_cost));
  });
  return Array.from(map.entries())
    .map(([id, total]) => ({ name: nameById.get(id) || "Unknown", total }))
    .sort((a, b) => b.total - a.total);
}
