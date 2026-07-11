import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/hooks/useCurrency";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { TablePageSkeleton } from "@/components/Skeletons";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { FileDown, Download, Info } from "lucide-react";
import { downloadCsv } from "@/lib/csv";
import { loadPdf, pdfMoneyFormatter } from "@/lib/pdf";
import { ensureChart, listAccounts, fetchCashFlowLines, ledgerCashFlow, friendlyLedgerError, type LedgerCashFlow } from "@/lib/ledger";

export default function CashFlowTab({ from, to, canExport }: { from: string; to: string; canExport: boolean }) {
  const { business } = useAuth();
  const { fmt } = useCurrency();
  const [loading, setLoading] = useState(true);
  const [cf, setCf] = useState<LedgerCashFlow | null>(null);

  const load = useCallback(async () => {
    if (!business) return;
    setLoading(true);
    try {
      await ensureChart();
      const [accs, lines] = await Promise.all([listAccounts(), fetchCashFlowLines(from, to)]);
      setCf(ledgerCashFlow(accs, lines));
    } catch (e) {
      toast.error(friendlyLedgerError((e as Error)?.message, "Couldn't build the cash flow"));
    } finally {
      setLoading(false);
    }
  }, [business, from, to]);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    if (!cf) return [] as { label: string; amount: number; kind: "head" | "in" | "out" | "total" }[];
    return [
      { label: "Cash in", amount: 0, kind: "head" as const },
      ...cf.inflows.map((l) => ({ label: l.label, amount: l.amount, kind: "in" as const })),
      { label: "Total cash in", amount: cf.totalIn, kind: "total" as const },
      { label: "Cash out", amount: 0, kind: "head" as const },
      ...cf.outflows.map((l) => ({ label: l.label, amount: -l.amount, kind: "out" as const })),
      { label: "Total cash out", amount: -cf.totalOut, kind: "total" as const },
      { label: "Net cash movement", amount: cf.net, kind: "total" as const },
    ];
  }, [cf]);

  const exportCsv = () => {
    const body = rows.filter(r => r.kind !== "head").map(r => [r.label, String(r.amount)]);
    const csv = [["Line", "Amount"], ...body].map(cols => cols.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    downloadCsv(`cash-flow-${from}_${to}.csv`, csv);
    toast.success("Cash flow exported");
  };
  const exportPdf = async () => {
    try {
      const { jsPDF, autoTable } = await loadPdf();
      const money = pdfMoneyFormatter(business?.currency ?? undefined);
      const doc = new jsPDF();
      doc.setFontSize(16); doc.text(business?.name || "Cash Flow", 14, 18);
      doc.setFontSize(11); doc.setTextColor(110); doc.text(`Cash Flow · ${from} to ${to}`, 14, 25); doc.setTextColor(0);
      autoTable(doc, {
        startY: 32,
        body: rows.filter(r => r.kind !== "head").map(r => [r.label, r.kind === "total" && r.amount === 0 ? "" : money(r.amount)]),
        columnStyles: { 1: { halign: "right" } }, theme: "plain",
        didParseCell: (d) => { if (d.section === "body" && rows.filter(r => r.kind !== "head")[d.row.index]?.kind === "total") d.cell.styles.fontStyle = "bold"; },
      });
      doc.save(`cash-flow-${from}_${to}.pdf`);
    } catch (e) {
      toast.error(friendlyLedgerError((e as Error)?.message, "Couldn't build the PDF"));
    }
  };

  const Amount = ({ n }: { n: number }) => <span className={cn("tabular-nums", n < 0 && "text-muted-foreground")}>{n < 0 ? `(${fmt(Math.abs(n))})` : fmt(n)}</span>;

  if (loading) return <TablePageSkeleton />;

  return (
    <div className="space-y-4">
      {canExport && (
        <div className="flex justify-end">
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="outline"><FileDown className="size-4" /> Export</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={exportPdf}><FileDown className="size-4 mr-2" /> Download PDF</DropdownMenuItem>
              <DropdownMenuItem onClick={exportCsv}><Download className="size-4 mr-2" /> Export CSV</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      <Card className="shadow-card border-border/60 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                <th className="text-left font-medium px-4 py-3">Cash flow</th>
                <th className="text-right font-medium px-4 py-3">{from} → {to}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                if (r.kind === "head") return <tr key={i}><td colSpan={2} className="px-4 pt-4 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{r.label}</td></tr>;
                const isNet = r.label === "Net cash movement";
                return (
                  <tr key={i} className={cn(r.kind === "total" && "border-t border-border/70", isNet && "border-t-2 bg-brand-light/30")}>
                    <td className={cn("px-4 py-2.5", r.kind === "out" && "pl-8", r.kind === "total" && "font-semibold text-brand-dark", isNet && "font-display text-base")}>{r.label}</td>
                    <td className={cn("px-4 py-2.5 text-right", r.kind === "total" && "font-semibold text-brand-dark", isNet && "font-display text-base")}>{r.kind === "total" && r.amount === 0 ? "" : <Amount n={r.amount} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <details className="rounded-xl border border-border/60 bg-card">
        <summary className="cursor-pointer list-none px-4 py-3 flex items-center gap-2 text-sm font-medium text-brand-dark"><Info className="size-4 text-brand" /> How this Cash Flow is calculated</summary>
        <div className="px-4 pb-4 pt-1 text-sm text-muted-foreground space-y-2 border-t border-border/50">
          <p><span className="font-medium text-foreground">From your ledger.</span> This reads the actual movements on your Cash &amp; Bank accounts in the period, grouped by what caused them — so it ties to your books.</p>
          <p><span className="font-medium text-foreground">Cash in</span> = sale receipts + invoice payments. <span className="font-medium text-foreground">Cash out</span> = expenses paid (Salaries included) + stock purchases. <span className="font-medium text-foreground">Net cash movement</span> is the change in your cash for the period.</p>
        </div>
      </details>
    </div>
  );
}
