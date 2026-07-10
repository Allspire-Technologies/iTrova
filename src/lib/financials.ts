// Pure maths for the Balance Sheet and Cash Flow statements (Accounting module). No I/O.
//
// Cash Flow is CASH basis and VAT-INCLUSIVE — it tracks actual money moving, so VAT you receive/pay
// in cash is part of the flow. (This differs from the P&L, which is accrual and net of VAT.)
// The Balance Sheet is a position snapshot; its Cash anchor = opening cash + net cash movement since
// the books opening date, and Equity = owner's capital + retained earnings (accumulated net profit).

function round2(n: number): number {
  return Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;
}

// ---- Cash Flow -------------------------------------------------------------------------------
export interface CashLine { label: string; amount: number }
export interface CashFlow {
  inflows: CashLine[];
  totalIn: number;
  outflows: CashLine[];
  totalOut: number;
  net: number;
}
/** Sum a set of cash lines (drops zero lines so the statement stays tidy). */
function tidy(lines: CashLine[]): { lines: CashLine[]; total: number } {
  const kept = lines.filter((l) => round2(l.amount) !== 0).map((l) => ({ label: l.label, amount: round2(l.amount) }));
  return { lines: kept, total: round2(kept.reduce((a, l) => a + l.amount, 0)) };
}
export function buildCashFlow(inflows: CashLine[], outflows: CashLine[]): CashFlow {
  const i = tidy(inflows);
  const o = tidy(outflows);
  return { inflows: i.lines, totalIn: i.total, outflows: o.lines, totalOut: o.total, net: round2(i.total - o.total) };
}

// ---- Balance Sheet ---------------------------------------------------------------------------
/** Stock valued at cost: products (stock × cost_price) + raw materials (stock × cost_per_unit). */
export function inventoryValue(
  products: { stock_quantity?: number | null; cost_price?: number | null }[],
  materials: { stock_quantity?: number | null; cost_per_unit?: number | null }[],
): number {
  const p = products.reduce((a, x) => a + (Number(x.stock_quantity) || 0) * (Number(x.cost_price) || 0), 0);
  const m = materials.reduce((a, x) => a + (Number(x.stock_quantity) || 0) * (Number(x.cost_per_unit) || 0), 0);
  return round2(p + m);
}
/** Money owed to the business = unpaid balance of issued/part-paid invoices (never negative). */
export function receivablesOutstanding(
  invoices: { total: number; amount_paid?: number | null; status?: string | null }[],
): number {
  const open = new Set(["issued", "partial"]);
  return round2(invoices.reduce((a, i) => {
    if (!open.has((i.status ?? "").toLowerCase())) return a;
    return a + Math.max(0, (Number(i.total) || 0) - (Number(i.amount_paid) || 0));
  }, 0));
}

export interface BalanceSheet {
  cash: number;
  inventory: number;
  receivables: number;
  totalAssets: number;
  payables: number;
  vatPayable: number;
  totalLiabilities: number;
  capital: number;
  retainedEarnings: number;
  totalEquity: number;
  /** Assets − (Liabilities + Equity). Non-zero because iTrova isn't double-entry — shown transparently. */
  difference: number;
}
export function buildBalanceSheet(a: {
  cash: number; inventory: number; receivables: number;
  payables: number; vatPayable: number;
  capital: number; retainedEarnings: number;
}): BalanceSheet {
  const cash = round2(a.cash);
  const inventory = round2(a.inventory);
  const receivables = round2(a.receivables);
  const totalAssets = round2(cash + inventory + receivables);
  const payables = round2(a.payables);
  const vatPayable = round2(Math.max(0, a.vatPayable));
  const totalLiabilities = round2(payables + vatPayable);
  const capital = round2(a.capital);
  const retainedEarnings = round2(a.retainedEarnings);
  const totalEquity = round2(capital + retainedEarnings);
  return {
    cash, inventory, receivables, totalAssets,
    payables, vatPayable, totalLiabilities,
    capital, retainedEarnings, totalEquity,
    difference: round2(totalAssets - (totalLiabilities + totalEquity)),
  };
}
