import { supabase } from "@/integrations/supabase/client";
import { salesRevenue } from "@/lib/reportMetrics";

// Builds the read-only Dashboard snapshot from the same queries the Dashboard page runs.
// Shared so the page (online render) and the offline pre-warm cache identical data — no drift.

export type DashProduct = { id: string; name: string; stock_quantity: number; reorder_level: number; selling_price: number };
export type DashTopProduct = { product_id: string; name: string; qty: number; revenue: number };
export type DashActivityEntry = { id: string; ts: string; label: string; sub: string; by?: string; sign: "pos" | "neg" | "neu" };
export type DashSnap = {
  todaySales: number; salesCount: number; products: DashProduct[]; openInvoices: number;
  trend: { day: string; total: number }[]; topProducts: DashTopProduct[]; activity: DashActivityEntry[];
  vatThisMonth: number;
};

type Sale = { id: string; total_amount: number; created_at: string };

export async function fetchDashboardSnapshot(): Promise<DashSnap> {
  const since = new Date(); since.setDate(since.getDate() - 6); since.setHours(0, 0, 0, 0);
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

  const [
    { data: sales },
    { data: prods },
    { count: openInvCount },
    { data: saleItems },
    { data: adjustments },
    { data: activityLog },
    { data: profs },
    { data: monthSales },
  ] = await Promise.all([
    supabase.from("sales").select("id,total_amount,created_at").eq("voided", false).gte("created_at", since.toISOString()),
    supabase.from("products").select("id,name,stock_quantity,reorder_level,selling_price").order("created_at", { ascending: false }),
    supabase.from("invoices").select("id", { count: "exact", head: true }).in("status", ["draft", "issued"]),
    supabase.from("sale_items").select("sale_id, product_id, quantity, unit_price, products(name)"),
    supabase.from("stock_adjustments").select("id,created_at,delta,reason,notes,user_id,product_id,raw_material_id,products(name),raw_materials(name)").order("created_at", { ascending: false }).limit(50),
    supabase.from("activity_log").select("id,created_at,summary,actor_name").order("created_at", { ascending: false }).limit(50),
    supabase.from("profiles").select("id, owner_name"),
    supabase.from("sales").select("tax_amount").eq("voided", false).gte("created_at", monthStart.toISOString()),
  ]);

  // Output VAT collected this calendar month (tax_amount postdates generated types).
  const vatThisMonth = ((monthSales as unknown as { tax_amount: number | null }[] | null) ?? [])
    .reduce((t, s) => t + Number(s.tax_amount || 0), 0);

  const nameById: Record<string, string> = {};
  for (const p of (profs as { id: string; owner_name: string | null }[] | null) ?? []) {
    if (p.owner_name) nameById[p.id] = p.owner_name;
  }

  const todays = (sales as Sale[] | null)?.filter(s => new Date(s.created_at) >= todayStart) ?? [];

  // 7-day trend
  const days: { day: string; total: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0, 0, 0, 0);
    const next = new Date(d); next.setDate(next.getDate() + 1);
    const total = (sales as Sale[] | null)?.filter(s => {
      const t = new Date(s.created_at);
      return t >= d && t < next;
    }).reduce((a, s) => a + Number(s.total_amount), 0) || 0;
    days.push({ day: d.toLocaleDateString("en", { weekday: "short" }), total });
  }

  // Top products today
  let topProducts: DashTopProduct[] = [];
  if (saleItems) {
    const todaySaleIds = new Set(todays.map(s => s.id));
    const map: Record<string, DashTopProduct> = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const si of (saleItems as any[]).filter(si => todaySaleIds.has(si.sale_id))) {
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
    products: (prods as DashProduct[]) || [],
    openInvoices: openInvCount ?? 0,
    trend: days,
    topProducts,
    activity,
    vatThisMonth,
  };
}
