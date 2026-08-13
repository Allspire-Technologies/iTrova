import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Building2, CreditCard, CheckCircle2, Loader2, ExternalLink, Gift } from "lucide-react";
import { createPayment, latestPaymentStatus, paymentQuote, type PaymentQuote, type PaymentStart } from "@/lib/billing";
import { useAuth } from "@/contexts/AuthContext";

/** Pay for a plan by bank transfer or card, settled on whichever provider the platform has
 *  active, with the amount locked to the transaction. Referral credit can offset the price:
 *  it covers part (the provider is asked for the rest) or all of it (no provider at all).
 *  Every figure here is the server's quote, not a number computed in the browser — see
 *  src/lib/billing.ts. */
export default function PaySubscriptionDialog({
  open, onOpenChange, planKey, planName, cycle, currency = "NGN", onPaid,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  planKey: string; planName: string; cycle: string; currency?: string;
  /** Fires once payment is confirmed (after the auth context refresh). */
  onPaid?: () => void;
}) {
  const { refresh } = useAuth();
  const [quote, setQuote] = useState<PaymentQuote | null>(null);
  const [loadingQuote, setLoadingQuote] = useState(false);
  const [useCredit, setUseCredit] = useState(true);
  const [start, setStart] = useState<PaymentStart | null>(null);
  const [busy, setBusy] = useState(false);
  const [paid, setPaid] = useState(false);
  const [paidWithCredit, setPaidWithCredit] = useState(0);
  const [failed, setFailed] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  // The poll ticks against the LATEST callbacks without restarting the interval every time a
  // parent render hands down a new function identity.
  const refreshRef = useRef(refresh);
  const onPaidRef = useRef(onPaid);
  useEffect(() => { refreshRef.current = refresh; onPaidRef.current = onPaid; });

  const money = (n: number) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: 0 }).format(n);

  // What this payment costs and what credit could cover — priced server-side each time the dialog
  // opens, so a balance spent elsewhere (or earned since) is never stale on screen.
  useEffect(() => {
    if (!open || !planKey || !cycle) return;
    let cancelled = false;
    setLoadingQuote(true);
    paymentQuote(planKey, cycle)
      .then(q => { if (!cancelled) setQuote(q); })
      .catch(e => {
        if (cancelled) return;
        console.error("payment quote failed:", e);
        setQuote(null);   // the picker still works; the server prices it again on submit
      })
      .finally(() => { if (!cancelled) setLoadingQuote(false); });
    return () => { cancelled = true; };
  }, [open, planKey, cycle]);

  const creditApplied = useCredit ? (quote?.creditApplicable ?? 0) : 0;
  const due = Math.max(0, (quote?.amount ?? 0) - creditApplied);
  const hasCredit = (quote?.creditAvailable ?? 0) > 0;
  const fullyCovered = !!quote && useCredit && due === 0;

  const succeed = useCallback(async (credit: number) => {
    setPaid(true);
    setPaidWithCredit(credit);
    await refreshRef.current();
    onPaidRef.current?.();
  }, []);

  const begin = async (method: "transfer" | "card") => {
    setBusy(true);
    try {
      const s = await createPayment(planKey, cycle, method, useCredit);
      // The server re-prices and re-checks the balance, so it may find credit covers everything
      // even when this screen offered a method — then the plan is already active.
      if (s.activated) {
        toast.success("Your referral credit covered it — your plan is active.");
        await succeed(Number(s.credit_applied ?? creditApplied));
        return;
      }
      // Both methods finish on the provider's page, which has the amount bound to the transaction —
      // for a transfer it shows a one-time account for exactly this figure, so a wrong amount can't
      // be sent. No page back means nothing to wait for: stay on the picker instead of a dead end.
      if (!s.checkout_url) {
        toast.error("The payment page couldn't be created — please try again.");
        return;
      }
      setStart(s);
      // SAME-TAB hand-off: the provider returns the customer to this page (?paid=…) when done, so
      // there's never a second app tab. The waiting state below only shows if they come back via
      // the browser's Back button, where the poll picks up a payment that already landed.
      window.location.assign(s.checkout_url);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Credit covers the whole price: nothing to collect, so this activates directly. The server
  // re-reads the price AND the balance under a lock before it agrees.
  const payWithCredit = async () => {
    setBusy(true);
    try {
      const s = await createPayment(planKey, cycle, "transfer", true);
      if (!s.activated) {
        toast.error("Your credit no longer covers this plan — please reopen the payment.");
        return;
      }
      toast.success("Your plan is active — paid with referral credit.");
      await succeed(Number(s.credit_applied ?? creditApplied));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Money arrives out-of-band (the customer's bank app), so watch for the webhook to land.
  // Terminal states: paid, mismatch, and a 5-minute deadline — an unreachable webhook must
  // present as "we haven't seen it yet", never as an indefinite spinner.
  useEffect(() => {
    if (!start?.reference || paid || failed || timedOut) return;
    let attempts = 0;
    const id = window.setInterval(async () => {
      const status = await latestPaymentStatus(start.reference);
      if (status === "paid") {
        toast.success("Payment received — your plan is active.");
        await succeed(Number(start.credit_applied ?? 0));
      } else if (status === "mismatch") {
        setFailed(true);
        toast.warning("The amount received didn't match — your plan isn't active yet. Please contact us.");
      } else if (++attempts >= 60) {
        setTimedOut(true);
      }
    }, 5000);
    return () => window.clearInterval(id);
  }, [start?.reference, start?.credit_applied, paid, failed, timedOut, succeed]);

  useEffect(() => {
    if (!open) {
      setStart(null); setPaid(false); setPaidWithCredit(0); setFailed(false);
      setTimedOut(false); setQuote(null); setUseCredit(true);
    }
  }, [open]);

  const q = start?.quote;
  // Display only — the server chose the provider; we just name the page we opened.
  const providerName = start?.provider === "paystack" ? "Paystack" : "Monnify";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="wide">
        <DialogHeader><DialogTitle>Pay for {planName}</DialogTitle></DialogHeader>

        {paid ? (
          <div className="py-6 text-center space-y-2">
            <CheckCircle2 className="size-10 text-brand mx-auto" />
            <p className="font-display text-lg font-semibold text-brand-dark">
              {paidWithCredit > 0 && start === null ? "Credit applied" : "Payment received"}
            </p>
            <p className="text-sm text-muted-foreground">
              Your {planName} plan is now active.
              {paidWithCredit > 0 && ` ${money(paidWithCredit)} of referral credit was used.`}
            </p>
          </div>
        ) : !start ? (
          <div className="space-y-4">
            {loadingQuote ? (
              <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                <Loader2 className="size-3.5 animate-spin" /> Working out your price…
              </p>
            ) : quote && (
              <div className="rounded-xl bg-muted/40 px-4 py-3 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Plan price</span>
                  <span className="font-medium">{money(quote.amount)}</span>
                </div>
                {quote.refereeDiscount > 0 && (
                  <Badge variant="outline" className="text-[10px] bg-brand-light text-brand border-brand/20">
                    Referral · {quote.refereeDiscount}% off your first payment
                  </Badge>
                )}
                {hasCredit && (
                  <>
                    <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-2">
                      <label htmlFor="use-credit" className="flex items-center gap-2 text-sm cursor-pointer">
                        <Gift className="size-4 text-brand" />
                        <span>Use my referral credit
                          <span className="text-muted-foreground"> · {money(quote.creditAvailable)} available</span>
                        </span>
                      </label>
                      <Switch id="use-credit" checked={useCredit} onCheckedChange={setUseCredit} />
                    </div>
                    {creditApplied > 0 && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Referral credit</span>
                        <span className="font-medium text-brand">−{money(creditApplied)}</span>
                      </div>
                    )}
                  </>
                )}
                <div className="flex items-center justify-between border-t border-border/60 pt-2">
                  <span className="text-sm text-muted-foreground">You pay</span>
                  <span className="font-display text-xl font-bold text-brand-dark">{money(due)}</span>
                </div>
                {hasCredit && creditApplied > 0 && quote.creditAvailable > creditApplied && (
                  <p className="text-xs text-muted-foreground">
                    {money(quote.creditAvailable - creditApplied)} of credit stays on your account.
                  </p>
                )}
              </div>
            )}

            {fullyCovered ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Your referral credit covers this plan in full — there's nothing to pay.
                </p>
                <Button variant="brand" onClick={payWithCredit} disabled={busy}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Gift className="size-4" />}
                  Confirm — use {money(creditApplied)} credit
                </Button>
              </div>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">How would you like to pay?</p>
                <div className="grid sm:grid-cols-2 gap-3">
                  <button type="button" onClick={() => begin("transfer")} disabled={busy}
                    className="rounded-xl border-2 border-border p-4 text-left hover:border-brand/50 transition-colors disabled:opacity-60">
                    <Building2 className="size-5 text-brand mb-2" />
                    <div className="font-medium">Bank transfer</div>
                    <div className="text-xs text-muted-foreground mt-0.5">You'll get a one-off account number for this exact amount.</div>
                  </button>
                  <button type="button" onClick={() => begin("card")} disabled={busy}
                    className="rounded-xl border-2 border-border p-4 text-left hover:border-brand/50 transition-colors disabled:opacity-60">
                    <CreditCard className="size-5 text-brand mb-2" />
                    <div className="font-medium">Card</div>
                    <div className="text-xs text-muted-foreground mt-0.5">Pay now with a debit card on a secure payment page.</div>
                  </button>
                </div>
              </>
            )}
            {busy && !fullyCovered && <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 className="size-3.5 animate-spin" /> Setting up your payment…</p>}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl bg-muted/40 px-4 py-3">
              <div className="text-xs text-muted-foreground">Amount to pay</div>
              <div className="font-display text-2xl font-bold text-brand-dark">{money(start.amount_due ?? start.amount)}</div>
              {Number(start.credit_applied ?? 0) > 0 && (
                <div className="text-xs text-muted-foreground mt-0.5">
                  after {money(Number(start.credit_applied))} referral credit
                </div>
              )}
              {q && q.referee_discount > 0 && (
                <Badge variant="outline" className="mt-1 text-[10px] bg-brand-light text-brand border-brand/20">
                  Referral · {q.referee_discount}% off your first payment
                </Badge>
              )}
            </div>

            <p className="text-sm text-muted-foreground">
              {start.method === "transfer"
                ? `Complete the transfer on ${providerName}'s secure page — it shows a one-off account number for this exact amount.`
                : `Complete your card payment on ${providerName}'s secure page.`}
              {" "}You'll be brought back here automatically, and your plan activates once {providerName} confirms the payment.
            </p>
            {start.checkout_url && (
              <Button variant="outline" size="sm" onClick={() => window.location.assign(start.checkout_url!)}>
                <ExternalLink className="size-4" /> Return to the payment page
              </Button>
            )}
            {failed ? (
              <p className="text-xs text-destructive">
                The amount received didn't match, so your plan isn't active. Contact us and we'll sort it out.
              </p>
            ) : timedOut ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  We haven't seen the confirmation yet. If you've paid, it can take a few minutes to land —
                  check Billing history shortly, or contact us if it doesn't appear.
                </p>
                <Button variant="outline" size="sm" onClick={() => setTimedOut(false)}>Check again</Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Loader2 className="size-3.5 animate-spin" /> Waiting for confirmation… you can close this and come back.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{paid ? "Done" : "Close"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
