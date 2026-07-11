import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/hooks/useCurrency";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import DatePicker from "@/components/DatePicker";
import CashFlowTab from "@/components/accounting/CashFlowTab";
import BalanceSheetTab from "@/components/accounting/BalanceSheetTab";
import JournalTab from "@/components/accounting/JournalTab";
import TrialBalanceTab from "@/components/accounting/TrialBalanceTab";
import { TablePageSkeleton } from "@/components/Skeletons";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { FileDown, Download, Info } from "lucide-react";
import { downloadCsv } from "@/lib/csv";
import { loadPdf } from "@/lib/pdf";
import { pctChange } from "@/lib/profitLoss";
import { ensureChart, listAccounts, fetchLinesInPeriod, ledgerPnl, friendlyLedgerError, type LedgerPnl } from "@/lib/ledger";

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
  const canManage = can("accounting", "manage");
  const isOwner = role === "owner";

  const [tab, setTab] = useState<"pnl" | "balance" | "cashflow" | "journal" | "trialbalance">("pnl");
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(todayStr());
  const [loading, setLoading] = useState(true);
  const [cur, setCur] = useState<LedgerPnl | Empty>(null);
  const [prev, setPrev] = useState<LedgerPnl | Empty>(null);

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
    try {
      await ensureChart();
      const [accs, curLines, prevLines] = await Promise.all([
        listAccounts(),
        fetchLinesInPeriod(from, to),
        fetchLinesInPeriod(prevFrom, prevTo),
      ]);
      setCur(ledgerPnl(accs, curLines));
      setPrev(ledgerPnl(accs, prevLines));
    } catch (e) {
      toast.error(friendlyLedgerError(e instanceof Error ? e.message : undefined, "Couldn't build the statement"));
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

  const TABS = [
    { k: "pnl", l: "Profit & Loss" }, { k: "balance", l: "Balance Sheet" }, { k: "cashflow", l: "Cash Flow" },
    { k: "journal", l: "Journal" }, { k: "trialbalance", l: "Trial Balance" },
  ] as const;

  return (
    <div className="space-y-6 w-full">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl lg:text-4xl font-bold text-brand-dark">Accounting</h1>
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
      {tab === "journal" && <JournalTab from={from} to={to} canManage={canManage} />}
      {tab === "trialbalance" && <TrialBalanceTab from={from} to={to} canManage={canManage} canExport={canExport} />}

      {tab === "pnl" && (loading ? <TablePageSkeleton /> : <>

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
          <p><span className="font-medium text-foreground">Straight from your ledger.</span> This reads the Sales, Cost of Goods Sold and Operating Expense accounts for the period, so it ties to your Trial Balance.</p>
          <p><span className="font-medium text-foreground">Net of VAT.</span> VAT is money you hold for the tax office, not income or expense — so revenue and expenses exclude it. (No effect if you don't charge VAT.)</p>
          <p><span className="font-medium text-foreground">Cost of goods sold</span> is the cost of items sold, captured at the moment of each sale (Cr Inventory / Dr COGS). <span className="font-medium text-foreground">Operating expenses</span> come from your Expenditure records (Salaries included, from Payroll), grouped by category. Stock purchases aren't expensed here — they become cost of goods sold when the items sell.</p>
          <p><span className="font-medium text-foreground">Net profit = Gross profit − Operating expenses.</span> It's only as accurate as your product cost prices, so keep those up to date in Inventory.</p>
        </div>
      </details>
      </>)}
    </div>
  );
}
