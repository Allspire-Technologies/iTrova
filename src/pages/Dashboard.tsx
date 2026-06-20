import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCurrency } from "@/hooks/useCurrency";
import { useDateFormat } from "@/hooks/useDateFormat";
import { TrendingUp, Package, AlertTriangle, ShoppingBag, Sparkles, FileText, Clock, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { DashboardSkeleton } from "@/components/Skeletons";
import { ResponsiveContainer, AreaChart, Area, XAxis, Tooltip, BarChart, Bar, Cell, YAxis } from "recharts";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import OnboardingDialog from "@/components/OnboardingDialog";

type Sale = { id: string; total_amount: number; created_at: string };
type Product = { id: string; name: string; stock_quantity: number; reorder_level: number; selling_price: number };
type TopProduct = { product_id: string; name: string; qty: number; revenue: number };
type ActivityEntry = { id: string; ts: string; label: string; sub: string; sign: "pos" | "neg" | "neu" };

export default function Dashboard() {
  const { business, profile, role, user } = useAuth();
  const { fmt } = useCurrency();
  const { fmtDateTime } = useDateFormat();
  const [loading, setLoading] = useState(true);
  const [todaySales, setTodaySales] = useState(0);
  const [salesCount, setSalesCount] = useState(0);
  const [products, setProducts] = useState<Product[]>([]);
  const [openInvoices, setOpenInvoices] = useState(0);
  const [trend, setTrend] = useState<{ day: string; total: number }[]>([]);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const showOnboarding = !!profile && profile.onboarded === false && role === "owner";

  // Silently mark invited staff as onboarded — they skip the owner setup flow
  useEffect(() => {
    if (profile && profile.onboarded === false && role && role !== "owner" && user) {
      supabase.from("profiles").update({ onboarded: true }).eq("id", user.id).then();
    }
  }, [profile, role, user]);

  useEffect(() => {
    if (!business) return;
    (async () => {
      const since = new Date(); since.setDate(since.getDate() - 6); since.setHours(0, 0, 0, 0);
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

      const [
        { data: sales },
        { data: prods },
        { count: openInvCount },
        { data: saleItems },
        { data: adjustments },
      ] = await Promise.all([
        supabase.from("sales").select("id,total_amount,created_at").gte("created_at", since.toISOString()),
        supabase.from("products").select("id,name,stock_quantity,reorder_level,selling_price").order("created_at", { ascending: false }),
        supabase.from("invoices").select("id", { count: "exact", head: true }).in("status", ["draft", "issued"]),
        supabase.from("sale_items").select("sale_id, product_id, quantity, unit_price, products(name)"),
        supabase.from("stock_adjustments").select("id,created_at,delta,reason,notes,product_id,raw_material_id,products(name),raw_materials(name)").order("created_at", { ascending: false }).limit(10),
      ]);

      // Today's sales metrics
      const todays = (sales as Sale[] | null)?.filter(s => new Date(s.created_at) >= todayStart) ?? [];
      setTodaySales(todays.reduce((a, s) => a + Number(s.total_amount), 0));
      setSalesCount(todays.length);
      setProducts((prods as Product[]) || []);
      setOpenInvoices(openInvCount ?? 0);

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
      setTrend(days);

      // Top products today from sale_items — filter by today's sale IDs
      if (saleItems) {
        const todaySaleIds = new Set(todays.map(s => s.id));
        const map: Record<string, TopProduct> = {};
        for (const si of (saleItems as any[]).filter(si => todaySaleIds.has(si.sale_id))) {
          const pid = si.product_id;
          const name = si.products?.name || "Unknown";
          if (!map[pid]) map[pid] = { product_id: pid, name, qty: 0, revenue: 0 };
          map[pid].qty += Number(si.quantity);
          map[pid].revenue += Number(si.quantity) * Number(si.unit_price);
        }
        const sorted = Object.values(map).sort((a, b) => b.qty - a.qty).slice(0, 5);
        setTopProducts(sorted);
      }

      // Activity feed from stock_adjustments
      if (adjustments) {
        const entries: ActivityEntry[] = (adjustments as any[]).map(a => {
          const name = a.products?.name || a.raw_materials?.name || "Item";
          const sign = Number(a.delta) >= 0 ? "pos" : "neg";
          return {
            id: a.id,
            ts: a.created_at,
            label: `${Number(a.delta) >= 0 ? "+" : ""}${a.delta} ${name}`,
            sub: a.reason || a.notes || "Stock adjusted",
            sign,
          };
        });
        setActivity(entries);
      }
      setLoading(false);
    })();
  }, [business]);

  const outOfStock = products.filter(p => Number(p.stock_quantity) === 0);
  const lowStock = products.filter(p => Number(p.stock_quantity) > 0 && Number(p.stock_quantity) <= Number(p.reorder_level));
  const totalStockUnits = products.reduce((a, p) => a + Number(p.stock_quantity), 0);

  // Top 6 products by stock for bar chart
  const stockChart = [...products]
    .sort((a, b) => Number(b.stock_quantity) - Number(a.stock_quantity))
    .slice(0, 6)
    .map(p => ({
      name: p.name.length > 12 ? p.name.slice(0, 11) + "…" : p.name,
      stock: Number(p.stock_quantity),
      low: Number(p.stock_quantity) <= Number(p.reorder_level),
    }));

  if (loading) return <DashboardSkeleton />;

  return (
    <div className="space-y-6 w-full">
      {/* Greeting */}
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl lg:text-4xl font-bold text-brand-dark">
            Good day, {profile?.owner_name?.split(" ")[0] || "Owner"} 👋
          </h1>
          <p className="text-muted-foreground mt-1">Here's what's happening across your business today.</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="soft"><Link to="/inventory">Add product</Link></Button>
          <Button asChild variant="hero"><Link to="/pos">Open POS</Link></Button>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Today's Sales" value={fmt(todaySales)} icon={TrendingUp} accent="brand" sub={`${salesCount} transaction${salesCount === 1 ? "" : "s"}`} />
        <MetricCard label="Products in Stock" value={products.length.toString()} icon={Package} accent="dark" sub={`${totalStockUnits} units total`} />
        <MetricCard label="Stock Alerts" value={(outOfStock.length + lowStock.length).toString()} icon={AlertTriangle} accent={outOfStock.length ? "warning" : lowStock.length ? "warning" : "muted"} sub={outOfStock.length ? `${outOfStock.length} out of stock` : lowStock.length ? "Low stock items" : "All healthy"} />
        <MetricCard label="Open Invoices" value={openInvoices.toString()} icon={FileText} accent="muted" sub="draft & issued" />
      </div>

      {/* Chart */}
      <Card className="shadow-card border-border/60">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="font-display text-lg">Sales · last 7 days</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">Total revenue per day</p>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend}>
                <defs>
                  <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--brand))" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="hsl(var(--brand))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }}
                  formatter={(v: number) => fmt(v)}
                />
                <Area type="monotone" dataKey="total" stroke="hsl(var(--brand))" strokeWidth={2.5} fill="url(#g)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Stock alerts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="shadow-card border-border/60">
          <CardHeader>
            <CardTitle className="font-display text-lg flex items-center gap-2">
              <AlertTriangle className="size-4 text-destructive" /> Out of stock
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {outOfStock.length === 0 ? (
              <p className="text-sm text-muted-foreground">No products are out of stock.</p>
            ) : (
              outOfStock.slice(0, 5).map(p => (
                <div key={p.id} className="flex items-center justify-between p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                  <div className="min-w-0">
                    <div className="font-medium truncate text-sm">{p.name}</div>
                    <div className="text-xs text-muted-foreground">Reorder at {p.reorder_level}</div>
                  </div>
                  <div className="text-destructive font-display font-bold">0</div>
                </div>
              ))
            )}
            {outOfStock.length > 5 && (
              <p className="text-xs text-muted-foreground text-center pt-1">+{outOfStock.length - 5} more · <Link to="/inventory?status=out_of_stock" className="underline">View all</Link></p>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-card border-border/60">
          <CardHeader>
            <CardTitle className="font-display text-lg flex items-center gap-2">
              <AlertTriangle className="size-4 text-warning" /> Low stock
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {lowStock.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing below reorder level.</p>
            ) : (
              lowStock.slice(0, 5).map(p => (
                <div key={p.id} className="flex items-center justify-between p-3 rounded-lg bg-warning/10 border border-warning/20">
                  <div className="min-w-0">
                    <div className="font-medium truncate text-sm">{p.name}</div>
                    <div className="text-xs text-muted-foreground">Reorder at {p.reorder_level}</div>
                  </div>
                  <div className="text-warning font-display font-bold">{p.stock_quantity}</div>
                </div>
              ))
            )}
            {lowStock.length > 5 && (
              <p className="text-xs text-muted-foreground text-center pt-1">+{lowStock.length - 5} more · <Link to="/inventory?status=low_stock" className="underline">View all</Link></p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top Products + Stock Chart */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Top selling products today */}
        <Card className="shadow-card border-border/60">
          <CardHeader>
            <CardTitle className="font-display text-lg flex items-center gap-2">
              <ShoppingBag className="size-4 text-brand" /> Top products today
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topProducts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sales recorded yet today.</p>
            ) : (
              <div className="space-y-3">
                {topProducts.map((p, i) => (
                  <div key={p.product_id} className="flex items-center gap-3">
                    <div className="size-7 rounded-lg bg-brand-light text-brand grid place-items-center text-xs font-bold shrink-0">
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-brand-dark truncate">{p.name}</div>
                      <div className="text-xs text-muted-foreground">{p.qty} unit{p.qty === 1 ? "" : "s"} sold</div>
                    </div>
                    <div className="font-display font-semibold text-sm text-brand-dark">{fmt(p.revenue)}</div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Stock level bar chart */}
        <Card className="shadow-card border-border/60">
          <CardHeader>
            <CardTitle className="font-display text-lg flex items-center gap-2">
              <Package className="size-4 text-brand" /> Stock levels
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stockChart.length === 0 ? (
              <p className="text-sm text-muted-foreground">No products in inventory yet.</p>
            ) : (
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stockChart} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }}
                      formatter={(v: number) => [`${v} units`, "Stock"]}
                    />
                    <Bar dataKey="stock" radius={[4, 4, 0, 0]}>
                      {stockChart.map((entry, index) => (
                        <Cell key={index} fill={entry.low ? "hsl(var(--warning))" : "hsl(var(--brand))"} fillOpacity={0.8} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Activity feed + AI teaser */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Recent activity */}
        <Card className="lg:col-span-2 shadow-card border-border/60">
          <CardHeader>
            <CardTitle className="font-display text-lg flex items-center gap-2">
              <Clock className="size-4 text-brand" /> Recent activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activity.length === 0 ? (
              <p className="text-sm text-muted-foreground">No stock adjustments recorded yet.</p>
            ) : (
              <div className="space-y-2">
                {activity.slice(0, 3).map(a => (
                  <div key={a.id} className="flex items-center gap-3 py-2 border-b border-border/50 last:border-0">
                    <div className={`size-8 rounded-lg grid place-items-center shrink-0 ${
                      a.sign === "pos" ? "bg-brand-light text-brand" : "bg-danger/10 text-danger"
                    }`}>
                      {a.sign === "pos" ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-brand-dark truncate">{a.label}</div>
                      <div className="text-xs text-muted-foreground truncate">{a.sub}</div>
                    </div>
                    <div className="text-xs text-muted-foreground whitespace-nowrap">
                      {fmtDateTime(a.ts, { dateStyle: "short", timeStyle: "short" })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* AI insight teaser */}
        <Card className="bg-gradient-brand text-brand-foreground shadow-brand border-0">
          <CardContent className="p-6 flex flex-col gap-4 h-full justify-between">
            <div className="flex items-start gap-4">
              <div className="size-10 rounded-xl bg-brand-foreground/15 grid place-items-center shrink-0">
                <Sparkles className="size-5" />
              </div>
              <div>
                <div className="font-display font-bold text-lg">AI Business Insights</div>
                <p className="text-brand-foreground/80 text-sm mt-1">
                  Get tailored recommendations on what to restock, your top products, and Nigerian market trends.
                </p>
              </div>
            </div>
            <div className="space-y-2 text-sm text-brand-foreground/80">
              <div className="p-2.5 rounded-lg bg-brand-foreground/10 cursor-pointer hover:bg-brand-foreground/20 transition-colors">
                "What should I restock?"
              </div>
              <div className="p-2.5 rounded-lg bg-brand-foreground/10 cursor-pointer hover:bg-brand-foreground/20 transition-colors">
                "Which supplier gives the best value?"
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <OnboardingDialog open={showOnboarding} onClose={() => { /* refresh handled in dialog */ }} />
    </div>
  );
}

function MetricCard({ label, value, icon: Icon, sub, accent }: { label: string; value: string; icon: any; sub?: string; accent: "brand" | "dark" | "warning" | "muted" }) {
  const accents = {
    brand: "bg-brand-light text-brand",
    dark: "bg-brand-dark/10 text-brand-dark",
    warning: "bg-warning/15 text-warning",
    muted: "bg-muted text-muted-foreground",
  };
  return (
    <Card className="shadow-card border-border/60 hover:shadow-elevated transition-shadow">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
            <div className="font-display text-2xl lg:text-3xl font-bold mt-2 text-brand-dark">{value}</div>
            {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
          </div>
          <div className={`size-10 rounded-xl grid place-items-center ${accents[accent]}`}>
            <Icon className="size-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
