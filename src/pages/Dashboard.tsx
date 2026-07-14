import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCurrency } from "@/hooks/useCurrency";
import { useDateFormat } from "@/hooks/useDateFormat";
import { TrendingUp, Package, AlertTriangle, ShoppingBag, Sparkles, FileText, Clock, ArrowUpRight, ArrowDownRight, Receipt, Wallet } from "lucide-react";
import { DashboardSkeleton } from "@/components/Skeletons";
import { ResponsiveContainer, AreaChart, Area, XAxis, Tooltip, BarChart, Bar, Cell, YAxis, PieChart, Pie } from "recharts";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import Paginator, { usePagination } from "@/components/Paginator";
import OnboardingDialog from "@/components/OnboardingDialog";
import { outOfStockProducts, lowStockProducts, totalStockUnits as sumStockUnits, type PaymentMethodRow } from "@/lib/reportMetrics";
import { paymentLabel } from "@/lib/receipt";
import { useOnline } from "@/contexts/OnlineContext";
import { ReadOnlyOfflineNotice } from "@/components/OfflineBanner";
import { cacheDashboard, readCachedDashboard } from "@/lib/offlineStore";
import { fetchDashboardSnapshot, type DashSnap, type DashProduct as Product, type DashTopProduct as TopProduct, type DashActivityEntry as ActivityEntry } from "@/lib/dashboardSnapshot";

// Donut slice colours for the payment-methods breakdown — brand shades, cycled.
const PAY_COLORS = ["hsl(var(--brand))", "hsl(var(--brand) / 0.6)", "hsl(var(--brand) / 0.35)", "hsl(var(--muted-foreground) / 0.55)"];

export default function Dashboard() {
  const { business, profile, role, user } = useAuth();
  const { online } = useOnline();
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
  const [vatThisMonth, setVatThisMonth] = useState(0);
  const [payments, setPayments] = useState<PaymentMethodRow[]>([]);
  const [activityOpen, setActivityOpen] = useState(false);
  const showOnboarding = !!profile && profile.onboarded === false && role === "owner";

  // Silently mark invited staff as onboarded — they skip the owner setup flow
  useEffect(() => {
    if (profile && profile.onboarded === false && role && role !== "owner" && user) {
      // Best-effort: silently mark invited staff as onboarded; log if it fails.
      supabase.from("profiles").update({ onboarded: true }).eq("id", user.id)
        .then(({ error }) => { if (error) console.warn("onboarded update failed:", error.message); });
    }
  }, [profile, role, user]);

  const loadDashboard = useCallback(async () => {
    if (!business) return;
    if (!online) {
      // Offline: render the last-synced snapshot (read-only).
      const snap = (await readCachedDashboard(business.id)) as DashSnap | null;
      if (snap) {
        setTodaySales(snap.todaySales); setSalesCount(snap.salesCount); setProducts(snap.products);
        setOpenInvoices(snap.openInvoices); setTrend(snap.trend); setTopProducts(snap.topProducts); setActivity(snap.activity);
        setVatThisMonth(snap.vatThisMonth ?? 0);
        setPayments(snap.payments ?? []);
      }
      setLoading(false);
      return;
    }
    {
      const snap = await fetchDashboardSnapshot();
      setTodaySales(snap.todaySales); setSalesCount(snap.salesCount); setProducts(snap.products);
      setOpenInvoices(snap.openInvoices); setTrend(snap.trend); setTopProducts(snap.topProducts); setActivity(snap.activity);
      setVatThisMonth(snap.vatThisMonth);
      setPayments(snap.payments);
      setLoading(false);
      void cacheDashboard(business.id, snap); // read-only snapshot for offline
    }
  }, [business, online]);

  // Refetch on window focus only when the snapshot is stale (audit F5): alt-tabbing back and
  // forth used to re-download the whole dashboard every time, which hurts on flaky connections.
  const STALE_MS = 60_000;
  const lastLoadedAt = useRef(0);
  useEffect(() => {
    lastLoadedAt.current = Date.now();
    loadDashboard();
    const onFocus = () => {
      if (Date.now() - lastLoadedAt.current < STALE_MS) return;
      lastLoadedAt.current = Date.now();
      loadDashboard();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadDashboard]);

  const outOfStock = outOfStockProducts(products);
  const lowStock = lowStockProducts(products);
  const totalStockUnits = sumStockUnits(products);

  // Top 6 products by stock for bar chart
  const stockChart = [...products]
    .sort((a, b) => Number(b.stock_quantity) - Number(a.stock_quantity))
    .slice(0, 6)
    .map(p => ({
      name: p.name.length > 12 ? p.name.slice(0, 11) + "…" : p.name,
      stock: Number(p.stock_quantity),
      low: Number(p.stock_quantity) <= Number(p.reorder_level),
    }));

  const { paged: activityPaged, page, setPage, pageSize, setPageSize, pageCount, total } = usePagination(activity, 10);

  const renderActivityRow = (a: ActivityEntry) => {
    const when = fmtDateTime(a.ts, { dateStyle: "short", timeStyle: "short" });
    return (
      <div key={a.id} className="flex items-start gap-3 py-2 border-b border-border/50 last:border-0">
        <div className={`size-8 rounded-lg grid place-items-center shrink-0 ${
          a.sign === "pos" ? "bg-brand-light text-brand" : a.sign === "neg" ? "bg-danger/10 text-danger" : "bg-muted text-muted-foreground"
        }`}>
          {a.sign === "pos" ? <ArrowUpRight className="size-4" /> : a.sign === "neg" ? <ArrowDownRight className="size-4" /> : <FileText className="size-4" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-brand-dark truncate">{a.label}</div>
          <div className="text-xs text-muted-foreground truncate">{[a.sub, a.by && `by ${a.by}`].filter(Boolean).join(" · ")}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5 sm:hidden">{when}</div>
        </div>
        <div className="text-xs text-muted-foreground whitespace-nowrap shrink-0 hidden sm:block">{when}</div>
      </div>
    );
  };

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

      {/* Metrics — 2-up on phones so the KPIs stay scannable without a long scroll */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <MetricCard label="Today's Sales" value={fmt(todaySales)} icon={TrendingUp} accent="brand" sub={`${salesCount} transaction${salesCount === 1 ? "" : "s"}`} />
        <MetricCard label="Products in Stock" value={products.length.toString()} icon={Package} accent="dark" sub={`${totalStockUnits} units total`} />
        <MetricCard label="Stock Alerts" value={(outOfStock.length + lowStock.length).toString()} icon={AlertTriangle} accent={outOfStock.length ? "warning" : lowStock.length ? "warning" : "muted"} sub={outOfStock.length ? `${outOfStock.length} out of stock` : lowStock.length ? "Low stock items" : "All healthy"} />
        <MetricCard label="Open Invoices" value={openInvoices.toString()} icon={FileText} accent="muted" sub="draft & issued" />
        {business?.tax_enabled && <MetricCard label="VAT Collected" value={fmt(vatThisMonth)} icon={Receipt} accent="brand" sub="this month" />}
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
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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

      {/* Payment methods this month */}
      {payments.length > 0 && (
        <Card className="shadow-card border-border/60">
          <CardHeader>
            <CardTitle className="font-display text-lg flex items-center gap-2">
              <Wallet className="size-4 text-brand" /> Payment methods <span className="text-xs font-normal text-muted-foreground">· this month</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center gap-4 sm:flex-row">
              <div className="h-44 w-full sm:w-1/2">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={payments} dataKey="total" nameKey="method" innerRadius={42} outerRadius={68} paddingAngle={2}>
                      {payments.map((_, i) => <Cell key={i} fill={PAY_COLORS[i % PAY_COLORS.length]} />)}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }}
                      formatter={(v: number, n) => [fmt(v), paymentLabel(String(n))]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="w-full space-y-2 sm:w-1/2">
                {payments.map((r, i) => (
                  <div key={r.method} className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: PAY_COLORS[i % PAY_COLORS.length] }} />
                      <span className="truncate">{paymentLabel(r.method)}</span>
                    </span>
                    <span className="shrink-0 tabular-nums"><span className="font-medium text-brand-dark">{fmt(r.total)}</span> <span className="text-muted-foreground">· {r.pct}%</span></span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Activity feed + AI teaser */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Recent activity */}
        <Card className="lg:col-span-2 shadow-card border-border/60">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="font-display text-lg flex items-center gap-2">
              <Clock className="size-4 text-brand" /> Recent activity
            </CardTitle>
            {activity.length > 3 && (
              <Button variant="ghost" size="sm" className="text-xs" onClick={() => { setPage(1); setActivityOpen(true); }}>View all</Button>
            )}
          </CardHeader>
          <CardContent>
            {activity.length === 0 ? (
              <p className="text-sm text-muted-foreground">No recent activity yet.</p>
            ) : (
              <div className="space-y-2">
                {activity.slice(0, 3).map(renderActivityRow)}
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

      <Dialog open={activityOpen} onOpenChange={setActivityOpen}>
        <DialogContent variant="wide">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2"><Clock className="size-4 text-brand" /> Recent activity</DialogTitle>
          </DialogHeader>
          {activity.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No recent activity yet.</p>
          ) : (
            <>
              <div className="max-h-[55vh] overflow-y-auto pr-1">
                {activityPaged.map(renderActivityRow)}
              </div>
              <Paginator page={page} pageCount={pageCount} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={setPageSize} />
            </>
          )}
        </DialogContent>
      </Dialog>

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
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
            <div className="font-display text-xl sm:text-2xl lg:text-3xl font-bold mt-2 text-brand-dark break-words">{value}</div>
            {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
          </div>
          <div className={`size-9 sm:size-10 shrink-0 rounded-xl grid place-items-center ${accents[accent]}`}>
            <Icon className="size-4 sm:size-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
