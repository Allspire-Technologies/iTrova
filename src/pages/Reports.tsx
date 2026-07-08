import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCurrency } from "@/hooks/useCurrency";
import { Download, TrendingUp, ShoppingCart, Package, AlertTriangle, Truck, Users, ArrowUpRight, ArrowDownRight, ChevronLeft, ChevronRight, Wallet } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, AreaChart, Area, CartesianGrid } from "recharts";
import { toast } from "sonner";
import { ReportsChartSkeleton } from "@/components/Skeletons";
import {
  salesSummary,
  supplierSpendTotal,
  pctChange,
  outOfStockProducts,
  lowStockProducts,
  topProductsByRevenue,
  staffRevenue,
  productTurnover,
  supplierSpendRows as supplierSpendRowsOf,
} from "@/lib/reportMetrics";
import { netProfit, fetchExpensesForReport } from "@/lib/expenditure";

type Sale = { id: string; total_amount: number; created_at: string; staff_id?: string | null };
type SaleItem = { sale_id: string; product_id: string | null; quantity: number; unit_price: number };
type Product = { id: string; name: string; stock_quantity: number; reorder_level: number; cost_price: number | null; selling_price: number };
type MatPurchase = { supplier_id: string | null; total_cost: number; created_at: string };
type Supplier = { id: string; name: string };

function isoDate(d: Date) { return d.toISOString().slice(0, 10); }

export default function Reports() {
  const { business, hasModule } = useAuth();
  const { fmt } = useCurrency();
  const showExpenses = hasModule("expenditure");
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 29); return isoDate(d); });
  const [to, setTo] = useState(() => isoDate(new Date()));

  const [sales, setSales] = useState<Sale[]>([]);
  const [saleItems, setSaleItems] = useState<SaleItem[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [purchases, setPurchases] = useState<MatPurchase[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [staffProfiles, setStaffProfiles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [prevSales, setPrevSales] = useState<Sale[]>([]);
  const [prevSaleItems, setPrevSaleItems] = useState<SaleItem[]>([]);
  const [expensesTotal, setExpensesTotal] = useState(0);
  const [prevExpensesTotal, setPrevExpensesTotal] = useState(0);
  const [outOfStockPage, setOutOfStockPage] = useState(1);
  const [lowStockPage, setLowStockPage] = useState(1);
  const [turnoverPage, setTurnoverPage] = useState(1);
  const PAGE_SIZE = 5;

  useEffect(() => {
    if (!business) return;
    (async () => {
      setLoading(true);
      const fromIso = new Date(from + "T00:00:00").toISOString();
      const toIso = new Date(to + "T23:59:59").toISOString();
      const periodMs = new Date(toIso).getTime() - new Date(fromIso).getTime();
      const prevToIso = new Date(new Date(fromIso).getTime() - 1).toISOString();
      const prevFromIso = new Date(new Date(prevToIso).getTime() - periodMs).toISOString();

      const [s, p, pr, mp, sup, prevS, prof, exp] = await Promise.all([
        supabase.from("sales").select("id,total_amount,created_at,staff_id").eq("business_id", business.id).eq("voided", false).gte("created_at", fromIso).lte("created_at", toIso),
        supabase.from("products").select("id,name,stock_quantity,reorder_level,cost_price,selling_price").eq("business_id", business.id),
        // Only the items whose sale falls in the report window (previous period start → current
        // period end — the two ranges are adjacent). The !inner join makes the sales filters
        // restrictive server-side; before this, every sale_item ever was downloaded and filtered
        // in memory (audit F5).
        supabase.from("sale_items")
          .select("sale_id,product_id,quantity,unit_price,sales!inner(id)")
          .eq("sales.business_id", business.id)
          .eq("sales.voided", false)
          .gte("sales.created_at", prevFromIso)
          .lte("sales.created_at", toIso),
        supabase.from("material_purchases").select("supplier_id,total_cost,created_at").eq("business_id", business.id).gte("created_at", fromIso).lte("created_at", toIso),
        supabase.from("suppliers").select("id,name").eq("business_id", business.id),
        supabase.from("sales").select("id,total_amount").eq("business_id", business.id).eq("voided", false).gte("created_at", prevFromIso).lte("created_at", prevToIso),
        supabase.from("profiles").select("id,owner_name").eq("business_id", business.id),
        // Expenses across both periods (by expense_date); split in memory for the Net-profit change.
        showExpenses ? fetchExpensesForReport(business.id, prevFromIso.slice(0, 10), to) : Promise.resolve([]),
      ]);

      if (s.error) { toast.error("Failed to load sales data"); setLoading(false); return; }

      const salesData = (s.data as Sale[]) || [];
      const allSaleItems = (pr.data as SaleItem[]) || [];
      const saleIds = new Set(salesData.map(x => x.id));
      setSales(salesData);
      setProducts((p.data as Product[]) || []);
      setSaleItems(allSaleItems.filter(si => saleIds.has(si.sale_id)));
      setPurchases((mp.data as MatPurchase[]) || []);
      setSuppliers((sup.data as Supplier[]) || []);

      const profileMap: Record<string, string> = {};
      for (const row of (prof.data || []) as { id: string; owner_name: string | null }[]) {
        if (row.id && row.owner_name) profileMap[row.id] = row.owner_name;
      }
      setStaffProfiles(profileMap);

      const prevSalesData = (prevS.data as Sale[]) || [];
      const prevSaleIds = new Set(prevSalesData.map(x => x.id));
      setPrevSales(prevSalesData);
      setPrevSaleItems(allSaleItems.filter(si => prevSaleIds.has(si.sale_id)));

      // Split expenses into current (expense_date >= from) vs previous period.
      const expRows = exp as { expense_date: string; amount: number }[];
      setExpensesTotal(expRows.filter(e => e.expense_date >= from).reduce((t, e) => t + Number(e.amount || 0), 0));
      setPrevExpensesTotal(expRows.filter(e => e.expense_date < from).reduce((t, e) => t + Number(e.amount || 0), 0));

      setLoading(false);
    })();
  }, [business, from, to]);

  const totals = useMemo(() => {
    const base = salesSummary(sales, saleItems, products);
    return { ...base, supplierSpend: supplierSpendTotal(purchases), expenses: expensesTotal, netProfit: netProfit(base.grossProfit, expensesTotal) };
  }, [sales, saleItems, products, purchases, expensesTotal]);

  const dailyTrend = useMemo(() => {
    const map = new Map<string, number>();
    const start = new Date(from); const end = new Date(to);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      map.set(isoDate(d), 0);
    }
    sales.forEach(s => {
      const k = s.created_at.slice(0, 10);
      map.set(k, (map.get(k) || 0) + Number(s.total_amount));
    });
    return Array.from(map.entries()).map(([day, total]) => ({ day: day.slice(5), total }));
  }, [sales, from, to]);

  const topProducts = useMemo(() => topProductsByRevenue(saleItems, products), [saleItems, products]);

  const supplierSpendRows = useMemo(() => supplierSpendRowsOf(purchases, suppliers), [purchases, suppliers]);

  const outOfStock = useMemo(
    () => outOfStockProducts(products).sort((a, b) => a.name.localeCompare(b.name)),
    [products]
  );

  const lowStock = useMemo(
    () => lowStockProducts(products).sort((a, b) => Number(a.stock_quantity) - Number(b.stock_quantity)),
    [products]
  );

  const byStaff = useMemo(() => staffRevenue(sales, staffProfiles), [sales, staffProfiles]);

  const turnover = useMemo(() => productTurnover(saleItems, products), [saleItems, products]);

  const prevTotals = useMemo(() => {
    const base = salesSummary(prevSales, prevSaleItems, products);
    return { ...base, netProfit: netProfit(base.grossProfit, prevExpensesTotal) };
  }, [prevSales, prevSaleItems, products, prevExpensesTotal]);

  const pct = pctChange;

  const exportPdf = async () => {
    // jsPDF is heavy — load it only when the user actually exports (Experience Roadmap · Phase 1).
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
      import("jspdf"),
      import("jspdf-autotable"),
    ]);
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const M = 40; const w = doc.internal.pageSize.getWidth();
    doc.setFont("helvetica", "bold").setFontSize(20).text("Business Report", M, 56);
    doc.setFont("helvetica", "normal").setFontSize(10);
    doc.text(`${business?.name || ""}`, w - M, 56, { align: "right" });
    doc.text(`Period: ${from} → ${to}`, M, 74);

    autoTable(doc, {
      startY: 96,
      head: [["Metric", "Value"]],
      body: [
        ["Revenue", fmt(totals.revenue)],
        ["Transactions", String(totals.txns)],
        ["Average sale", fmt(totals.avg)],
        ["Units sold", String(totals.units)],
        ["COGS (estimate)", fmt(totals.cogs)],
        ["Gross profit (estimate)", fmt(totals.grossProfit)],
        ["Supplier spend", fmt(totals.supplierSpend)],
        ...(showExpenses ? [["Expenses", fmt(totals.expenses)], ["Net profit (estimate)", fmt(totals.netProfit)]] : []),
      ],
      styles: { fontSize: 10, cellPadding: 6 },
      headStyles: { fillColor: [30, 41, 59], textColor: 255 },
      margin: { left: M, right: M },
    });

    // @ts-expect-error lastAutoTable
    let y = doc.lastAutoTable.finalY + 20;
    doc.setFont("helvetica", "bold").setFontSize(12).text("Top products", M, y);
    autoTable(doc, {
      startY: y + 8,
      head: [["Product", "Qty", "Revenue"]],
      body: topProducts.map(p => [p.name, String(p.qty), fmt(p.revenue)]),
      styles: { fontSize: 10, cellPadding: 6 },
      headStyles: { fillColor: [30, 41, 59], textColor: 255 },
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" } },
      margin: { left: M, right: M },
    });

    // @ts-expect-error lastAutoTable
    y = doc.lastAutoTable.finalY + 20;
    doc.setFont("helvetica", "bold").setFontSize(12).text("Supplier spend", M, y);
    autoTable(doc, {
      startY: y + 8,
      head: [["Supplier", "Total"]],
      body: supplierSpendRows.map(r => [r.name, fmt(r.total)]),
      styles: { fontSize: 10, cellPadding: 6 },
      headStyles: { fillColor: [30, 41, 59], textColor: 255 },
      columnStyles: { 1: { halign: "right" } },
      margin: { left: M, right: M },
    });

    // @ts-expect-error lastAutoTable
    y = doc.lastAutoTable.finalY + 20;
    doc.setFont("helvetica", "bold").setFontSize(12).text("Out of stock", M, y);
    autoTable(doc, {
      startY: y + 8,
      head: [["Product", "Reorder at"]],
      body: outOfStock.length > 0 ? outOfStock.map(p => [p.name, String(p.reorder_level)]) : [["None", ""]],
      styles: { fontSize: 10, cellPadding: 6 },
      headStyles: { fillColor: [30, 41, 59], textColor: 255 },
      columnStyles: { 1: { halign: "right" } },
      margin: { left: M, right: M },
    });

    // @ts-expect-error lastAutoTable
    y = doc.lastAutoTable.finalY + 20;
    doc.setFont("helvetica", "bold").setFontSize(12).text("Low stock", M, y);
    autoTable(doc, {
      startY: y + 8,
      head: [["Product", "On hand", "Reorder at"]],
      body: lowStock.length > 0 ? lowStock.map(p => [p.name, String(p.stock_quantity), String(p.reorder_level)]) : [["None", "", ""]],
      styles: { fontSize: 10, cellPadding: 6 },
      headStyles: { fillColor: [30, 41, 59], textColor: 255 },
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" } },
      margin: { left: M, right: M },
    });

    if (byStaff.length > 0) {
      // @ts-expect-error lastAutoTable
      y = doc.lastAutoTable.finalY + 20;
      doc.setFont("helvetica", "bold").setFontSize(12).text("Sales by staff", M, y);
      autoTable(doc, {
        startY: y + 8,
        head: [["Staff member", "Revenue"]],
        body: byStaff.map(r => [r.name, fmt(r.revenue)]),
        styles: { fontSize: 10, cellPadding: 6 },
        headStyles: { fillColor: [30, 41, 59], textColor: 255 },
        columnStyles: { 1: { halign: "right" } },
        margin: { left: M, right: M },
      });
    }

    if (turnover.length > 0) {
      // @ts-expect-error lastAutoTable
      y = doc.lastAutoTable.finalY + 20;
      doc.setFont("helvetica", "bold").setFontSize(12).text("Inventory turnover", M, y);
      autoTable(doc, {
        startY: y + 8,
        head: [["Product", "Sold", "On hand", "Ratio"]],
        body: turnover.map(r => [r.name, String(r.sold), String(r.stock), r.rate != null ? r.rate.toFixed(2) + "×" : "∞"]),
        styles: { fontSize: 10, cellPadding: 6 },
        headStyles: { fillColor: [30, 41, 59], textColor: 255 },
        columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } },
        margin: { left: M, right: M },
      });
    }

    doc.save(`report_${from}_to_${to}.pdf`);
    toast.success("Report downloaded");
  };

  useEffect(() => {
    setOutOfStockPage(1);
    setLowStockPage(1);
    setTurnoverPage(1);
  }, [from, to]);

  const setPreset = (days: number) => {
    const end = new Date(); const start = new Date(); start.setDate(end.getDate() - (days - 1));
    setFrom(isoDate(start)); setTo(isoDate(end));
  };

  return (
    <div className="space-y-6 w-full">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl lg:text-4xl font-bold text-brand-dark">Reports</h1>
          <p className="text-muted-foreground mt-1">Track revenue, top products, supplier spend and stock health.</p>
        </div>
        <Button onClick={exportPdf} variant="hero" disabled={loading}><Download className="size-4" /> Export PDF</Button>
      </div>

      {/* Date range filter — always visible */}
      <Card className="shadow-card border-border/60">
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="from">From</Label>
            <Input id="from" type="date" value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="to">To</Label>
            <Input id="to" type="date" value={to} onChange={e => setTo(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setPreset(7)}>7d</Button>
            <Button size="sm" variant="outline" onClick={() => setPreset(30)}>30d</Button>
            <Button size="sm" variant="outline" onClick={() => setPreset(90)}>90d</Button>
          </div>
        </CardContent>
      </Card>

      {/* Loading skeleton */}
      {loading && <ReportsChartSkeleton />}

      {/* All data sections — hidden while loading */}
      {!loading && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Revenue" value={fmt(totals.revenue)} icon={TrendingUp} accent="brand" sub={`${totals.txns} sales`} change={pct(totals.revenue, prevTotals.revenue)} />
            <Metric label="Gross profit" value={fmt(totals.grossProfit)} icon={ShoppingCart} accent="dark" sub={`COGS ${fmt(totals.cogs)}`} change={pct(totals.grossProfit, prevTotals.grossProfit)} />
            <Metric label="Units sold" value={totals.units.toLocaleString()} icon={Package} accent="muted" sub={`Avg sale ${fmt(totals.avg)}`} change={pct(totals.units, prevTotals.units)} />
            <Metric label="Supplier spend" value={fmt(totals.supplierSpend)} icon={Truck} accent={totals.supplierSpend ? "warning" : "muted"} sub={`${supplierSpendRows.length} suppliers`} />
            {showExpenses && <Metric label="Expenses" value={fmt(totals.expenses)} icon={Wallet} accent={totals.expenses ? "warning" : "muted"} sub="This period" change={pct(totals.expenses, prevExpensesTotal)} />}
            {showExpenses && <Metric label="Net profit" value={fmt(totals.netProfit)} icon={TrendingUp} accent={totals.netProfit >= 0 ? "brand" : "danger"} sub="After expenses" change={pct(totals.netProfit, prevTotals.netProfit)} />}
          </div>

          <Card className="shadow-card border-border/60">
            <CardHeader><CardTitle className="font-display text-lg">Revenue trend</CardTitle></CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={dailyTrend}>
                    <defs>
                      <linearGradient id="r" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--brand))" stopOpacity={0.4}/>
                        <stop offset="100%" stopColor="hsl(var(--brand))" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }}
                      formatter={(v: number) => fmt(v)}
                    />
                    <Area type="monotone" dataKey="total" stroke="hsl(var(--brand))" strokeWidth={2.5} fill="url(#r)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="shadow-card border-border/60">
              <CardHeader><CardTitle className="font-display text-lg flex items-center gap-2"><AlertTriangle className="size-4 text-destructive" /> Out of stock</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {outOfStock.length === 0
                  ? <p className="text-sm text-muted-foreground">No products are out of stock.</p>
                  : outOfStock.slice((outOfStockPage - 1) * PAGE_SIZE, outOfStockPage * PAGE_SIZE).map(p => (
                    <div key={p.id} className="flex items-center justify-between p-2 rounded-lg bg-destructive/10 border border-destructive/20">
                      <div className="text-sm font-medium truncate">{p.name}</div>
                      <div className="text-destructive font-display font-bold text-sm">0 / {p.reorder_level}</div>
                    </div>
                  ))
                }
                <CardPager page={outOfStockPage} pageCount={Math.ceil(outOfStock.length / PAGE_SIZE)} onPage={setOutOfStockPage} />
              </CardContent>
            </Card>

            <Card className="shadow-card border-border/60">
              <CardHeader><CardTitle className="font-display text-lg flex items-center gap-2"><AlertTriangle className="size-4 text-warning" /> Low stock</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {lowStock.length === 0
                  ? <p className="text-sm text-muted-foreground">Nothing below reorder level.</p>
                  : lowStock.slice((lowStockPage - 1) * PAGE_SIZE, lowStockPage * PAGE_SIZE).map(p => (
                    <div key={p.id} className="flex items-center justify-between p-2 rounded-lg bg-warning/10 border border-warning/20">
                      <div className="text-sm font-medium truncate">{p.name}</div>
                      <div className="text-warning font-display font-bold text-sm">{p.stock_quantity} / {p.reorder_level}</div>
                    </div>
                  ))
                }
                <CardPager page={lowStockPage} pageCount={Math.ceil(lowStock.length / PAGE_SIZE)} onPage={setLowStockPage} />
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="shadow-card border-border/60">
              <CardHeader><CardTitle className="font-display text-lg">Top products by revenue</CardTitle></CardHeader>
              <CardContent>
                {topProducts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No sales in this period.</p>
                ) : (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={topProducts} layout="vertical" margin={{ left: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={(v) => fmt(v)} />
                        <YAxis type="category" dataKey="name" width={120} stroke="hsl(var(--muted-foreground))" fontSize={11} />
                        <Tooltip
                          contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }}
                          formatter={(v: number) => fmt(v)}
                        />
                        <Bar dataKey="revenue" fill="hsl(var(--brand))" radius={[0, 6, 6, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="shadow-card border-border/60">
              <CardHeader><CardTitle className="font-display text-lg">Supplier spend</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {supplierSpendRows.length === 0 && <p className="text-sm text-muted-foreground">No material purchases in this period.</p>}
                {supplierSpendRows.map((r, i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <div className="text-sm font-medium truncate">{r.name}</div>
                    <div className="font-display font-bold">{fmt(r.total)}</div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="shadow-card border-border/60">
              <CardHeader><CardTitle className="font-display text-lg flex items-center gap-2"><Users className="size-4 text-brand" /> Sales by staff</CardTitle></CardHeader>
              <CardContent>
                {byStaff.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No sales in this period.</p>
                ) : (
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={byStaff} layout="vertical" margin={{ left: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={(v) => fmt(v)} />
                        <YAxis type="category" dataKey="name" width={100} stroke="hsl(var(--muted-foreground))" fontSize={11} />
                        <Tooltip
                          contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }}
                          formatter={(v: number) => fmt(v)}
                        />
                        <Bar dataKey="revenue" fill="hsl(var(--brand))" radius={[0, 6, 6, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="shadow-card border-border/60">
              <CardHeader><CardTitle className="font-display text-lg flex items-center gap-2"><Package className="size-4 text-brand" /> Inventory turnover</CardTitle></CardHeader>
              <CardContent>
                {turnover.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No product sales in this period.</p>
                ) : (
                  <>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b">
                          <th className="pb-2 font-medium">Product</th>
                          <th className="pb-2 font-medium text-right">Sold</th>
                          <th className="pb-2 font-medium text-right">On hand</th>
                          <th className="pb-2 font-medium text-right">Ratio</th>
                        </tr>
                      </thead>
                      <tbody>
                        {turnover.slice((turnoverPage - 1) * PAGE_SIZE, turnoverPage * PAGE_SIZE).map((r, i) => (
                          <tr key={i} className="border-t">
                            <td className="py-2 truncate max-w-[140px]">{r.name}</td>
                            <td className="py-2 text-right">{r.sold}</td>
                            <td className="py-2 text-right">{r.stock}</td>
                            <td className="py-2 text-right font-medium text-brand">{r.rate != null ? r.rate.toFixed(2) + "×" : "∞"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <CardPager page={turnoverPage} pageCount={Math.ceil(turnover.length / PAGE_SIZE)} onPage={setTurnoverPage} />
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function CardPager({ page, pageCount, onPage }: { page: number; pageCount: number; onPage: (p: number) => void }) {
  if (pageCount <= 1) return null;
  return (
    <div className="flex items-center justify-between pt-3 mt-3 border-t border-border/40">
      <button
        onClick={() => onPage(page - 1)}
        disabled={page <= 1}
        className="size-7 rounded-lg flex items-center justify-center hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronLeft className="size-4" />
      </button>
      <span className="text-xs text-muted-foreground">{page} / {pageCount}</span>
      <button
        onClick={() => onPage(page + 1)}
        disabled={page >= pageCount}
        className="size-7 rounded-lg flex items-center justify-center hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}

function Metric({ label, value, icon: Icon, sub, accent, change }: { label: string; value: string; icon: any; sub?: string; accent: "brand" | "dark" | "warning" | "muted" | "danger"; change?: number | null }) {
  const accents = {
    brand: "bg-brand-light text-brand",
    dark: "bg-brand-dark/10 text-brand-dark",
    warning: "bg-warning/15 text-warning",
    muted: "bg-muted text-muted-foreground",
    danger: "bg-danger/10 text-danger",
  };
  return (
    <Card className="shadow-card border-border/60">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
            <div className="font-display text-2xl lg:text-3xl font-bold mt-2 text-brand-dark">{value}</div>
            {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
            {change != null && (
              <div className={`flex items-center gap-0.5 text-xs mt-1 ${change >= 0 ? "text-brand" : "text-danger"}`}>
                {change >= 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
                {Math.abs(change).toFixed(1)}% vs prev period
              </div>
            )}
          </div>
          <div className={`size-10 rounded-xl grid place-items-center ${accents[accent]}`}>
            <Icon className="size-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
