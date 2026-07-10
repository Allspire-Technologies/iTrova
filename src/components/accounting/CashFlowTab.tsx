import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/hooks/useCurrency";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { TablePageSkeleton } from "@/components/Skeletons";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { FileDown, Download, Info } from "lucide-react";
import { downloadCsv } from "@/lib/csv";
import { loadPdf, pdfMoneyFormatter } from "@/lib/pdf";
import { buildCashFlow, type CashFlow, type CashLine } from "@/lib/financials";

const isoStart = (d: string) => `${d}T00:00:00`;
const isoEnd = (d: string) => `${d}T23:59:59.999`;

export default function CashFlowTab({ from, to, canExport }: { from: string; to: string; canExport: boolean }) {
  const { business } = useAuth();
  const { fmt } = useCurrency();
  const [loading, setLoading] = useState(true);
  const [cf, setCf] = useState<CashFlow | null>(null);

  const load = useCallback(async () => {
    if (!business) return;
    setLoading(true);
    const bid = business.id;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    try {
      const [salesRes, payRes, expRes, purRes] = await Promise.all([
        supabase.from("sales").select("total_amount").eq("business_id", bid).eq("voided", false).gte("created_at", isoStart(from)).lte("created_at", isoEnd(to)),
        sb.from("invoice_payments").select("amount").eq("business_id", bid).gte("created_at", isoStart(from)).lte("created_at", isoEnd(to)),
        sb.from("expenses").select("category,amount,status,paid_date").eq("business_id", bid).eq("status", "paid").gte("paid_date", from).lte("paid_date", to),
        sb.from("material_purchases").select("total_cost").eq("business_id", bid).gte("created_at", isoStart(from)).lte("created_at", isoEnd(to)),
      ]);
      const cashInSales = (salesRes.data ?? []).reduce((a: number, s: { total_amount: number }) => a + Number(s.total_amount || 0), 0);
      const cashInPayments = (payRes.data ?? []).reduce((a: number, p: { amount: number }) => a + Number(p.amount || 0), 0);
      const purchases = (purRes.data ?? []).reduce((a: number, p: { total_cost: number }) => a + Number(p.total_cost || 0), 0);
      // Paid expenses grouped by category (VAT-inclusive — this is real cash out).
      const byCat = new Map<string, number>();
      for (const e of (expRes.data ?? []) as { category: string; amount: number }[]) {
        const c = (e.category || "Other").trim() || "Other";
        byCat.set(c, (byCat.get(c) ?? 0) + Number(e.amount || 0));
      }
      const expenseLines: CashLine[] = [...byCat.entries()].map(([label, amount]) => ({ label, amount })).sort((a, b) => b.amount - a.amount);

      const inflows: CashLine[] = [
        { label: "Sales receipts (POS)", amount: cashInSales },
        { label: "Invoice payments received", amount: cashInPayments },
      ];
      const outflows: CashLine[] = [...expenseLines, { label: "Stock & material purchases", amount: purchases }];
      setCf(buildCashFlow(inflows, outflows));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't build the cash flow");
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
      toast.error(e instanceof Error ? e.message : "Couldn't build the PDF");
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
          <p><span className="font-medium text-foreground">Cash basis.</span> This tracks money that actually moved in the period — not invoices raised. It's VAT-inclusive, because you receive and pay VAT in real cash.</p>
          <p><span className="font-medium text-foreground">Cash in</span> = paid POS sales + payments received on invoices. <span className="font-medium text-foreground">Cash out</span> = expenses you marked paid (Salaries included, from Payroll) + stock and raw-material purchases.</p>
          <p><span className="font-medium text-foreground">Net cash movement</span> is the change in your cash for the period. It doesn't show a running bank balance — set your opening balance on the Balance Sheet for that.</p>
        </div>
      </details>
    </div>
  );
}
