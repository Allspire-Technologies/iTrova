import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Copy, Building2, CreditCard, CheckCircle2, Loader2 } from "lucide-react";
import { createPayment, latestPaymentStatus, type PaymentStart } from "@/lib/billing";
import { useAuth } from "@/contexts/AuthContext";

/** Pay for a plan by bank transfer (a dedicated account per business) or by card.
 *  The amount shown is the server's quote, not a figure computed here — see src/lib/billing.ts. */
export default function PaySubscriptionDialog({
  open, onOpenChange, planKey, planName, cycle, currency = "NGN",
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  planKey: string; planName: string; cycle: string; currency?: string;
}) {
  const { refresh } = useAuth();
  const [start, setStart] = useState<PaymentStart | null>(null);
  const [busy, setBusy] = useState(false);
  const [paid, setPaid] = useState(false);
  const poll = useRef<number | null>(null);

  const money = (n: number) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: 0 }).format(n);

  const begin = async (method: "transfer" | "card") => {
    setBusy(true);
    try {
      const s = await createPayment(planKey, cycle, method);
      setStart(s);
      if (method === "card" && s.checkout_url) window.open(s.checkout_url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Money arrives out-of-band (the customer's bank app), so watch for the webhook to land.
  useEffect(() => {
    if (!start?.reference || paid) return;
    poll.current = window.setInterval(async () => {
      const status = await latestPaymentStatus(start.reference);
      if (status === "paid") {
        setPaid(true);
        toast.success("Payment received — your plan is active.");
        refresh();
      } else if (status === "underpaid") {
        toast.warning("We received less than the full amount — it's been held as credit. Contact us to sort it out.");
      }
    }, 5000);
    return () => { if (poll.current) window.clearInterval(poll.current); };
  }, [start?.reference, paid, refresh]);

  useEffect(() => { if (!open) { setStart(null); setPaid(false); } }, [open]);

  const copy = async (text: string, label: string) => {
    try { await navigator.clipboard.writeText(text); toast.success(`${label} copied`); }
    catch { toast.error("Couldn't copy — long-press to copy instead"); }
  };

  const q = start?.quote;

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
              <button onClick={() => begin("transfer")} disabled={busy}
                className="rounded-xl border-2 border-border p-4 text-left hover:border-brand/50 transition-colors disabled:opacity-60">
                <Building2 className="size-5 text-brand mb-2" />
                <div className="font-medium">Bank transfer</div>
                <div className="text-xs text-muted-foreground mt-0.5">Transfer from any bank app to your own iTrova account number.</div>
              </button>
              <button onClick={() => begin("card")} disabled={busy}
                className="rounded-xl border-2 border-border p-4 text-left hover:border-brand/50 transition-colors disabled:opacity-60">
                <CreditCard className="size-5 text-brand mb-2" />
                <div className="font-medium">Card</div>
                <div className="text-xs text-muted-foreground mt-0.5">Pay now with a debit card on Monnify's secure page.</div>
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

            {start.method === "transfer" ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Transfer <strong className="text-foreground">exactly {money(start.amount)}</strong> to the account below.
                  Your plan activates automatically once it arrives — usually within a minute.
                </p>
                <div className="space-y-2">
                  {(start.accounts ?? []).map((a) => (
                    <div key={a.accountNumber} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                      <div className="min-w-0">
                        <div className="font-mono text-lg font-semibold tracking-wider text-brand-dark">{a.accountNumber}</div>
                        <div className="text-xs text-muted-foreground truncate">{a.bankName}{a.accountName ? ` · ${a.accountName}` : ""}</div>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => copy(a.accountNumber, "Account number")}>
                        <Copy className="size-4" /> Copy
                      </Button>
                    </div>
                  ))}
                  {(start.accounts ?? []).length === 0 && (
                    <p className="text-sm text-destructive">No account was returned — please contact support.</p>
                  )}
                </div>
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Loader2 className="size-3.5 animate-spin" /> Waiting for your transfer… you can close this and come back.
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                We've opened Monnify's secure payment page in a new tab. Once you've paid, your plan activates
                automatically — come back here and it'll be live.
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
