import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/hooks/useCurrency";
import { useDateFormat } from "@/hooks/useDateFormat";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import DatePicker from "@/components/DatePicker";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { TablePageSkeleton } from "@/components/Skeletons";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { FileDown, Download, Info, Landmark, Pencil } from "lucide-react";
import { downloadCsv } from "@/lib/csv";
import { loadPdf, pdfMoneyFormatter } from "@/lib/pdf";
import { revenueNetOfVat, computeCogs, expenseLinesNetOfVat, isRevenueInvoice, type InvoiceLike, type CostedSaleItem } from "@/lib/profitLoss";
import { inventoryValue, receivablesOutstanding, buildBalanceSheet, type BalanceSheet } from "@/lib/financials";

const todayStr = () => new Date().toISOString().slice(0, 10);
const isoStart = (d: string) => `${d}T00:00:00`;
const isoEnd = (d: string) => `${d}T23:59:59.999`;
const sum = (rows: unknown[] | null | undefined, key: string): number =>
  ((rows ?? []) as Record<string, number>[]).reduce((a, r) => a + (Number(r[key]) || 0), 0);

export default function BalanceSheetTab({ canExport, isOwner }: { canExport: boolean; isOwner: boolean }) {
  const { business, refresh } = useAuth();
  const { fmt } = useCurrency();
  const { fmtDate } = useDateFormat();

  const openingDate = business?.books_opening_date ?? null;
  const [asOf, setAsOf] = useState(todayStr());
  const [loading, setLoading] = useState(true);
  const [bs, setBs] = useState<BalanceSheet | null>(null);

  // Opening-balances setup form
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
  };

  const load = useCallback(async () => {
    if (!business) return;
    setLoading(true);
    const bid = business.id;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const O = openingDate;
    try {
      const [prodRes, matRes, invOpenRes, pendRes] = await Promise.all([
        supabase.from("products").select("stock_quantity,cost_price").eq("business_id", bid),
        sb.from("raw_materials").select("stock_quantity,cost_per_unit").eq("business_id", bid),
        supabase.from("invoices").select("total,amount_paid,status").eq("business_id", bid).in("status", ["issued", "partial"]),
        sb.from("expenses").select("amount").eq("business_id", bid).eq("status", "pending"),
      ]);
      const products = (prodRes.data ?? []) as { id?: string; stock_quantity?: number; cost_price?: number }[];
      const inventory = inventoryValue(products, (matRes.data ?? []) as { stock_quantity?: number; cost_per_unit?: number }[]);
      const receivables = receivablesOutstanding((invOpenRes.data ?? []) as { total: number; amount_paid?: number; status?: string }[]);
      const payables = sum(pendRes.data, "amount");

      // Cash, VAT payable and retained earnings need the books opening date (accumulate O → asOf).
      let cash = Number(business.opening_cash) || 0;
      let retainedEarnings = 0;
      let vatPayable = 0;
      if (O) {
        const [salesRes, payRes, expWinRes, purRes, invWinRes, siRes, prodCostRes] = await Promise.all([
          supabase.from("sales").select("total_amount").eq("business_id", bid).eq("voided", false).gte("created_at", isoStart(O)).lte("created_at", isoEnd(asOf)),
          sb.from("invoice_payments").select("amount").eq("business_id", bid).gte("created_at", isoStart(O)).lte("created_at", isoEnd(asOf)),
          sb.from("expenses").select("category,amount,tax_amount,status").eq("business_id", bid).gte("expense_date", O).lte("expense_date", asOf),
          sb.from("material_purchases").select("total_cost,tax_amount").eq("business_id", bid).gte("created_at", isoStart(O)).lte("created_at", isoEnd(asOf)),
          supabase.from("invoices").select("total,tax,status").eq("business_id", bid).in("status", ["issued", "partial", "paid"]).gte("issue_date", O).lte("issue_date", asOf),
          sb.from("sale_items").select("product_id,quantity,unit_cost,sales!inner(id)").eq("sales.business_id", bid).eq("sales.voided", false).gte("sales.created_at", isoStart(O)).lte("sales.created_at", isoEnd(asOf)),
          supabase.from("products").select("id,cost_price").eq("business_id", bid),
        ]);
        const expWin = (expWinRes.data ?? []) as { category: string; amount: number; tax_amount?: number; status: string }[];
        const cashIn = sum(salesRes.data, "total_amount") + sum(payRes.data, "amount");
        const cashOut = expWin.filter(e => e.status === "paid").reduce((a, e) => a + Number(e.amount || 0), 0) + sum(purRes.data, "total_cost");
        cash = (Number(business.opening_cash) || 0) + (cashIn - cashOut);

        const invWin = (invWinRes.data ?? []) as InvoiceLike[];
        const revenue = revenueNetOfVat(invWin.filter(isRevenueInvoice));
        const cogs = computeCogs((siRes.data ?? []) as unknown as CostedSaleItem[], (prodCostRes.data ?? []) as { id: string; cost_price?: number }[]);
        const opex = expenseLinesNetOfVat(expWin).reduce((a, e) => a + e.amount, 0);
        retainedEarnings = Math.round((revenue - cogs - opex) * 100) / 100;

        if (business.tax_enabled) {
          const output = invWin.filter(isRevenueInvoice).reduce((a, i) => a + Number(i.tax || 0), 0);
          const input = expWin.reduce((a, e) => a + Number(e.tax_amount || 0), 0) + sum(purRes.data, "tax_amount");
          vatPayable = output - input;
        }
      }

      setBs(buildBalanceSheet({
        cash, inventory, receivables, payables, vatPayable,
        capital: Number(business.opening_capital) || 0, retainedEarnings,
      }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't build the balance sheet");
    } finally {
      setLoading(false);
    }
  }, [business, openingDate, asOf]);

  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    if (!bs) return [] as { label: string; amount: number | null; kind: "head" | "line" | "total" | "grand" }[];
    return [
      { label: "Assets", amount: null, kind: "head" as const },
      { label: "Cash & bank", amount: bs.cash, kind: "line" as const },
      { label: "Inventory (at cost)", amount: bs.inventory, kind: "line" as const },
      { label: "Accounts receivable", amount: bs.receivables, kind: "line" as const },
      { label: "Total assets", amount: bs.totalAssets, kind: "total" as const },
      { label: "Liabilities", amount: null, kind: "head" as const },
      { label: "Accounts payable (bills to pay)", amount: bs.payables, kind: "line" as const },
      ...(business?.tax_enabled ? [{ label: "VAT payable", amount: bs.vatPayable, kind: "line" as const }] : []),
      { label: "Total liabilities", amount: bs.totalLiabilities, kind: "total" as const },
      { label: "Equity", amount: null, kind: "head" as const },
      { label: "Owner's capital", amount: bs.capital, kind: "line" as const },
      { label: "Retained earnings", amount: bs.retainedEarnings, kind: "line" as const },
      { label: "Total equity", amount: bs.totalEquity, kind: "total" as const },
      { label: "Liabilities + Equity", amount: bs.totalLiabilities + bs.totalEquity, kind: "grand" as const },
    ];
  }, [bs, business?.tax_enabled]);

  const exportCsv = () => {
    const body = rows.filter(r => r.kind !== "head").map(r => [r.label, r.amount == null ? "" : String(r.amount)]);
    const csv = [["Line", "Amount"], ...body, ["Difference (unreconciled)", String(bs?.difference ?? 0)]]
      .map(cols => cols.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const y = (doc as any).lastAutoTable?.finalY ?? 60;
      if (bs && bs.difference !== 0) { doc.setFontSize(9); doc.setTextColor(150); doc.text(`Difference (unreconciled): ${money(bs.difference)}`, 14, y + 8); }
      doc.save(`balance-sheet-${asOf}.pdf`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't build the PDF");
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
                <p className="text-sm text-muted-foreground">Set your starting cash/bank balance and owner's capital so the balance sheet can show Cash and Equity.</p>
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

          {bs.difference !== 0 && (
            <div className="flex items-start gap-3 rounded-xl border border-border/60 bg-muted/40 p-4 text-sm">
              <Info className="size-5 shrink-0 text-muted-foreground" />
              <p className="text-muted-foreground">
                <span className="font-medium text-brand-dark">Assets don't fully tie to Liabilities + Equity ({fmt(Math.abs(bs.difference))} {bs.difference > 0 ? "more assets" : "more claims"}).</span> iTrova
                isn't a double-entry ledger, so a gap usually means owner drawings/injections, cash movements not recorded here, or VAT already remitted. Treat this as an estimate and reconcile with your records.
              </p>
            </div>
          )}
        </>
      )}

      <details className="rounded-xl border border-border/60 bg-card">
        <summary className="cursor-pointer list-none px-4 py-3 flex items-center gap-2 text-sm font-medium text-brand-dark"><Info className="size-4 text-brand" /> How this Balance Sheet is calculated</summary>
        <div className="px-4 pb-4 pt-1 text-sm text-muted-foreground space-y-2 border-t border-border/50">
          <p><span className="font-medium text-foreground">Cash & bank</span> = your opening balance + net cash movement since the opening date. <span className="font-medium text-foreground">Inventory</span> is stock valued at cost (products + raw materials). <span className="font-medium text-foreground">Accounts receivable</span> is the unpaid balance of issued/part-paid invoices.</p>
          <p><span className="font-medium text-foreground">Accounts payable</span> is your pending bills. <span className="font-medium text-foreground">VAT payable</span> is output − input VAT accrued since the opening date (assumes none remitted yet).</p>
          <p><span className="font-medium text-foreground">Equity</span> = owner's capital + retained earnings (accumulated net profit since the opening date).</p>
          <p>Because iTrova isn't a full double-entry ledger, the two sides won't always tie exactly — any gap is shown transparently so you can reconcile it. Keep your opening balances and product costs accurate for the best picture.</p>
        </div>
      </details>
    </div>
  );
}
