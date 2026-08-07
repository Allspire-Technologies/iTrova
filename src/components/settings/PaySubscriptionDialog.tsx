import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Building2, CreditCard, CheckCircle2, Loader2, ExternalLink } from "lucide-react";
import { createPayment, latestPaymentStatus, type PaymentStart } from "@/lib/billing";
import { useAuth } from "@/contexts/AuthContext";

/** Pay for a plan by bank transfer or card, both settled on Monnify with the amount locked in.
 *  The amount shown is the server's quote, not a figure computed here — see src/lib/billing.ts. */
export default function PaySubscriptionDialog({
  open, onOpenChange, planKey, planName, cycle, currency = "NGN", onPaid,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  planKey: string; planName: string; cycle: string; currency?: string;
  /** Fires once the webhook confirms payment (after the auth context refresh). */
  onPaid?: () => void;
}) {
  const { refresh } = useAuth();
  const [start, setStart] = useState<PaymentStart | null>(null);
  const [busy, setBusy] = useState(false);
  const [paid, setPaid] = useState(false);
  const [failed, setFailed] = useState(false);
  const poll = useRef<number | null>(null);

  const money = (n: number) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: 0 }).format(n);

  const begin = async (method: "transfer" | "card") => {
    setBusy(true);
    try {
      const s = await createPayment(planKey, cycle, method);
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

  // Money arrives out-of-band (the customer's bank app), so watch for the webhook to land.
  // Both outcomes are terminal: stop polling on paid AND on mismatch (no toast every 5s).
  useEffect(() => {
    if (!start?.reference || paid || failed) return;
    poll.current = window.setInterval(async () => {
      const status = await latestPaymentStatus(start.reference);
      if (status === "paid") {
        setPaid(true);
        toast.success("Payment received — your plan is active.");
        await refresh();
        onPaid?.();
      } else if (status === "mismatch") {
        setFailed(true);
        toast.warning("The amount received didn't match — your plan isn't active yet. Please contact us.");
      }
    }, 5000);
    return () => { if (poll.current) window.clearInterval(poll.current); };
  }, [start?.reference, paid, failed, refresh, onPaid]);

  useEffect(() => { if (!open) { setStart(null); setPaid(false); setFailed(false); } }, [open]);


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
            <p className="font-display text-lg font-semibold text-brand-dark">Payment received</p>
            <p className="text-sm text-muted-foreground">Your {planName} plan is now active.</p>
          </div>
        ) : !start ? (
          <div className="space-y-4">
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
            {busy && <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 className="size-3.5 animate-spin" /> Setting up your payment…</p>}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl bg-muted/40 px-4 py-3">
              <div className="text-xs text-muted-foreground">Amount to pay</div>
              <div className="font-display text-2xl font-bold text-brand-dark">{money(start.amount)}</div>
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
