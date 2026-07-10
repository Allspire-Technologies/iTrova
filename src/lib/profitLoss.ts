// Pure Profit & Loss maths for the Accounting module. No I/O — the page fetches rows and feeds them
// here. Accrual basis: revenue when invoiced. VAT is a pass-through liability, so revenue and expenses
// are shown NET of VAT (never counted as income/expense). COGS uses the cost captured at sale time
// (sale_items.unit_cost), falling back to the product's current cost for pre-capture sales.

function round2(n: number): number {
  return Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;
}

/** Net of VAT = gross − vat (2dp). */
export function netOfVat(gross: number, vat: number): number {
  return round2((Number(gross) || 0) - (Number(vat) || 0));
}

/** A margin as a percentage of revenue (2dp), or null when revenue is zero (avoid divide-by-zero). */
export function margin(part: number, whole: number): number | null {
  const w = Number(whole) || 0;
  return w === 0 ? null : round2(((Number(part) || 0) / w) * 100);
}

// ---- Revenue ---------------------------------------------------------------------------------
export interface InvoiceLike {
  total: number;
  tax?: number | null;
  status?: string | null;
}
/** Statuses that recognise revenue under accrual: issued, part-paid or paid (never draft/void). */
export const REVENUE_STATUSES = ["issued", "partial", "paid"] as const;
export function isRevenueInvoice(inv: { status?: string | null }): boolean {
  return (REVENUE_STATUSES as readonly string[]).includes((inv.status ?? "").toLowerCase());
}
/** Revenue net of output VAT for the given invoices (caller pre-filters to the period/statuses). */
export function revenueNetOfVat(invoices: InvoiceLike[]): number {
  return round2(invoices.reduce((a, i) => a + netOfVat(i.total, i.tax ?? 0), 0));
}

// ---- COGS ------------------------------------------------------------------------------------
export interface CostedSaleItem {
  product_id: string | null;
  quantity: number;
  unit_cost?: number | null; // captured at sale time; null for pre-capture rows
}
/**
 * COGS = Σ qty × cost. Uses the captured `unit_cost` when present; otherwise falls back to the
 * product's current cost (an estimate for sales made before cost capture shipped).
 */
export function computeCogs(
  items: CostedSaleItem[],
  products: { id: string; cost_price?: number | null }[],
): number {
  const costById = new Map(products.map((p) => [p.id, Number(p.cost_price || 0)]));
  return round2(
    items.reduce((a, i) => {
      const cost = i.unit_cost != null
        ? Number(i.unit_cost)
        : (i.product_id ? costById.get(i.product_id) || 0 : 0);
      return a + (Number(i.quantity) || 0) * cost;
    }, 0),
  );
}
/** How many sold units have no recorded cost — powers the "set product costs" accuracy hint. */
export function itemsMissingCost(
  items: CostedSaleItem[],
  products: { id: string; cost_price?: number | null }[],
): number {
  const costById = new Map(products.map((p) => [p.id, Number(p.cost_price || 0)]));
  return items.reduce((a, i) => {
    const known = i.unit_cost != null && Number(i.unit_cost) > 0
      ? true
      : !!(i.product_id && (costById.get(i.product_id) || 0) > 0);
    return a + (known ? 0 : (Number(i.quantity) || 0));
  }, 0);
}

// ---- Operating expenses ----------------------------------------------------------------------
export interface RawExpense {
  category: string;
  amount: number;
  tax_amount?: number | null; // input VAT portion, stripped out for the P&L
}
export interface PnlExpenseLine {
  category: string;
  amount: number; // net of input VAT
}
/** Group expenses by category, net of input VAT, largest first. */
export function expenseLinesNetOfVat(expenses: RawExpense[]): PnlExpenseLine[] {
  const map = new Map<string, number>();
  for (const e of expenses) {
    const cat = (e.category || "Uncategorised").trim() || "Uncategorised";
    map.set(cat, (map.get(cat) ?? 0) + netOfVat(e.amount, e.tax_amount ?? 0));
  }
  return [...map.entries()]
    .map(([category, amount]) => ({ category, amount: round2(amount) }))
    .sort((a, b) => b.amount - a.amount);
}

// ---- Statement -------------------------------------------------------------------------------
export interface PnlStatement {
  revenue: number;
  cogs: number;
  grossProfit: number;
  grossMargin: number | null;
  expenses: PnlExpenseLine[];
  totalExpenses: number;
  netProfit: number;
  netMargin: number | null;
}
export function buildPnl(input: { revenue: number; cogs: number; expenses: PnlExpenseLine[] }): PnlStatement {
  const revenue = round2(input.revenue);
  const cogs = round2(input.cogs);
  const grossProfit = round2(revenue - cogs);
  const totalExpenses = round2(input.expenses.reduce((a, e) => a + (Number(e.amount) || 0), 0));
  const netProfit = round2(grossProfit - totalExpenses);
  return {
    revenue, cogs, grossProfit, grossMargin: margin(grossProfit, revenue),
    expenses: input.expenses, totalExpenses,
    netProfit, netMargin: margin(netProfit, revenue),
  };
}

/** Period-over-period % change (null when the previous value is zero). */
export function pctChange(cur: number, prev: number): number | null {
  return prev === 0 ? null : ((cur - prev) / prev) * 100;
}
