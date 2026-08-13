import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import Paginator, { usePagination } from "@/components/Paginator";
import { Receipt, Eye, Download, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useDateFormat } from "@/hooks/useDateFormat";
import { listBillingHistory, type BillingHistoryRow } from "@/lib/billing";
import { downloadPdf, pdfMoneyFormatter } from "@/lib/pdf";

const METHOD_LABEL: Record<string, string> = {
  transfer: "Bank transfer", card: "Card", credit: "Referral credit", manual: "Recorded by our team",
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Settings → Billing: what this business has paid for its subscription, with a receipt per payment. */
export default function BillingHistoryCard() {
  const { business } = useAuth();
  const { fmtDate } = useDateFormat();
  const [rows, setRows] = useState<BillingHistoryRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [viewing, setViewing] = useState<BillingHistoryRow | null>(null);

  // A failed request is NOT an empty history — it keeps the card visible with a retry.
  const load = () => {
    setFailed(false);
    setRows(null);
    listBillingHistory().then(setRows).catch(() => setFailed(true));
  };
  useEffect(load, [business?.id]);

  // Five per page, as asked — short enough to scan without hiding a year of payments.
  const { paged, page, setPage, pageSize, setPageSize, pageCount, total } = usePagination(rows ?? [], 5);

  const money = (n: number, currency: string) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: 0 }).format(n);

  const receiptNumber = (r: BillingHistoryRow) => r.reference ?? `RCPT-${r.id.slice(0, 8).toUpperCase()}`;
  const describe = (r: BillingHistoryRow) =>
    `iTrova ${r.planKey ? cap(r.planKey) : "subscription"}${r.cycle ? ` — ${cap(r.cycle)}` : ""}`;

  // How the payment was settled. `amount` is what the plan cost; referral credit may have covered
  // part or all of it, so the cash line is the remainder — showing only the total would tell a
  // customer they paid cash they never sent.
  const settlement = (r: BillingHistoryRow) => {
    const cash = Math.max(0, r.amount - r.creditApplied);
    const lines: { method: string; amount: number }[] = [];
    if (r.creditApplied > 0) lines.push({ method: "Referral credit", amount: r.creditApplied });
    if (cash > 0 || lines.length === 0) lines.push({ method: METHOD_LABEL[r.method] ?? r.method, amount: cash });
    return lines;
  };

  const download = async (r: BillingHistoryRow) => {
    try {
      await downloadPdf({
        docType: "INVOICE",
        docNumber: receiptNumber(r),
        date: r.paidAt,
        status: "PAID",
        business: { name: "Allspire Technologies", currency: r.currency },
        partyLabel: "Bill to",
        party: { name: business?.name ?? "Your business" },
        items: [{ description: describe(r), quantity: 1, unit_price: r.amount, line_total: r.amount }],
        subtotal: r.amount,
        total: r.amount,
        payments: settlement(r),
        formatMoney: pdfMoneyFormatter(r.currency),
        notes: "Thank you for subscribing to iTrova.",
      }, `itrova-receipt-${receiptNumber(r)}.pdf`);
    } catch (e) {
      toast.error((e as Error).message || "Couldn't build the receipt");
    }
  };

  if (!failed && rows !== null && rows.length === 0) return null;   // nothing paid yet — don't show an empty card

  return (
    <Card data-testid="billing-history" className="shadow-card border-border/60">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-lg bg-brand-light grid place-items-center text-brand"><Receipt className="size-4" /></div>
          <div>
            <CardTitle className="font-display text-lg">Billing history</CardTitle>
            <CardDescription>Every subscription payment on your account.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {failed ? (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm text-muted-foreground">Couldn't load your billing history.</p>
            <Button variant="outline" size="sm" onClick={load}>Try again</Button>
          </div>
        ) : rows === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            {paged.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 rounded-lg bg-muted/40 p-3 flex-wrap">
                <div className="min-w-0">
                  <div className="font-medium text-brand-dark truncate">{describe(r)}</div>
                  <div className="text-xs text-muted-foreground">
                    {fmtDate(r.paidAt)} · {METHOD_LABEL[r.method] ?? r.method}
                    {r.creditApplied > 0 && r.creditApplied < r.amount &&
                      ` · includes ${money(r.creditApplied, r.currency)} referral credit`}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-display font-semibold tabular-nums text-brand-dark">{money(r.amount, r.currency)}</span>
                  <Badge variant="outline" className="text-[10px] bg-brand-light text-brand border-brand/20">Paid</Badge>
                  {/* Max 3 row actions: the pair lives in a menu to keep the row readable on mobile. */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" aria-label={`Actions for ${describe(r)}`}>
                        <MoreHorizontal className="size-4" /> More
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setViewing(r)}><Eye className="size-4 mr-2" /> View invoice</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => download(r)}><Download className="size-4 mr-2" /> Download invoice</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            ))}
            {pageCount > 1 && (
              <Paginator page={page} pageCount={pageCount} pageSize={pageSize} total={total}
                onPageChange={setPage} onPageSizeChange={setPageSize} />
            )}
          </>
        )}
      </CardContent>

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent variant="wide">
          <DialogHeader><DialogTitle>Invoice {viewing ? receiptNumber(viewing) : ""}</DialogTitle></DialogHeader>
          {viewing && (
            <div className="space-y-4 text-sm">
              <div className="flex justify-between gap-4 flex-wrap">
                <div>
                  <p className="text-xs text-muted-foreground">Billed to</p>
                  <p className="font-medium text-brand-dark">{business?.name ?? "Your business"}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Date paid</p>
                  <p className="font-medium text-brand-dark">{fmtDate(viewing.paidAt)}</p>
                </div>
              </div>
              <div className="rounded-lg border border-border divide-y divide-border">
                <div className="flex justify-between gap-4 p-3">
                  <span>{describe(viewing)}</span>
                  <span className="tabular-nums">{money(viewing.amount, viewing.currency)}</span>
                </div>
                <div className="flex justify-between gap-4 p-3 font-semibold text-brand-dark">
                  <span>Total</span>
                  <span className="tabular-nums">{money(viewing.amount, viewing.currency)}</span>
                </div>
                {/* How it was settled — the lines add up to the total, so referral credit is never
                    presented as cash the customer sent. */}
                {settlement(viewing).map((s) => (
                  <div key={s.method} className="flex justify-between gap-4 p-3 text-muted-foreground">
                    <span>Paid with {s.method.toLowerCase()}</span>
                    <span className="tabular-nums">{money(s.amount, viewing.currency)}</span>
                  </div>
                ))}
              </div>
              {viewing.reference && <div className="text-xs text-muted-foreground">Ref {viewing.reference}</div>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewing(null)}>Close</Button>
            {viewing && <Button onClick={() => download(viewing)}><Download className="size-4" /> Download</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
