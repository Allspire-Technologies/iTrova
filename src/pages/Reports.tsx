import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import DatePicker from "@/components/DatePicker";
import { Label } from "@/components/ui/label";
import { useCurrency } from "@/hooks/useCurrency";
import { useDateFormat } from "@/hooks/useDateFormat";
import { Download, TrendingUp, ShoppingCart, Package, AlertTriangle, Truck, Users, ArrowUpRight, ArrowDownRight, ChevronLeft, ChevronRight, Wallet, Receipt, Info, Factory, Boxes } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, AreaChart, Area, CartesianGrid, PieChart, Pie, Cell } from "recharts";
import { paymentLabel } from "@/lib/receipt";
import { pdfMoneyFormatter } from "@/lib/pdf";
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
  paymentMethodBreakdown,
} from "@/lib/reportMetrics";
import { netProfit, fetchExpensesForReport } from "@/lib/expenditure";

type Sale = { id: string; total_amount: number; created_at: string; staff_id?: string | null; tax_amount?: number };
type SaleItem = { sale_id: string; product_id: string | null; quantity: number; unit_price: number };
type Product = { id: string; name: string; stock_quantity: number; reorder_level: number; cost_price: number | null; selling_price: number; tax_id?: string | null; archived_at?: string | null };
type MatPurchase = { supplier_id: string | null; total_cost: number; created_at: string; tax_amount?: number };
type Supplier = { id: string; name: string };

function isoDate(d: Date) { return d.toISOString().slice(0, 10); }

// A dated stock-in for the Stocking history section (manual adds, opening stock, PO receipts →
// stock_adjustments with delta > 0; raw-material purchases → material_purchases).
type StockInRow = { date: string; item: string; qty: number; source: string };
type ProdRun = {
  id: string; created_at: string;
  production_run_outputs: { quantity: number; products: { name: string } | null }[];
  production_run_materials: { quantity_used: number; raw_materials: { name: string } | null }[];
};

// Donut slice colours for the payment-methods breakdown — brand shades, cycled.
const PAY_COLORS = ["hsl(var(--brand))", "hsl(var(--brand) / 0.6)", "hsl(var(--brand) / 0.35)", "hsl(var(--muted-foreground) / 0.55)"];

export default function Reports() {
  const { business, hasModule, can, user, profile } = useAuth();
  const { fmt, currency } = useCurrency();
  const { fmtDate } = useDateFormat();
  const showExpenses = hasModule("expenditure");
  // The report is composed from the viewer's permissions: money metrics need reports.view_financials;
  // stock sections need inventory.view; production sections production.view. Without view_financials
  // the viewer gets a "My sales" report scoped to their own transactions.
  const seesFinancials = can("reports", "view_financials");
  const seesInventory = can("inventory", "view");
  const seesProduction = can("production", "view");
  const seesMaterials = can("raw_materials", "view");
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
  const [collectedTotal, setCollectedTotal] = useState(0); // cash actually received this period (POS + invoice payments)
  const [owedTotal, setOwedTotal] = useState(0); // outstanding receivables (unpaid invoice balances)
  const [prevExpensesTotal, setPrevExpensesTotal] = useState(0);
  const [inputVatTotal, setInputVatTotal] = useState(0);
  const [procurementVatTotal, setProcurementVatTotal] = useState(0); // input VAT from material purchases + received POs
  const [paymentLines, setPaymentLines] = useState<{ method: string; amount: number; staff: string }[]>([]); // per-method legs (sale_payments) in the window
  const [prodRuns, setProdRuns] = useState<ProdRun[]>([]);
  const [prodReqs, setProdReqs] = useState<{ status: string }[]>([]);
  const [rawMats, setRawMats] = useState<{ id: string; name: string; stock_quantity: number; reorder_level: number }[]>([]);
  const [stockIns, setStockIns] = useState<StockInRow[]>([]); // dated stock-ins (adjustments + raw purchases) in the window
  const [stockInPage, setStockInPage] = useState(1);
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

      const prevFromDate = prevFromIso.slice(0, 10);
      const [s, p, pr, mp, sup, prevS, prof, po, exp, sp, adj, mpi, invRes, invItemsRes, invPayRes, invOwedRes, prodRes, reqRes, rmRes] = await Promise.all([
        supabase.from("sales").select("id,total_amount,created_at,staff_id,tax_amount").eq("business_id", business.id).eq("voided", false).gte("created_at", fromIso).lte("created_at", toIso),
        // Keep ARCHIVED products here: their cost/name are needed for historical COGS + Top products.
        // Active-inventory views (out/low stock) filter archived out client-side below.
        supabase.from("products").select("id,name,stock_quantity,reorder_level,cost_price,selling_price,tax_id,archived_at").eq("business_id", business.id),
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
        supabase.from("material_purchases").select("supplier_id,total_cost,created_at,tax_amount").eq("business_id", business.id).gte("created_at", fromIso).lte("created_at", toIso),
        supabase.from("suppliers").select("id,name").eq("business_id", business.id),
        supabase.from("sales").select("id,total_amount").eq("business_id", business.id).eq("voided", false).gte("created_at", prevFromIso).lte("created_at", prevToIso),
        supabase.from("profiles").select("id,owner_name").eq("business_id", business.id),
        // Input VAT from received purchase orders in the window (material purchases carry theirs on mp).
        supabase.from("purchase_orders").select("tax_amount,created_at").eq("business_id", business.id).eq("status", "received").gte("created_at", fromIso).lte("created_at", toIso),
        // Expenses across both periods (by expense_date); split in memory for the Net-profit change.
        showExpenses ? fetchExpensesForReport(business.id, prevFromIso.slice(0, 10), to) : Promise.resolve([]),
        // Payment legs for sales in the window (one row per method) — powers the payment-methods card.
        // sale_payments postdates the generated types, so cast the client.
         
        supabase.from("sale_payments").select("method,amount,sales!inner(id,staff_id)").eq("sales.business_id", business.id).eq("sales.voided", false).gte("sales.created_at", fromIso).lte("sales.created_at", toIso),
        // Stocking history: stock-ins in the window. delta>0 covers manual adds, opening stock and
        // PO product receipts; raw-material purchases come from material_purchases. (stocked_date
        // postdates the generated types — read via the loosely-typed rows below.)
        supabase.from("stock_adjustments").select("delta,reason,created_at,stocked_date,products(name),raw_materials(name)").eq("business_id", business.id).gt("delta", 0).gte("created_at", fromIso).lte("created_at", toIso).order("created_at", { ascending: false }).limit(200),
        supabase.from("material_purchases").select("quantity,created_at,stocked_date,raw_materials(name)").eq("business_id", business.id).gte("created_at", fromIso).lte("created_at", toIso).order("created_at", { ascending: false }).limit(200),
        // Manual invoices that sell inventory count as sales (revenue + COGS + top products), on top of
        // POS sales. sale_id null excludes POS invoices (already counted via `sales`); void/draft excluded.
        // Fetched across both periods (by issue_date), split in memory like sale_items above.
        supabase.from("invoices").select("id,total,tax,issue_date,created_by")
          .eq("business_id", business.id).is("sale_id", null).not("status", "in", "(void,draft)")
          .gte("issue_date", prevFromDate).lte("issue_date", to),
        supabase.from("invoice_items").select("invoice_id,product_id,quantity,unit_price,invoices!inner(issue_date)")
          .eq("invoices.business_id", business.id).is("invoices.sale_id", null).not("invoices.status", "in", "(void,draft)")
          .not("product_id", "is", null)
          .gte("invoices.issue_date", prevFromDate).lte("invoices.issue_date", to),
        // Invoice payments received in the window — for the "Collected" figure (cash actually in).
        supabase.from("invoice_payments").select("amount").gte("created_at", fromIso).lte("created_at", toIso),
        // Outstanding receivables (money owed): unpaid balance on issued/part-paid invoices = A/R balance.
        supabase.from("invoices").select("total,amount_paid").eq("business_id", business.id).in("status", ["issued", "partial"]),
        // Production activity in the window (only when the viewer can see production).
        seesProduction
          ? supabase.from("production_runs").select("id,created_at,production_run_outputs(quantity,products(name)),production_run_materials(quantity_used,raw_materials(name))").eq("business_id", business.id).gte("created_at", fromIso).lte("created_at", toIso)
          : Promise.resolve({ data: [] }),
        seesProduction
          ? supabase.from("production_requisitions").select("status").eq("business_id", business.id).gte("created_at", fromIso).lte("created_at", toIso)
          : Promise.resolve({ data: [] }),
        seesMaterials
          ? supabase.from("raw_materials").select("id,name,stock_quantity,reorder_level").eq("business_id", business.id)
          : Promise.resolve({ data: [] }),
      ]);

      if (s.error) { toast.error("Failed to load sales data"); setLoading(false); return; }

      const salesData = (s.data as unknown as Sale[]) || []; // tax_amount postdates generated types
      const allSaleItems = (pr.data as SaleItem[]) || [];
      const saleIds = new Set(salesData.map(x => x.id));

      // Manual invoices → synthetic sales so all metrics count them (matching the accounting ledger,
      // which books every issued invoice as Sales). EVERY issued/non-void invoice's full total is
      // revenue (inventory, service, or legacy); its inventory lines (product_id set) additionally
      // drive COGS + top products. issue_date splits current vs previous period.
      const invRows = (invRes.data as unknown as { id: string; total: number; tax: number; issue_date: string; created_by: string | null }[]) || [];
      const invItemRows = (invItemsRes.data as unknown as { invoice_id: string; product_id: string; quantity: number; unit_price: number; invoices: { issue_date: string } }[]) || [];
      const invToSale = (i: typeof invRows[number]): Sale => ({ id: `inv-${i.id}`, total_amount: Number(i.total), created_at: new Date(i.issue_date + "T12:00:00").toISOString(), staff_id: i.created_by, tax_amount: Number(i.tax || 0) });
      const invToItem = (r: typeof invItemRows[number]): SaleItem => ({ sale_id: `inv-${r.invoice_id}`, product_id: r.product_id, quantity: Number(r.quantity), unit_price: Number(r.unit_price) });
      const invSalesCur = invRows.filter(i => i.issue_date >= from).map(invToSale);
      const invSalesPrev = invRows.filter(i => i.issue_date < from).map(invToSale);
      const invItemsCur = invItemRows.filter(r => r.invoices.issue_date >= from).map(invToItem);
      const invItemsPrev = invItemRows.filter(r => r.invoices.issue_date < from).map(invToItem);

      setSales([...salesData, ...invSalesCur]);
      // Collected = POS sales (paid at the till) + invoice payments received in the window. Distinct
      // from Revenue (accrual): a part-paid invoice's full value is Revenue, but only its payments here.
      const posRevenue = salesData.reduce((a, x) => a + Number(x.total_amount), 0);
      const invPaid = ((invPayRes.data as { amount: number }[] | null) ?? []).reduce((a, r) => a + Number(r.amount), 0);
      setCollectedTotal(posRevenue + invPaid);
      setOwedTotal(((invOwedRes.data as { total: number; amount_paid: number }[] | null) ?? [])
        .reduce((a, i) => a + Math.max(0, Number(i.total) - Number(i.amount_paid || 0)), 0));
      setProducts((p.data as unknown as Product[]) || []); // tax_id postdates generated types
      setSaleItems([...allSaleItems.filter(si => saleIds.has(si.sale_id)), ...invItemsCur]);
      setPurchases((mp.data as unknown as MatPurchase[]) || []); // tax_amount postdates generated types
      setSuppliers((sup.data as Supplier[]) || []);

      const profileMap: Record<string, string> = {};
      for (const row of (prof.data || []) as { id: string; owner_name: string | null }[]) {
        if (row.id && row.owner_name) profileMap[row.id] = row.owner_name;
      }
      setStaffProfiles(profileMap);

      const prevSalesData = (prevS.data as Sale[]) || [];
      const prevSaleIds = new Set(prevSalesData.map(x => x.id));
      setPrevSales([...prevSalesData, ...invSalesPrev]);
      setPrevSaleItems([...allSaleItems.filter(si => prevSaleIds.has(si.sale_id)), ...invItemsPrev]);

      // Split expenses into current (expense_date >= from) vs previous period.
      const expRows = exp as { expense_date: string; amount: number; tax_amount: number }[];
      const currentExp = expRows.filter(e => e.expense_date >= from);
      setExpensesTotal(currentExp.reduce((t, e) => t + Number(e.amount || 0), 0));
      setPrevExpensesTotal(expRows.filter(e => e.expense_date < from).reduce((t, e) => t + Number(e.amount || 0), 0));
      setInputVatTotal(currentExp.reduce((t, e) => t + Number(e.tax_amount || 0), 0)); // input VAT on expense bills

      // Input VAT on procurement: material purchases (window) + received POs (window).
      const matVat = ((mp.data as unknown as MatPurchase[]) || []).reduce((t, m) => t + Number(m.tax_amount || 0), 0);
      const poVat = ((po.data as unknown as { tax_amount: number }[]) || []).reduce((t, o) => t + Number(o.tax_amount || 0), 0);
      setProcurementVatTotal(matVat + poVat);

      setPaymentLines((((sp as { data?: unknown }).data ?? []) as Record<string, unknown>[]).map(r => ({
        method: String(r.method), amount: Number(r.amount),
        staff: String((r.sales as { staff_id?: string } | null)?.staff_id ?? ""),
      })));
      setProdRuns(((prodRes as { data?: unknown }).data ?? []) as ProdRun[]);
      setProdReqs(((reqRes as { data?: unknown }).data ?? []) as { status: string }[]);
      setRawMats(((rmRes as { data?: unknown }).data ?? []) as { id: string; name: string; stock_quantity: number; reorder_level: number }[]);

      // Stocking history — merge both sources, effective date = stocked_date or created_at.
      const eff = (r: Record<string, unknown>) => String((r.stocked_date as string) || (r.created_at as string)).slice(0, 10);
      const adjRows: StockInRow[] = (((adj as { data?: unknown }).data ?? []) as Record<string, unknown>[])
        .filter(r => Number(r.delta) > 0)
        .map(r => ({
          date: eff(r),
          item: (r.products as { name?: string } | null)?.name || (r.raw_materials as { name?: string } | null)?.name || "Item",
          qty: Number(r.delta),
          source: String(r.reason || "Adjustment"),
        }));
      const purRows: StockInRow[] = (((mpi as { data?: unknown }).data ?? []) as Record<string, unknown>[]).map(r => ({
        date: eff(r),
        item: (r.raw_materials as { name?: string } | null)?.name || "Raw material",
        qty: Number(r.quantity),
        source: "Raw material purchase",
      }));
      setStockIns([...adjRows, ...purRows].sort((a, b) => b.date.localeCompare(a.date)));
      setStockInPage(1);

      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business, from, to, seesProduction, seesMaterials]);

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

  // Active-inventory views exclude archived products (COGS/Top-products above still use the full list).
  const activeProducts = useMemo(() => products.filter(p => !p.archived_at), [products]);

  const outOfStock = useMemo(
    () => outOfStockProducts(activeProducts).sort((a, b) => a.name.localeCompare(b.name)),
    [activeProducts]
  );

  const lowStock = useMemo(
    () => lowStockProducts(activeProducts).sort((a, b) => Number(a.stock_quantity) - Number(b.stock_quantity)),
    [activeProducts]
  );

  const byStaff = useMemo(() => staffRevenue(sales, staffProfiles), [sales, staffProfiles]);
  const payMethods = useMemo(() => paymentMethodBreakdown(paymentLines), [paymentLines]);

  // "My sales" — the viewer's own transactions (shown when they lack view_financials).
  const mySales = useMemo(() => sales.filter(s => s.staff_id === user?.id), [sales, user?.id]);
  const myTotals = useMemo(() => {
    const ids = new Set(mySales.map(s => s.id));
    return salesSummary(mySales, saleItems.filter(i => ids.has(i.sale_id)), products);
  }, [mySales, saleItems, products]);
  const myPayMethods = useMemo(
    () => paymentMethodBreakdown(paymentLines.filter(l => l.staff === user?.id)),
    [paymentLines, user?.id]
  );
  const myTrend = useMemo(() => {
    const map = new Map<string, number>();
    const start = new Date(from); const end = new Date(to);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) map.set(isoDate(d), 0);
    mySales.forEach(s => { const k = s.created_at.slice(0, 10); map.set(k, (map.get(k) || 0) + Number(s.total_amount)); });
    return Array.from(map.entries()).map(([day, total]) => ({ day: day.slice(5), total }));
  }, [mySales, from, to]);

  // Production activity (shown to production.view holders).
  const prodStats = useMemo(() => {
    let units = 0, materialsUsed = 0;
    const byProduct = new Map<string, number>();
    const byMaterial = new Map<string, number>();
    for (const run of prodRuns) {
      for (const o of run.production_run_outputs ?? []) {
        units += Number(o.quantity);
        const name = o.products?.name || "Product";
        byProduct.set(name, (byProduct.get(name) || 0) + Number(o.quantity));
      }
      for (const m of run.production_run_materials ?? []) {
        materialsUsed += Number(m.quantity_used);
        const name = m.raw_materials?.name || "Material";
        byMaterial.set(name, (byMaterial.get(name) || 0) + Number(m.quantity_used));
      }
    }
    const top = (m: Map<string, number>) => Array.from(m.entries()).map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty).slice(0, 8);
    return {
      runs: prodRuns.length, units, materialsUsed,
      topProduced: top(byProduct), topMaterials: top(byMaterial),
      pendingReqs: prodReqs.filter(r => r.status === "pending").length,
      totalReqs: prodReqs.length,
    };
  }, [prodRuns, prodReqs]);
  const lowRawMats = useMemo(
    () => rawMats.filter(m => Number(m.stock_quantity) <= Number(m.reorder_level)).sort((a, b) => Number(a.stock_quantity) - Number(b.stock_quantity)),
    [rawMats]
  );

  const turnover = useMemo(() => productTurnover(saleItems, activeProducts), [saleItems, activeProducts]);

  const prevTotals = useMemo(() => {
    const base = salesSummary(prevSales, prevSaleItems, products);
    return { ...base, netProfit: netProfit(base.grossProfit, prevExpensesTotal) };
  }, [prevSales, prevSaleItems, products, prevExpensesTotal]);

  const pct = pctChange;

  // Net VAT (gated on tax_enabled): output = VAT charged on sales, input = VAT paid on expense bills.
  const taxEnabled = !!business?.tax_enabled;
  const vat = useMemo(() => {
    const output = sales.reduce((t, s) => t + Number(s.tax_amount || 0), 0);
    const taxMap = new Map(products.map(p => [p.id, p.tax_id]));
    let taxableSales = 0, exemptSales = 0;
    for (const si of saleItems) {
      const line = Number(si.quantity) * Number(si.unit_price);
      if (si.product_id && taxMap.get(si.product_id)) taxableSales += line;
      else exemptSales += line;
    }
    const input = inputVatTotal + procurementVatTotal; // expense bills + procurement (purchases + POs)
    return { output, input, net: output - input, taxableSales, exemptSales };
  }, [sales, saleItems, products, inputVatTotal, procurementVatTotal]);

  const exportPdf = async () => {
    // jsPDF is heavy — load it only when the user actually exports (Experience Roadmap · Phase 1).
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
      import("jspdf"),
      import("jspdf-autotable"),
    ]);
    // Shadow the on-screen formatter for the whole export: jsPDF's built-in Helvetica has no ₦
    // glyph (or ∞/→), so "₦45,000" prints as garbage in the file. Money in the PDF uses the same
    // ASCII currency-code style as the invoice PDFs; any future line added here is safe by default.
    const fmt = pdfMoneyFormatter(currency);

    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const M = 40; const w = doc.internal.pageSize.getWidth();
    // A cashier's export is their own report, and its title should say so — not "Business Report".
    doc.setFont("helvetica", "bold").setFontSize(20).text(seesFinancials ? "Business Report" : "My Sales Report", M, 56);
    doc.setFont("helvetica", "normal").setFontSize(10);
    doc.text(`${business?.name || ""}`, w - M, 56, { align: "right" });
    doc.text(`Period: ${from} to ${to}`, M, 74);
    if (!seesFinancials && profile?.owner_name) doc.text(profile.owner_name, w - M, 74, { align: "right" });

    const tableStyle = {
      styles: { fontSize: 10, cellPadding: 6 },
      headStyles: { fillColor: [30, 41, 59] as [number, number, number], textColor: 255 },
      margin: { left: M, right: M },
    };
    // autoTable's columnStyles aligns BODY cells only — the head row ignores it, which left "Value"/
    // "Amount"/"Share" floating mid-table above right-aligned numbers. The hook aligns the header
    // cell with its column so each label sits directly over its figures.
    const right = (...cols: number[]) => ({
      columnStyles: Object.fromEntries(cols.map(c => [c, { halign: "right" as const }])),
      didParseCell: (d: { section: string; column: { index: number }; cell: { styles: { halign?: string } } }) => {
        if (d.section === "head" && cols.includes(d.column.index)) d.cell.styles.halign = "right";
      },
    });

    // The PDF mirrors the on-screen composition: only sections the viewer can see are included.
    autoTable(doc, {
      startY: 96,
      head: [["Metric", "Value"]],
      ...right(1),   // numbers read from the decimal point; header aligns with them too
      body: seesFinancials ? [
        ["Revenue", fmt(totals.revenue)],
        ["Transactions", String(totals.txns)],
        ["Average sale", fmt(totals.avg)],
        ["Units sold", String(totals.units)],
        ["COGS (estimate)", fmt(totals.cogs)],
        ["Gross profit (estimate)", fmt(totals.grossProfit)],
        ["Supplier spend", fmt(totals.supplierSpend)],
        ...(showExpenses ? [["Expenses", fmt(totals.expenses)], ["Net profit (estimate)", fmt(totals.netProfit)]] : []),
        ...(taxEnabled ? [
          ["Taxable sales", fmt(vat.taxableSales)],
          ["Exempt sales", fmt(vat.exemptSales)],
          ["Output VAT", fmt(vat.output)],
          ["Input VAT", fmt(vat.input)],
          ["Net VAT payable", fmt(vat.net)],
        ] : []),
      ] : [
        ["My sales", fmt(myTotals.revenue)],
        ["Transactions", String(myTotals.txns)],
        ["Average sale", fmt(myTotals.avg)],
        ["Units sold", String(myTotals.units)],
      ],
      ...tableStyle,
    });

    // @ts-expect-error lastAutoTable
    let y = doc.lastAutoTable.finalY + 20;
    const section = (title: string, head: string[], body: (string | number)[][], rightCols: number[]) => {
      doc.setFont("helvetica", "bold").setFontSize(12).text(title, M, y);
      autoTable(doc, { startY: y + 8, head: [head], body, ...right(...rightCols), ...tableStyle });
      // @ts-expect-error lastAutoTable
      y = doc.lastAutoTable.finalY + 20;
    };

    if (seesFinancials) {
      section("Top products", ["Product", "Qty", "Revenue"], topProducts.map(p => [p.name, String(p.qty), fmt(p.revenue)]), [1, 2]);
      section("Supplier spend", ["Supplier", "Total"], supplierSpendRows.map(r => [r.name, fmt(r.total)]), [1]);
    }
    if (seesInventory) {
      section("Out of stock", ["Product", "Reorder at"], outOfStock.length > 0 ? outOfStock.map(p => [p.name, String(p.reorder_level)]) : [["None", ""]], [1]);
      section("Low stock", ["Product", "On hand", "Reorder at"], lowStock.length > 0 ? lowStock.map(p => [p.name, String(p.stock_quantity), String(p.reorder_level)]) : [["None", "", ""]], [1, 2]);
    }
    if (seesFinancials && byStaff.length > 0) {
      section("Sales by staff", ["Staff member", "Revenue"], byStaff.map(r => [r.name, fmt(r.revenue)]), [1]);
    }
    const pdfPayMethods = seesFinancials ? payMethods : myPayMethods;
    if (pdfPayMethods.length > 0) {
      section(seesFinancials ? "Payment methods" : "My payment methods", ["Method", "Amount", "Share"], pdfPayMethods.map(r => [paymentLabel(r.method), fmt(r.total), `${r.pct}%`]), [1, 2]);
    }
    if (seesInventory && turnover.length > 0) {
      // ASCII "x" and "Sold out" on purpose: the screen's × and ∞ aren't in the PDF font's charset.
      section("Inventory turnover", ["Product", "Sold", "On hand", "Ratio"], turnover.map(r => [r.name, String(r.sold), String(r.stock), r.rate != null ? r.rate.toFixed(2) + "x" : "Sold out"]), [1, 2, 3]);
    }
    if (seesProduction) {
      section("Production", ["Metric", "Value"], [
        ["Runs", String(prodStats.runs)],
        ["Units produced", String(prodStats.units)],
        ["Materials consumed", String(prodStats.materialsUsed)],
        ["Material requests", `${prodStats.totalReqs} (${prodStats.pendingReqs} pending)`],
      ], [1]);
      if (prodStats.topProduced.length > 0) {
        section("Top produced products", ["Product", "Qty"], prodStats.topProduced.map(r => [r.name, String(r.qty)]), [1]);
      }
    }

    doc.save(`${seesFinancials ? "business-report" : "my-sales-report"}_${from}_to_${to}.pdf`);
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
          <p className="text-muted-foreground mt-1">
            {seesFinancials ? "Track revenue, top products, supplier spend and stock health."
              : seesProduction ? "Track your sales and production activity."
              : "Track your own sales performance."}
          </p>
        </div>
        {can("reports", "export") && <Button onClick={exportPdf} variant="hero" disabled={loading}><Download className="size-4" /> Export PDF</Button>}
      </div>

      {/* Date range filter — always visible */}
      <Card className="shadow-card border-border/60">
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="from">From</Label>
            <DatePicker id="from" value={from} onChange={setFrom} className="w-40" />
          </div>
          <div>
            <Label htmlFor="to">To</Label>
            <DatePicker id="to" value={to} onChange={setTo} className="w-40" />
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
          {/* My sales — the scoped report for viewers without view_financials (e.g. cashiers). */}
          {!seesFinancials && (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Metric label="My sales" value={fmt(myTotals.revenue)} icon={TrendingUp} accent="brand" sub={`${myTotals.txns} sales`}
                  info="The value of sales you rang up in this period (POS sales and invoices you created)." />
                <Metric label="Transactions" value={myTotals.txns.toLocaleString()} icon={Receipt} accent="dark" sub="This period" />
                <Metric label="Units sold" value={myTotals.units.toLocaleString()} icon={Package} accent="muted" sub="Items across your sales" />
                <Metric label="Average sale" value={fmt(myTotals.avg)} icon={Wallet} accent="dark" sub="Per transaction" />
              </div>

              <Card className="shadow-card border-border/60">
                <CardHeader><CardTitle className="font-display text-lg">My sales trend</CardTitle></CardHeader>
                <CardContent>
                  <div className="h-64" role="img" aria-label="Area chart of your daily sales across the selected period">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={myTrend}>
                        <defs>
                          <linearGradient id="mr" x1="0" y1="0" x2="0" y2="1">
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
                        <Area type="monotone" dataKey="total" stroke="hsl(var(--brand))" strokeWidth={2.5} fill="url(#mr)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              {myPayMethods.length > 0 && (
                <Card className="shadow-card border-border/60">
                  <CardHeader><CardTitle className="font-display text-lg flex items-center gap-2"><Wallet className="size-4 text-brand" /> My payment methods</CardTitle></CardHeader>
                  <CardContent className="space-y-2">
                    {myPayMethods.map((r) => (
                      <div key={r.method} className="flex items-center justify-between gap-2 text-sm">
                        <span className="truncate">{paymentLabel(r.method)}</span>
                        <span className="shrink-0 tabular-nums"><span className="font-medium">{fmt(r.total)}</span> <span className="text-muted-foreground">· {r.pct}%</span></span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </>
          )}

          {seesFinancials && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Revenue" value={fmt(totals.revenue)} icon={TrendingUp} accent="brand" sub={`${totals.txns} sales`} change={pct(totals.revenue, prevTotals.revenue)}
              info="Sales recognised in this period: POS sales plus invoices, counted in full on the date they're issued — regardless of whether they've been paid yet (accrual)." />
            <Metric label="Collected" value={fmt(collectedTotal)} icon={Wallet} accent="dark" sub="Cash received"
              info="Cash actually received in this period: POS sales plus invoice deposits and balance payments. Payments here may settle invoices issued in an earlier period, so this won't equal Revenue." />
            <Metric label="Money owed" value={fmt(owedTotal)} icon={Receipt} accent={owedTotal ? "warning" : "muted"} sub="Unpaid invoices"
              info="Unpaid balance across all issued invoices as of now (your receivables) — a running total, not limited to this period. Equals the Accounts Receivable balance in your ledger." />
            <Metric label="Gross profit" value={fmt(totals.grossProfit)} icon={ShoppingCart} accent="dark" sub={`COGS ${fmt(totals.cogs)}`} change={pct(totals.grossProfit, prevTotals.grossProfit)}
              info="Revenue minus the cost of goods sold (COGS) for the products sold this period. Excludes operating expenses." />
            <Metric label="Units sold" value={totals.units.toLocaleString()} icon={Package} accent="muted" sub={`Avg sale ${fmt(totals.avg)}`} change={pct(totals.units, prevTotals.units)} />
            <Metric label="Supplier spend" value={fmt(totals.supplierSpend)} icon={Truck} accent={totals.supplierSpend ? "warning" : "muted"} sub={`${supplierSpendRows.length} suppliers`} />
            {showExpenses && <Metric label="Expenses" value={fmt(totals.expenses)} icon={Wallet} accent={totals.expenses ? "warning" : "muted"} sub="This period" change={pct(totals.expenses, prevExpensesTotal)} />}
            {showExpenses && <Metric label="Net profit" value={fmt(totals.netProfit)} icon={TrendingUp} accent={totals.netProfit >= 0 ? "brand" : "danger"} sub="After expenses" change={pct(totals.netProfit, prevTotals.netProfit)} />}
          </div>
          )}

          {seesFinancials && taxEnabled && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Output VAT" value={fmt(vat.output)} icon={Receipt} accent="brand" sub={`Taxable sales ${fmt(vat.taxableSales)}`} />
              <Metric label="Input VAT" value={fmt(vat.input)} icon={Wallet} accent={vat.input ? "warning" : "muted"} sub="Bills & purchases" />
              <Metric label="Net VAT payable" value={fmt(vat.net)} icon={Receipt} accent={vat.net > 0 ? "dark" : "brand"} sub="Output − input" />
              <Metric label="Exempt sales" value={fmt(vat.exemptSales)} icon={Package} accent="muted" sub="No VAT charged" />
            </div>
          )}

          {seesFinancials && (
          <Card className="shadow-card border-border/60">
            <CardHeader><CardTitle className="font-display text-lg">Revenue trend</CardTitle></CardHeader>
            <CardContent>
              <div className="h-64" role="img" aria-label="Area chart of daily sales revenue across the selected period">
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
          )}

          {seesInventory && (
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
          )}

          {seesFinancials && (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="shadow-card border-border/60">
              <CardHeader><CardTitle className="font-display text-lg">Top products by revenue</CardTitle></CardHeader>
              <CardContent>
                {topProducts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No sales in this period.</p>
                ) : (
                  <div className="h-64" role="img" aria-label="Horizontal bar chart of the top products ranked by revenue in the selected period">
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
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            {seesFinancials && (
            <Card className="shadow-card border-border/60">
              <CardHeader><CardTitle className="font-display text-lg flex items-center gap-2"><Users className="size-4 text-brand" /> Sales by staff</CardTitle></CardHeader>
              <CardContent>
                {byStaff.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No sales in this period.</p>
                ) : (
                  <div className="h-56" role="img" aria-label="Horizontal bar chart of sales revenue per staff member in the selected period">
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
            )}

            {seesInventory && (
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
            )}
          </div>

          {seesFinancials && (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="shadow-card border-border/60">
              <CardHeader><CardTitle className="font-display text-lg flex items-center gap-2"><Wallet className="size-4 text-brand" /> Payment methods</CardTitle></CardHeader>
              <CardContent>
                {payMethods.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No sales in this period.</p>
                ) : (
                  <div className="flex flex-col items-center gap-4 sm:flex-row">
                    <div className="h-48 w-full sm:w-1/2" role="img" aria-label="Donut chart of money collected by payment method in the selected period; the list beside it gives each method's amount and share">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={payMethods} dataKey="total" nameKey="method" innerRadius={45} outerRadius={72} paddingAngle={2}>
                            {payMethods.map((_, i) => <Cell key={i} fill={PAY_COLORS[i % PAY_COLORS.length]} />)}
                          </Pie>
                          <Tooltip
                            contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }}
                            formatter={(v: number, n) => [fmt(v), paymentLabel(String(n))]}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="w-full space-y-2 sm:w-1/2">
                      {payMethods.map((r, i) => (
                        <div key={r.method} className="flex items-center justify-between gap-2 text-sm">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="size-2.5 shrink-0 rounded-full" style={{ background: PAY_COLORS[i % PAY_COLORS.length] }} />
                            <span className="truncate">{paymentLabel(r.method)}</span>
                          </span>
                          <span className="shrink-0 tabular-nums"><span className="font-medium">{fmt(r.total)}</span> <span className="text-muted-foreground">· {r.pct}%</span></span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
          )}

          {/* Production activity — for production.view holders (e.g. a Production Manager role). */}
          {seesProduction && (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Metric label="Production runs" value={prodStats.runs.toLocaleString()} icon={Factory} accent="brand" sub="This period" />
                <Metric label="Units produced" value={prodStats.units.toLocaleString()} icon={Package} accent="dark" sub="Across all runs" />
                <Metric label="Materials consumed" value={prodStats.materialsUsed.toLocaleString()} icon={Boxes} accent="muted" sub="Total quantity used" />
                <Metric label="Material requests" value={prodStats.totalReqs.toLocaleString()} icon={Receipt} accent={prodStats.pendingReqs ? "warning" : "muted"} sub={`${prodStats.pendingReqs} pending`} />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card className="shadow-card border-border/60">
                  <CardHeader><CardTitle className="font-display text-lg flex items-center gap-2"><Factory className="size-4 text-brand" /> Top produced products</CardTitle></CardHeader>
                  <CardContent className="space-y-2">
                    {prodStats.topProduced.length === 0 && <p className="text-sm text-muted-foreground">No production runs in this period.</p>}
                    {prodStats.topProduced.map((r) => (
                      <div key={r.name} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                        <div className="text-sm font-medium truncate">{r.name}</div>
                        <div className="font-display font-bold text-sm">{r.qty.toLocaleString()}</div>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Card className="shadow-card border-border/60">
                  <CardHeader><CardTitle className="font-display text-lg flex items-center gap-2"><Boxes className="size-4 text-brand" /> Materials consumed</CardTitle></CardHeader>
                  <CardContent className="space-y-2">
                    {prodStats.topMaterials.length === 0 && <p className="text-sm text-muted-foreground">No materials were consumed in this period.</p>}
                    {prodStats.topMaterials.map((r) => (
                      <div key={r.name} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                        <div className="text-sm font-medium truncate">{r.name}</div>
                        <div className="font-display font-bold text-sm">{r.qty.toLocaleString()}</div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>

              {seesMaterials && lowRawMats.length > 0 && (
                <Card className="shadow-card border-border/60">
                  <CardHeader><CardTitle className="font-display text-lg flex items-center gap-2"><AlertTriangle className="size-4 text-warning" /> Low raw materials</CardTitle></CardHeader>
                  <CardContent className="space-y-2">
                    {lowRawMats.slice(0, 8).map((m) => (
                      <div key={m.id} className="flex items-center justify-between p-2 rounded-lg bg-warning/10 border border-warning/20">
                        <div className="text-sm font-medium truncate">{m.name}</div>
                        <div className="text-warning font-display font-bold text-sm">{m.stock_quantity} / {m.reorder_level}</div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </>
          )}

          {/* Stocking history — dated stock-ins (adds, opening stock, PO receipts, raw purchases). */}
          {seesInventory && (
          <Card className="shadow-card border-border/60">
            <CardHeader><CardTitle className="font-display text-lg flex items-center gap-2"><Package className="size-4 text-brand" /> Stocking history</CardTitle></CardHeader>
            <CardContent>
              {stockIns.length === 0 ? (
                <p className="text-sm text-muted-foreground">No stock was added in this period.</p>
              ) : (
                <>
                  <div className="divide-y divide-border/50">
                    {stockIns.slice((stockInPage - 1) * PAGE_SIZE, stockInPage * PAGE_SIZE).map((r, i) => (
                      <div key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <div className="min-w-0">
                          <div className="font-medium text-brand-dark truncate">{r.item}</div>
                          <div className="text-xs text-muted-foreground">{fmtDate(r.date)} · {r.source}</div>
                        </div>
                        <span className="shrink-0 font-medium tabular-nums text-brand">+{r.qty.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                  <CardPager page={stockInPage} pageCount={Math.ceil(stockIns.length / PAGE_SIZE)} onPage={setStockInPage} />
                </>
              )}
            </CardContent>
          </Card>
          )}
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

// A small info affordance for a metric whose meaning could be misread (e.g. accrual vs cash).
function InfoDot({ text, label }: { text: string; label: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="text-muted-foreground/70 hover:text-foreground transition-colors" aria-label={`What is ${label}?`}>
          <Info className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 text-left text-sm normal-case tracking-normal font-normal text-muted-foreground">
        {text}
      </PopoverContent>
    </Popover>
  );
}

function Metric({ label, value, icon: Icon, sub, accent, change, info }: { label: string; value: string; icon: any; sub?: string; accent: "brand" | "dark" | "warning" | "muted" | "danger"; change?: number | null; info?: string }) {
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
            <div className="flex items-center gap-1 text-xs uppercase tracking-wider text-muted-foreground font-medium">
              {label}
              {info && <InfoDot text={info} label={label} />}
            </div>
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
