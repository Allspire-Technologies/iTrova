import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/hooks/useCurrency";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import DatePicker from "@/components/DatePicker";
import CashFlowTab from "@/components/accounting/CashFlowTab";
import BalanceSheetTab from "@/components/accounting/BalanceSheetTab";
import { TablePageSkeleton } from "@/components/Skeletons";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Calculator, FileDown, Download, Info, TriangleAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { downloadCsv } from "@/lib/csv";
import { loadPdf } from "@/lib/pdf";
import { listExpenses } from "@/lib/expenditure";
import {
  buildPnl, revenueNetOfVat, computeCogs, itemsMissingCost, expenseLinesNetOfVat, pctChange,
  type PnlStatement, type CostedSaleItem, type InvoiceLike,
} from "@/lib/profitLoss";

const todayStr = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

// ASCII currency code for the PDF (jsPDF core fonts can't render ₦ — see lib/pdf pdfMoneyFormatter).
function pdfMoney(currency?: string): (n: number) => string {
  const code = (currency || "NGN").toUpperCase();
  try {
    const nf = new Intl.NumberFormat("en-US", { style: "currency", currency: code, currencyDisplay: "code", minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (n) => nf.format(Number(n) || 0);
  } catch {
    return (n) => `${code} ${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}

type Empty = null;

export default function Accounting() {
  const { business, can, role } = useAuth();
  const { fmt } = useCurrency();
  const canExport = can("accounting", "export");
  const isOwner = role === "owner";

  const [tab, setTab] = useState<"pnl" | "balance" | "cashflow">("pnl");
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(todayStr());
  const [loading, setLoading] = useState(true);
  const [cur, setCur] = useState<PnlStatement | Empty>(null);
  const [prev, setPrev] = useState<PnlStatement | Empty>(null);
  const [missingUnits, setMissingUnits] = useState(0);

  // Previous period = the same number of days immediately before `from` (for the comparison column).
  const { prevFrom, prevTo } = useMemo(() => {
    const dayMs = 86_400_000;
    const fromD = new Date(from + "T00:00:00");
    const toD = new Date(to + "T00:00:00");
    const len = Math.max(1, Math.round((toD.getTime() - fromD.getTime()) / dayMs) + 1);
    const pTo = new Date(fromD.getTime() - dayMs);
    const pFrom = new Date(pTo.getTime() - (len - 1) * dayMs);
    return { prevFrom: pFrom.toISOString().slice(0, 10), prevTo: pTo.toISOString().slice(0, 10) };
  }, [from, to]);

  const load = useCallback(async () => {
    if (!business) return;
    setLoading(true);
    const bid = business.id;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const iso = (d: string, end = false) => `${d}T${end ? "23:59:59.999" : "00:00:00"}`;
    const invQ = (f: string, t: string) => supabase.from("invoices")
      .select("total,tax,status,issue_date").eq("business_id", bid)
      .in("status", ["issued", "partial", "paid"]).gte("issue_date", f).lte("issue_date", t);
    const siQ = (f: string, t: string) => sb.from("sale_items")
      .select("product_id,quantity,unit_cost,sales!inner(id)")
      .eq("sales.business_id", bid).eq("sales.voided", false)
      .gte("sales.created_at", iso(f)).lte("sales.created_at", iso(t, true));
    try {
      const [invCur, invPrev, siCur, siPrev, prodRes, expCur, expPrev] = await Promise.all([
        invQ(from, to), invQ(prevFrom, prevTo), siQ(from, to), siQ(prevFrom, prevTo),
        supabase.from("products").select("id,cost_price").eq("business_id", bid),
        listExpenses(from, to), listExpenses(prevFrom, prevTo),
      ]);
      const products = (prodRes.data ?? []) as { id: string; cost_price?: number | null }[];
      const curItems = (siCur.data ?? []) as unknown as CostedSaleItem[];
      const build = (inv: unknown, items: unknown, exp: { category: string; amount: number; tax_amount: number }[]) => buildPnl({
        revenue: revenueNetOfVat((inv ?? []) as InvoiceLike[]),
        cogs: computeCogs((items ?? []) as CostedSaleItem[], products),
        expenses: expenseLinesNetOfVat(exp),
      });
      setCur(build(invCur.data, siCur.data, expCur));
      setPrev(build(invPrev.data, siPrev.data, expPrev));
      setMissingUnits(itemsMissingCost(curItems, products));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't build the statement");
    } finally {
      setLoading(false);
    }
  }, [business, from, to, prevFrom, prevTo]);

  useEffect(() => { load(); }, [load]);

  // Statement rows (shared by the on-screen table + PDF/CSV export).
  const rows = useMemo(() => {
    if (!cur) return [];
    const prevExp = new Map((prev?.expenses ?? []).map((e) => [e.category, e.amount]));
    type Row = { label: string; c: number; p: number; kind: "line" | "sub" | "total" | "exp" | "head"; margin?: number | null; mPrev?: number | null };
    const r: Row[] = [
      { label: "Revenue (net of VAT)", c: cur.revenue, p: prev?.revenue ?? 0, kind: "line" },
      { label: "Cost of goods sold", c: -cur.cogs, p: -(prev?.cogs ?? 0), kind: "line" },
      { label: "Gross profit", c: cur.grossProfit, p: prev?.grossProfit ?? 0, kind: "sub", margin: cur.grossMargin, mPrev: prev?.grossMargin ?? null },
      { label: "Operating expenses", c: 0, p: 0, kind: "head" },
      ...cur.expenses.map((e): Row => ({ label: e.category, c: -e.amount, p: -(prevExp.get(e.category) ?? 0), kind: "exp" })),
      { label: "Total operating expenses", c: -cur.totalExpenses, p: -(prev?.totalExpenses ?? 0), kind: "sub" },
      { label: "Net profit", c: cur.netProfit, p: prev?.netProfit ?? 0, kind: "total", margin: cur.netMargin, mPrev: prev?.netMargin ?? null },
    ];
    return r;
  }, [cur, prev]);

  const periodLabel = `${from} to ${to}`;

  const exportCsv = () => {
    const head = ["Line", "This period", "Previous period"];
    const body = rows.filter(r => r.kind !== "head").map(r => [r.label, String(r.c), String(r.p)]);
    const csv = [head, ...body].map(cols => cols.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    downloadCsv(`profit-and-loss-${from}_${to}.csv`, csv);
    toast.success("P&L exported");
  };

  const exportPdf = async () => {
    try {
      const { jsPDF, autoTable } = await loadPdf();
      const money = pdfMoney(business?.currency ?? undefined);
      const doc = new jsPDF();
      doc.setFontSize(16); doc.text(business?.name || "Profit & Loss", 14, 18);
      doc.setFontSize(11); doc.setTextColor(110);
      doc.text(`Profit & Loss · ${periodLabel}`, 14, 25);
      doc.setTextColor(0);
      autoTable(doc, {
        startY: 32,
        head: [["", "This period", "Previous"]],
        body: rows.filter(r => r.kind !== "head").map(r => [
          (r.kind === "exp" ? "   " : "") + r.label + (r.margin != null ? `  (${r.margin}% margin)` : ""),
          money(r.c), money(r.p),
        ]),
        columnStyles: { 1: { halign: "right" }, 2: { halign: "right" } },
        theme: "plain", headStyles: { fillColor: [22, 101, 52], textColor: 255 },
        didParseCell: (d) => { if (d.section === "body" && ["Gross profit", "Net profit", "Total operating expenses"].includes(rows.filter(r => r.kind !== "head")[d.row.index]?.label)) d.cell.styles.fontStyle = "bold"; },
      });
      doc.save(`profit-and-loss-${from}_${to}.pdf`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't build the PDF");
    }
  };

  const Change = ({ c, p, good = true }: { c: number; p: number; good?: boolean }) => {
    const pct = pctChange(c, p);
    if (pct === null) return <span className="text-muted-foreground">—</span>;
    const up = pct >= 0;
    const positive = good ? up : !up;
    return <span className={cn("tabular-nums", positive ? "text-brand" : "text-danger")}>{up ? "+" : ""}{pct.toFixed(1)}%</span>;
  };

  const Amount = ({ n }: { n: number }) => (
    <span className={cn("tabular-nums", n < 0 && "text-muted-foreground")}>{n < 0 ? `(${fmt(Math.abs(n))})` : fmt(n)}</span>
  );

  const TABS = [{ k: "pnl", l: "Profit & Loss" }, { k: "balance", l: "Balance Sheet" }, { k: "cashflow", l: "Cash Flow" }] as const;

  return (
    <div className="space-y-6 w-full">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl lg:text-4xl font-bold text-brand-dark flex items-center gap-2"><Calculator className="size-7" /> Accounting</h1>
          <p className="text-muted-foreground mt-1">See how your business is doing — Profit &amp; Loss, Balance Sheet and Cash Flow.</p>
        </div>
        {tab === "pnl" && canExport && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline"><FileDown className="size-4" /> Export</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={exportPdf}><FileDown className="size-4 mr-2" /> Download PDF</DropdownMenuItem>
              <DropdownMenuItem onClick={exportCsv}><Download className="size-4 mr-2" /> Export CSV</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-border/60">
        {TABS.map((t) => (
          <button key={t.k} type="button" onClick={() => setTab(t.k)}
            className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors", tab === t.k ? "border-brand text-brand-dark" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {t.l}
          </button>
        ))}
      </div>

      {/* Period picker — P&L + Cash Flow use a date range; the Balance Sheet uses its own as-at date. */}
      {tab !== "balance" && (
        <Card className="shadow-card border-border/60 p-4 flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-brand-dark">Period</span>
          <DatePicker value={from} onChange={setFrom} className="w-40" aria-label="From date" />
          <span className="text-muted-foreground text-sm">to</span>
          <DatePicker value={to} onChange={setTo} className="w-40" aria-label="To date" />
          {tab === "pnl" && <span className="ml-auto text-xs text-muted-foreground">vs previous {prevFrom} → {prevTo}</span>}
        </Card>
      )}

      {tab === "cashflow" && <CashFlowTab from={from} to={to} canExport={canExport} />}
      {tab === "balance" && <BalanceSheetTab canExport={canExport} isOwner={isOwner} />}

      {tab === "pnl" && (loading ? <TablePageSkeleton /> : <>
      {/* Accuracy hint when sold items have no recorded cost */}
      {missingUnits > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/5 p-4">
          <TriangleAlert className="size-5 shrink-0 text-warning" />
          <div className="text-sm">
            <p className="font-medium text-brand-dark">Cost of goods sold may be understated</p>
            <p className="text-muted-foreground mt-0.5">
              {missingUnits} sold unit{missingUnits === 1 ? "" : "s"} in this period have no cost price, so profit looks higher than it is.
              Add cost prices in <Link to="/inventory" className="text-brand hover:underline">Inventory</Link> for accurate COGS on future sales.
            </p>
          </div>
        </div>
      )}

      {/* The statement */}
      <Card className="shadow-card border-border/60 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                <th className="text-left font-medium px-4 py-3">Profit &amp; Loss</th>
                <th className="text-right font-medium px-4 py-3">This period</th>
                <th className="hidden sm:table-cell text-right font-medium px-4 py-3">Previous</th>
                <th className="hidden sm:table-cell text-right font-medium px-4 py-3">Change</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                if (r.kind === "head") return (
                  <tr key={i}><td colSpan={4} className="px-4 pt-4 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{r.label}</td></tr>
                );
                const strong = r.kind === "sub" || r.kind === "total";
                const good = r.label !== "Total operating expenses"; // higher expenses = worse
                return (
                  <tr key={i} className={cn(
                    r.kind === "total" && "border-t-2 border-border bg-brand-light/30",
                    r.kind === "sub" && "border-t border-border/70",
                  )}>
                    <td className={cn("px-4 py-2.5", r.kind === "exp" && "pl-8 text-muted-foreground", strong && "font-semibold text-brand-dark", r.kind === "total" && "font-display text-base")}>
                      {r.label}
                      {r.margin != null && <span className="ml-2 text-xs font-normal text-muted-foreground">{r.margin}% margin</span>}
                    </td>
                    <td className={cn("px-4 py-2.5 text-right", strong && "font-semibold text-brand-dark", r.kind === "total" && "font-display text-base")}><Amount n={r.c} /></td>
                    <td className="hidden sm:table-cell px-4 py-2.5 text-right text-muted-foreground"><Amount n={r.p} /></td>
                    <td className="hidden sm:table-cell px-4 py-2.5 text-right"><Change c={r.c} p={r.p} good={good} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Explainer — how the statement is calculated */}
      <details className="rounded-xl border border-border/60 bg-card">
        <summary className="cursor-pointer list-none px-4 py-3 flex items-center gap-2 text-sm font-medium text-brand-dark">
          <Info className="size-4 text-brand" /> How this Profit &amp; Loss is calculated
        </summary>
        <div className="px-4 pb-4 pt-1 text-sm text-muted-foreground space-y-2 border-t border-border/50">
          <p><span className="font-medium text-foreground">Accrual basis.</span> Revenue is counted when you invoice a sale (issued, part-paid or paid) — not only when cash arrives. Draft and void invoices are excluded.</p>
          <p><span className="font-medium text-foreground">Net of VAT.</span> VAT is money you hold for the tax office, not income or expense — so revenue and expenses are shown after removing VAT. (No effect if you don't charge VAT.)</p>
          <p><span className="font-medium text-foreground">Cost of goods sold.</span> The cost of items sold, captured at the moment of each sale. Sales made before this feature shipped use the product's current cost as an estimate. Manually created invoices don't carry item costs, so their cost of sales isn't included.</p>
          <p><span className="font-medium text-foreground">Operating expenses.</span> Your Expenditure records grouped by category (Salaries flow in from Payroll), net of input VAT. Stock and raw-material purchases are <em>not</em> expensed here — they become cost of goods sold when the items are sold.</p>
          <p><span className="font-medium text-foreground">Net profit = Gross profit − Operating expenses.</span> It's only as accurate as your product cost prices, so keep those up to date in Inventory.</p>
        </div>
      </details>
      </>)}
    </div>
  );
}
