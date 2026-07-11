import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/hooks/useCurrency";
import { useDateFormat } from "@/hooks/useDateFormat";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import DatePicker from "@/components/DatePicker";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { TablePageSkeleton } from "@/components/Skeletons";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { FileDown, Download, Info, Landmark, Pencil } from "lucide-react";
import { downloadCsv } from "@/lib/csv";
import { loadPdf, pdfMoneyFormatter } from "@/lib/pdf";
import { ensureChart, listAccounts, fetchLinesInPeriod, ledgerBalanceSheet, friendlyLedgerError, type LedgerBalanceSheet } from "@/lib/ledger";

const todayStr = () => new Date().toISOString().slice(0, 10);

export default function BalanceSheetTab({ canExport, isOwner }: { canExport: boolean; isOwner: boolean }) {
  const { business, refresh } = useAuth();
  const { fmt } = useCurrency();
  const { fmtDate } = useDateFormat();

  const openingDate = business?.books_opening_date ?? null;
  const [asOf, setAsOf] = useState(todayStr());
  const [loading, setLoading] = useState(true);
  const [bs, setBs] = useState<LedgerBalanceSheet | null>(null);

  // Opening-balances setup form (feeds the opening journal entry).
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [oCash, setOCash] = useState("");
  const [oCapital, setOCapital] = useState("");
  const [oDate, setODate] = useState("");
  useEffect(() => {
    setOCash(business?.opening_cash != null ? String(business.opening_cash) : "");
    setOCapital(business?.opening_capital != null ? String(business.opening_capital) : "");
    setODate(business?.books_opening_date ?? "");
  }, [business?.opening_cash, business?.opening_capital, business?.books_opening_date]);

  const load = useCallback(async () => {
    if (!business) return;
    setLoading(true);
    try {
      await ensureChart();
      const [accs, lines] = await Promise.all([listAccounts(), fetchLinesInPeriod("0001-01-01", asOf)]);
      setBs(ledgerBalanceSheet(accs, lines));
    } catch (e) {
      toast.error(friendlyLedgerError((e as Error)?.message, "Couldn't build the balance sheet"));
    } finally {
      setLoading(false);
    }
  }, [business, asOf]);
  useEffect(() => { load(); }, [load]);

  const saveOpening = async () => {
    if (!business) return;
    if (!oDate) return toast.error("Pick the date your figures are as of");
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from("businesses")
      .update({ opening_cash: Number(oCash) || 0, opening_capital: Number(oCapital) || 0, books_opening_date: oDate })
      .eq("id", business.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Opening balances saved");
    setEditing(false);
    await refresh();
    load(); // ensureChart posts the opening journal, then rebuild
  };

  type Row = { label: string; amount: number | null; kind: "head" | "line" | "total" | "grand" };
  const rows = useMemo<Row[]>(() => {
    if (!bs) return [];
    return [
      { label: "Assets", amount: null, kind: "head" },
      ...bs.assets.map((a): Row => ({ label: a.name, amount: a.amount, kind: "line" })),
      { label: "Total assets", amount: bs.totalAssets, kind: "total" },
      { label: "Liabilities", amount: null, kind: "head" },
      ...bs.liabilities.map((a): Row => ({ label: a.name, amount: a.amount, kind: "line" })),
      { label: "Total liabilities", amount: bs.totalLiabilities, kind: "total" },
      { label: "Equity", amount: null, kind: "head" },
      ...bs.equity.map((a): Row => ({ label: a.name, amount: a.amount, kind: "line" })),
      { label: "Current-period earnings", amount: bs.currentEarnings, kind: "line" },
      { label: "Total equity", amount: bs.totalEquity, kind: "total" },
      { label: "Liabilities + Equity", amount: bs.totalLiabilities + bs.totalEquity, kind: "grand" },
    ];
  }, [bs]);

  const exportCsv = () => {
    const body = rows.filter(r => r.kind !== "head").map(r => [r.label, r.amount == null ? "" : String(r.amount)]);
    const csv = [["Line", "Amount"], ...body].map(cols => cols.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    downloadCsv(`balance-sheet-${asOf}.csv`, csv);
    toast.success("Balance sheet exported");
  };
  const exportPdf = async () => {
    try {
      const { jsPDF, autoTable } = await loadPdf();
      const money = pdfMoneyFormatter(business?.currency ?? undefined);
      const doc = new jsPDF();
      doc.setFontSize(16); doc.text(business?.name || "Balance Sheet", 14, 18);
      doc.setFontSize(11); doc.setTextColor(110); doc.text(`Balance Sheet · as at ${asOf}`, 14, 25); doc.setTextColor(0);
      autoTable(doc, {
        startY: 32,
        body: rows.filter(r => r.kind !== "head").map(r => [r.label, r.amount == null ? "" : money(r.amount)]),
        columnStyles: { 1: { halign: "right" } }, theme: "plain",
        didParseCell: (d) => { const rr = rows.filter(r => r.kind !== "head")[d.row.index]; if (d.section === "body" && (rr?.kind === "total" || rr?.kind === "grand")) d.cell.styles.fontStyle = "bold"; },
      });
      doc.save(`balance-sheet-${asOf}.pdf`);
    } catch (e) {
      toast.error(friendlyLedgerError((e as Error)?.message, "Couldn't build the PDF"));
    }
  };

  const Amount = ({ n }: { n: number | null }) => n == null ? null : <span className={cn("tabular-nums", n < 0 && "text-danger")}>{n < 0 ? `(${fmt(Math.abs(n))})` : fmt(n)}</span>;
  const openingSet = !!openingDate;

  return (
    <div className="space-y-4">
      {/* Opening balances setup / summary */}
      <Card className={cn("shadow-card border-border/60 p-4", !openingSet && "border-brand/40 bg-brand-light/20")}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="size-9 rounded-lg bg-brand-light grid place-items-center text-brand shrink-0"><Landmark className="size-4" /></div>
            <div>
              <p className="font-medium text-brand-dark">Opening balances</p>
              {openingSet ? (
                <p className="text-sm text-muted-foreground">Cash {fmt(Number(business?.opening_cash) || 0)} · Capital {fmt(Number(business?.opening_capital) || 0)} · as of {fmtDate(openingDate)}</p>
              ) : (
                <p className="text-sm text-muted-foreground">Set your starting cash/bank balance and owner's capital as of a date — it's posted as the opening journal so your books start from the right place. (Opening inventory is captured automatically from your stock.)</p>
              )}
            </div>
          </div>
          {isOwner && !editing && <Button variant={openingSet ? "ghost" : "brand"} size="sm" onClick={() => setEditing(true)}>{openingSet ? <><Pencil className="size-4" /> Edit</> : "Set opening balances"}</Button>}
        </div>
        {isOwner && editing && (
          <div className="mt-4 grid gap-3 sm:grid-cols-3 border-t border-border/50 pt-4">
            <div className="space-y-1.5"><Label>Cash / bank balance</Label><Input type="number" min="0" step="0.01" value={oCash} onChange={e => setOCash(e.target.value)} placeholder="0" /></div>
            <div className="space-y-1.5"><Label>Owner's capital</Label><Input type="number" min="0" step="0.01" value={oCapital} onChange={e => setOCapital(e.target.value)} placeholder="0" /></div>
            <div className="space-y-1.5"><Label>As of date</Label><DatePicker value={oDate} onChange={setODate} placeholder="Select date" /></div>
            <div className="sm:col-span-3 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
              <Button variant="brand" size="sm" onClick={saveOpening} disabled={busy}>{busy ? "Saving..." : "Save opening balances"}</Button>
            </div>
          </div>
        )}
      </Card>

      {/* As-of date + export */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-brand-dark">As at</span>
        <DatePicker value={asOf} onChange={setAsOf} className="w-40" aria-label="As-of date" />
        {canExport && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="outline" className="ml-auto"><FileDown className="size-4" /> Export</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={exportPdf}><FileDown className="size-4 mr-2" /> Download PDF</DropdownMenuItem>
              <DropdownMenuItem onClick={exportCsv}><Download className="size-4 mr-2" /> Export CSV</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {loading || !bs ? <TablePageSkeleton /> : (
        <>
          <Card className="shadow-card border-border/60 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="text-left font-medium px-4 py-3">Balance sheet</th>
                    <th className="text-right font-medium px-4 py-3">As at {asOf}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    if (r.kind === "head") return <tr key={i}><td colSpan={2} className="px-4 pt-4 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{r.label}</td></tr>;
                    const strong = r.kind === "total" || r.kind === "grand";
                    return (
                      <tr key={i} className={cn(r.kind === "total" && "border-t border-border/70", r.kind === "grand" && "border-t-2 bg-brand-light/30")}>
                        <td className={cn("px-4 py-2.5", r.kind === "line" && "pl-8 text-muted-foreground", strong && "font-semibold text-brand-dark", r.kind === "grand" && "font-display text-base")}>{r.label}</td>
                        <td className={cn("px-4 py-2.5 text-right", strong && "font-semibold text-brand-dark", r.kind === "grand" && "font-display text-base")}><Amount n={r.amount} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="flex items-center gap-2 text-sm">
            <Badge variant="outline" className={cn(bs.balanced ? "bg-brand-light text-brand-dark border-brand/20" : "bg-danger/10 text-danger border-danger/20")}>
              {bs.balanced ? "Balanced — Assets = Liabilities + Equity" : "Out of balance"}
            </Badge>
          </div>
        </>
      )}

      <details className="rounded-xl border border-border/60 bg-card">
        <summary className="cursor-pointer list-none px-4 py-3 flex items-center gap-2 text-sm font-medium text-brand-dark"><Info className="size-4 text-brand" /> How this Balance Sheet is calculated</summary>
        <div className="px-4 pb-4 pt-1 text-sm text-muted-foreground space-y-2 border-t border-border/50">
          <p><span className="font-medium text-foreground">Straight from your ledger.</span> Every account's balance as at the date — so Assets always equal Liabilities + Equity.</p>
          <p><span className="font-medium text-foreground">Current-period earnings</span> is profit not yet closed to retained earnings; it sits in Equity, which is why the sheet balances.</p>
          <p>It's as accurate as what's posted. Sales, expenses, invoices, payments and raw-material purchases post automatically; product purchase-orders and production runs aren't posted yet, so their stock is carried at your opening figure until those phases land. Keep your opening balances and product costs accurate for the best picture.</p>
        </div>
      </details>
    </div>
  );
}
