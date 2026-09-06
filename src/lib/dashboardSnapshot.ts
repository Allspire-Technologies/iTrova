import { supabase } from "@/integrations/supabase/client";
import { salesRevenue, paymentMethodBreakdown, type PaymentMethodRow } from "@/lib/reportMetrics";

// Builds the read-only Dashboard snapshot from the same queries the Dashboard page runs.
// Shared so the page (online render) and the offline pre-warm cache identical data — no drift.

export type DashProduct = { id: string; name: string; stock_quantity: number; reorder_level: number; selling_price: number };
export type DashTopProduct = { product_id: string; name: string; qty: number; revenue: number };
export type DashActivityEntry = { id: string; ts: string; label: string; sub: string; by?: string; sign: "pos" | "neg" | "neu" };
export type DashSnap = {
  todaySales: number; salesCount: number; collectedToday: number; moneyOwed: number; products: DashProduct[]; openInvoices: number;
  trend: { day: string; total: number }[]; topProducts: DashTopProduct[]; activity: DashActivityEntry[];
  vatThisMonth: number;
  payments: PaymentMethodRow[]; // money collected per method, this calendar month
};

type Sale = { id: string; total_amount: number; created_at: string };

export async function fetchDashboardSnapshot(): Promise<DashSnap> {
  const since = new Date(); since.setDate(since.getDate() - 6); since.setHours(0, 0, 0, 0);
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const sinceDate = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, "0")}-${String(since.getDate()).padStart(2, "0")}`;

  const [
    { data: sales },
    { data: prods },
    { count: openInvCount },
    { data: saleItems },
    { data: adjustments },
    { data: activityLog },
    { data: profs },
    { data: monthSales },
    { data: monthPayments },
    { data: invRowsRaw },
    { data: invItemsRaw },
    { data: invPaymentsRaw },
    { data: invOwedRaw },
  ] = await Promise.all([
    supabase.from("sales").select("id,total_amount,created_at").eq("voided", false).gte("created_at", since.toISOString()),
    supabase.from("products").select("id,name,stock_quantity,reorder_level,selling_price").is("archived_at", null).order("created_at", { ascending: false }),
    supabase.from("invoices").select("id", { count: "exact", head: true }).in("status", ["draft", "issued"]),
    // Top products only looks at today's sales, so fetch just those lines — not the whole history.
    supabase.from("sale_items").select("sale_id, product_id, quantity, unit_price, products(name), sales!inner(id)").eq("sales.voided", false).gte("sales.created_at", todayStart.toISOString()),
    supabase.from("stock_adjustments").select("id,created_at,delta,reason,notes,user_id,product_id,raw_material_id,products(name),raw_materials(name)").order("created_at", { ascending: false }).limit(50),
    supabase.from("activity_log").select("id,created_at,summary,actor_name").order("created_at", { ascending: false }).limit(50),
    supabase.from("profiles").select("id, owner_name"),
    supabase.from("sales").select("tax_amount").eq("voided", false).gte("created_at", monthStart.toISOString()),
    // sale_payments postdates the generated types → cast the client.
     
    supabase.from("sale_payments").select("method,amount,sales!inner(id)").eq("sales.voided", false).gte("sales.created_at", monthStart.toISOString()),
    // Manual invoices that sell inventory count as sales here too (accrual — recognised on issue, like
    // Reports). sale_id null excludes POS invoices (already in `sales`); void/draft excluded.
    supabase.from("invoices").select("id,total,issue_date").is("sale_id", null).not("status", "in", "(void,draft)").gte("issue_date", sinceDate),
    supabase.from("invoice_items").select("invoice_id,product_id,quantity,unit_price,products(name),invoices!inner(issue_date)").is("invoices.sale_id", null).not("invoices.status", "in", "(void,draft)").not("product_id", "is", null).gte("invoices.issue_date", sinceDate),
    // Invoice payments taken today — the "collected today" figure (deposits + balance settlements).
    supabase.from("invoice_payments").select("amount,created_at").gte("created_at", todayStart.toISOString()),
    // Outstanding receivables (money owed): unpaid balance on issued/part-paid invoices = the A/R balance.
    supabase.from("invoices").select("total,amount_paid").in("status", ["issued", "partial"]),
  ]);

  const moneyOwed = ((invOwedRaw as { total: number; amount_paid: number }[] | null) ?? [])
    .reduce((a, i) => a + Math.max(0, Number(i.total) - Number(i.amount_paid || 0)), 0);

  // Fold manual invoices into the sales/sale-items sets as synthetic rows, so every metric below
  // (today's sales, 7-day trend, top products) counts them — every issued/non-void invoice counts as
  // Sales (matching the ledger); its inventory lines additionally feed top products.
  const invRows = (invRowsRaw as { id: string; total: number; issue_date: string }[] | null) ?? [];
  const invItems = (invItemsRaw as unknown as { invoice_id: string; product_id: string; quantity: number; unit_price: number; products: { name: string } | null }[] | null) ?? [];
  const invSales: Sale[] = invRows
    .map(i => ({ id: `inv-${i.id}`, total_amount: Number(i.total), created_at: new Date(i.issue_date + "T12:00:00").toISOString() }));
  const invSaleItems = invItems.map(r => ({ sale_id: `inv-${r.invoice_id}`, product_id: r.product_id, quantity: r.quantity, unit_price: r.unit_price, products: r.products }));
  const allSales: Sale[] = [...((sales as Sale[] | null) ?? []), ...invSales];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allSaleItems: any[] = [...((saleItems as any[] | null) ?? []), ...invSaleItems];

  // Money collected per payment method this month (one row per method, split-aware).
  const payments = paymentMethodBreakdown((((monthPayments as unknown) as Record<string, unknown>[] | null ?? [])).map(r => ({ method: String(r.method), amount: Number(r.amount) })));

  // Output VAT collected this calendar month (tax_amount postdates generated types).
  const vatThisMonth = ((monthSales as unknown as { tax_amount: number | null }[] | null) ?? [])
    .reduce((t, s) => t + Number(s.tax_amount || 0), 0);

  const nameById: Record<string, string> = {};
  for (const p of (profs as { id: string; owner_name: string | null }[] | null) ?? []) {
    if (p.owner_name) nameById[p.id] = p.owner_name;
  }

  const todays = allSales.filter(s => new Date(s.created_at) >= todayStart);

  // Money actually collected today: POS sales (paid in full at the till) + invoice payments taken
  // today. Distinct from "Today's Sales" (accrual revenue), so partial payments show up as cash in.
  const posTodayTotal = ((sales as Sale[] | null) ?? []).filter(s => new Date(s.created_at) >= todayStart).reduce((a, s) => a + Number(s.total_amount), 0);
  const invPayToday = ((invPaymentsRaw as { amount: number }[] | null) ?? []).reduce((a, p) => a + Number(p.amount), 0);
  const collectedToday = posTodayTotal + invPayToday;

  // 7-day trend
  const days: { day: string; total: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0, 0, 0, 0);
    const next = new Date(d); next.setDate(next.getDate() + 1);
    const total = allSales.filter(s => {
      const t = new Date(s.created_at);
      return t >= d && t < next;
    }).reduce((a, s) => a + Number(s.total_amount), 0);
    days.push({ day: d.toLocaleDateString("en", { weekday: "short" }), total });
  }

  // Top products today
  let topProducts: DashTopProduct[] = [];
  if (allSaleItems.length) {
    const todaySaleIds = new Set(todays.map(s => s.id));
    const map: Record<string, DashTopProduct> = {};
    for (const si of allSaleItems.filter(si => todaySaleIds.has(si.sale_id))) {
      const pid = si.product_id;
      const name = si.products?.name || "Unknown";
      if (!map[pid]) map[pid] = { product_id: pid, name, qty: 0, revenue: 0 };
      map[pid].qty += Number(si.quantity);
      map[pid].revenue += Number(si.quantity) * Number(si.unit_price);
    }
    topProducts = Object.values(map).sort((a, b) => b.qty - a.qty).slice(0, 5);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adjEntries: DashActivityEntry[] = (adjustments as any[] | null ?? []).map(a => {
    const name = a.products?.name || a.raw_materials?.name || "Item";
    const sign: DashActivityEntry["sign"] = Number(a.delta) >= 0 ? "pos" : "neg";
    return {
      id: a.id,
      ts: a.created_at,
      label: `${Number(a.delta) >= 0 ? "+" : ""}${a.delta} ${name}`,
      sub: a.reason || a.notes || "Stock adjusted",
      by: a.user_id ? nameById[a.user_id] : undefined,
      sign,
    };
  });
  type LogRow = { id: string; created_at: string; summary: string; actor_name: string | null };
  const logEntries: DashActivityEntry[] = ((activityLog as LogRow[] | null) ?? []).map(a => ({
    id: a.id, ts: a.created_at, label: a.summary, sub: "", by: a.actor_name ?? undefined, sign: "neu",
  }));
  const activity = [...adjEntries, ...logEntries].sort((x, y) => y.ts.localeCompare(x.ts));

  return {
    todaySales: salesRevenue(todays),
    salesCount: todays.length,
    collectedToday,
    moneyOwed,
    products: (prods as DashProduct[]) || [],
    openInvoices: openInvCount ?? 0,
    trend: days,
    topProducts,
    activity,
    vatThisMonth,
    payments,
  };
}
