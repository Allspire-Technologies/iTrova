import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Store, Sparkles, LayoutGrid, Gauge, Check } from "lucide-react";
import { CURRENCY_OPTIONS } from "@/lib/format";
import SearchableSelect from "@/components/SearchableSelect";
import { MODULE_CHOICES, SCALE_QUESTIONS, recommendPlan, type ScaleAnswers } from "@/lib/planRecommend";
import { effectivePrice, cyclePrice, CYCLE_LABEL } from "@/lib/planPricing";
import ConfirmDialog from "@/components/ConfirmDialog";
import { lazy, Suspense } from "react";

const PaySubscriptionDialog = lazy(() => import("@/components/settings/PaySubscriptionDialog"));

// Onboarding: business basics → module picker → scale bands →
// plan recommendation (with an optional one-off 7-day trial) → done. The module/scale selection is
// informational — it drives the recommendation and is stored on the business for follow-up, but
// never gates the UI (the plan does that).

export default function OnboardingDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { business, user, profile, plans, refresh } = useAuth();
  const [step, setStep] = useState(0);
  const [payOpen, setPayOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const [bizName, setBizName] = useState(business?.name || "");
  const [currency, setCurrency] = useState(business?.currency || "NGN");

  const [picked, setPicked] = useState<string[]>([]);
  const [scale, setScale] = useState<ScaleAnswers>({});
  const [trialStarted, setTrialStarted] = useState(false);
  const [closeConfirm, setCloseConfirm] = useState(false);

  const total = 4;
  const pct = Math.round((step / (total - 1)) * 100);

  const reco = useMemo(() => recommendPlan(picked, scale, plans), [picked, scale, plans]);
  const trialUsed = !!business?.trial_started_at;

  const toggleModule = (key: string) =>
    setPicked(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]));

  const money = (amount: number, curr: string) => {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: curr, maximumFractionDigits: 0 }).format(amount);
    } catch {
      return `${curr} ${amount.toLocaleString()}`;
    }
  };

  const finish = async (message = "You're all set!") => {
    if (!user) return;
    const { error } = await supabase.from("profiles").update({ onboarded: true }).eq("id", user.id);
    if (error) throw error;
    await refresh();
    onClose();
    toast.success(message);
  };

  // Closing early (X / Escape) asks first — the recommendation + trial offer only lives here.
  const skipSetup = async () => {
    setBusy(true);
    try {
      await finish("Setup skipped — you can upgrade anytime in Settings → Billing.");
    } catch (e: any) {
      toast.error(e.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  // The billing cycle to charge for. Monthly is what the recommendation quotes, so pay for that;
  // fall back to whatever the plan actually offers if monthly isn't priced.
  // recommendPlan returns a narrowed shape without prices, so read the cycles off the catalogue.
  const recoFull = reco.kind === "plan" ? plans.find(p => p.key === reco.plan.key) : undefined;
  const recoPrice =
    (recoFull?.prices ?? []).find(p => p.is_active && p.cycle === "monthly")
    ?? (recoFull?.prices ?? []).find(p => p.is_active)
    ?? null;
  const recoCycle = recoPrice?.cycle ?? "monthly";
  // A business that signed up with someone's referral code gets a first-payment discount. It was
  // already applied where it matters (the server prices every payment), but the wizard quoted the
  // undiscounted figure — so a referred business saw one number here and a smaller one at checkout.
  // Server-validated: my_referee_discount returns 0 unless the code is real and nothing has been
  // paid yet. Read once when the wizard opens; the quote in the pay dialog stays authoritative.
  const [refereeDiscount, setRefereeDiscount] = useState(0);
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc("my_referee_discount")
      .then(({ data }: { data: unknown }) => setRefereeDiscount(Number(data) || 0))
      .catch(() => setRefereeDiscount(0));
  }, [open]);

  // What the button charges: the price of THE CYCLE BEING SOLD, with its standing discount, any
  // promo, and the referral discount — not the plan's monthly base.
  const recoBase = reco.kind === "plan"
    ? (recoPrice
        ? cyclePrice(Number(recoPrice.price_amount), Number(recoPrice.discount_percent ?? 0), reco.plan.promo_percent ?? 0, reco.plan.promo_until)
        : effectivePrice(reco.plan.price_amount, reco.plan.promo_percent ?? 0, reco.plan.promo_until))
    : 0;
  const recoAmount = refereeDiscount > 0 ? Math.round(recoBase * (1 - refereeDiscount / 100)) : recoBase;

  const startTrial = async () => {
    if (reco.kind !== "plan") return;
    setBusy(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await supabase.rpc("start_plan_trial" as any, { _plan_key: reco.plan.key });
      if (error) throw error;
      setTrialStarted(true);
      toast.success(`${reco.plan.name} trial started — 7 days, on us.`);
      await refresh();
    } catch (e: any) {
      const msg: string = e?.message || "Couldn't start the trial";
      toast.error(msg.includes("TRIAL_DENIED") ? msg.split("TRIAL_DENIED:")[1]?.trim() || "Trial not available" : msg);
    } finally {
      setBusy(false);
    }
  };

  const next = async () => {
    if (!business || !user) return;
    setBusy(true);
    try {
      if (step === 0) {
        if (bizName !== business.name || currency !== business.currency) {
          const { error } = await supabase.from("businesses").update({ name: bizName, currency }).eq("id", business.id);
          if (error) throw error;
        }
      } else if (step === 2) {
        // Persist the selection once both picker steps are done — even "Maybe later" businesses
        // leave a trail of what they wanted (sales follow-up, future plan design).
        const { error } = await supabase.from("businesses")
          .update({ onboarding_profile: { modules: picked, scale } })
          .eq("id", business.id);
        if (error) throw error;
      } else if (step === 3) {
        await finish();
        return;
      }
      setStep(step + 1);
    } catch (e: any) {
      toast.error(e.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const skip = async () => {
    if (step < 3) setStep(step + 1);
    else await next();
  };

  const stepIcon =
    step === 0 ? <Store className="size-5" /> :
    step === 1 ? <LayoutGrid className="size-5" /> :
    step === 2 ? <Gauge className="size-5" /> :
    <Sparkles className="size-5" />;

  const stepTitle =
    step === 0 ? `Welcome, ${profile?.owner_name?.split(" ")[0] || "there"}!` :
    step === 1 ? "What will you use?" :
    step === 2 ? "How big is your operation?" :
    "You're ready!";

  return (
    <>
    {/* X / Escape don't dismiss outright — the confirm below guards the one-time trial offer. */}
    <Dialog open={open} onOpenChange={(o) => { if (!o) setCloseConfirm(true); }}>
      <DialogContent variant="wide" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <div className="size-12 rounded-xl bg-gradient-brand grid place-items-center text-brand-foreground mx-auto mb-2">
            {stepIcon}
          </div>
          <DialogTitle className="font-display text-center text-2xl">{stepTitle}</DialogTitle>
          <p className="text-center text-sm text-muted-foreground">Step {Math.min(step + 1, total)} of {total}</p>
        </DialogHeader>

        <Progress value={pct} className="h-1" />

        {step === 0 && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground text-center">Let's confirm your business details.</p>
            <div className="space-y-2"><Label>Business name</Label><Input value={bizName} onChange={(e) => setBizName(e.target.value)} placeholder="My Business" /></div>
            <div className="space-y-2"><Label>Currency</Label><SearchableSelect value={currency} onValueChange={setCurrency} options={CURRENCY_OPTIONS} placeholder="Select currency" /></div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground text-center">Pick everything you plan to use — we'll suggest the right plan.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1">
              {MODULE_CHOICES.map(m => {
                const on = picked.includes(m.key);
                return (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => toggleModule(m.key)}
                    aria-pressed={on}
                    className={`rounded-lg border p-3 text-left transition-colors ${on ? "border-brand bg-brand-light/40" : "border-border/60 hover:border-brand/40"}`}
                  >
                    <span className="flex items-center gap-1.5 text-sm font-medium text-brand-dark">
                      <span className={`size-4 rounded grid place-items-center border ${on ? "bg-brand border-brand text-brand-foreground" : "border-border"}`}>
                        {on && <Check className="size-3" />}
                      </span>
                      {m.label}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">{m.blurb}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground text-center">A rough idea is enough — this helps us match plan limits.</p>
            {SCALE_QUESTIONS.map(q => (
              <div key={q.resource} className="space-y-1.5">
                <Label>{q.question}</Label>
                <div className="flex flex-wrap gap-2">
                  {q.bands.map(b => {
                    const on = scale[q.resource] === b.key;
                    return (
                      <button
                        key={b.key}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setScale(prev => ({ ...prev, [q.resource]: on ? undefined : b.key }))}
                        className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${on ? "border-brand bg-brand text-brand-foreground" : "border-border/60 text-brand-dark hover:border-brand/40"}`}
                      >
                        {b.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3 py-1">
            {reco.kind === "free" && (
              <p className="text-sm text-muted-foreground text-center">
                Good news — the <span className="font-medium text-brand-dark">Free plan</span> has great modules and sizeable limits.
                You can upgrade any time from Settings → Billing as you grow.
              </p>
            )}
            {reco.kind === "plan" && (
              <div className="rounded-xl border-2 border-brand/30 bg-brand-light/20 p-4 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recommended for you</p>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-display text-xl font-bold text-brand-dark">{reco.plan.name}</p>
                  <p className="text-sm text-brand-dark">
                    {money(effectivePrice(reco.plan.price_amount, reco.plan.promo_percent ?? 0, reco.plan.promo_until), reco.plan.price_currency || "NGN")}
                    <span className="text-muted-foreground">/month</span>
                  </p>
                </div>
                <p className="text-sm text-muted-foreground">Covers all the modules you picked at the scale you expect.</p>
                {trialStarted ? (
                  <p className="text-sm font-medium text-brand flex items-center gap-1.5"><Check className="size-4" /> Trial active — 7 days on us.</p>
                ) : (
                  <div className="space-y-2 pt-1">
                    {!trialUsed && (
                      <Button variant="brand" className="w-full" onClick={startTrial} disabled={busy}>
                        Start 7-day free trial
                      </Button>
                    )}
                    {/* Pay right here — this is peak intent. It used to open a WhatsApp message and
                        hand the customer to a human, which lost the moment. */}
                    <Button variant="outline" className="w-full" onClick={() => setPayOpen(true)} disabled={busy}>
                      Upgrade now — pay {money(recoAmount, reco.plan.price_currency || "NGN")}{recoCycle !== "monthly" ? ` · ${CYCLE_LABEL[recoCycle]}` : ""}
                    </Button>
                    <Button variant="ghost" className="w-full text-muted-foreground" onClick={() => next()} disabled={busy}>
                      Use iTrova for Free for now
                    </Button>
                  </div>
                )}
              </div>
            )}
            {reco.kind === "custom" && (
              <p className="text-sm text-muted-foreground text-center">
                Your needs go beyond our standard plans — we'll set you up with a custom plan.{" "}
                <a className="text-brand underline" href="mailto:sales@allspire.tech?subject=Custom%20Plan%20enquiry">Contact sales</a> and
                start on Free in the meantime.
              </p>
            )}
            <p className="text-sm text-muted-foreground text-center">
              From here you can record sales, track stock and manage suppliers — everything updates in real time.
            </p>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-2">
          <div className="flex items-center gap-1">
            {step > 0 && (
              <Button variant="ghost" onClick={() => setStep(step - 1)} disabled={busy}>Back</Button>
            )}
            {step < 3 && (
              <Button variant="ghost" className="text-muted-foreground" onClick={skip} disabled={busy}>Skip</Button>
            )}
          </div>
          <Button variant="brand" onClick={next} disabled={busy || (step === 0 && !bizName.trim())}>
            {busy ? "Saving..." : step === 3 ? "Start using iTrova" : "Continue"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    {/* Paying from onboarding: once the webhook CONFIRMS payment the plan is live, so close setup
        rather than leaving them on a screen still offering the trial they just paid past. Closing
        the dialog without paying keeps onboarding open — the tier alone is not proof of payment. */}
    {payOpen && reco.kind === "plan" && (
      <Suspense fallback={null}>
        <PaySubscriptionDialog
          open={payOpen}
          onOpenChange={setPayOpen}
          onPaid={() => { finish(`You're on ${reco.plan.name} — welcome aboard.`).catch(() => onClose()); }}
          planKey={reco.plan.key} planName={reco.plan.name} cycle={recoCycle}
          currency={reco.plan.price_currency || "NGN"}
        />
      </Suspense>
    )}

    <ConfirmDialog
      open={closeConfirm}
      onOpenChange={setCloseConfirm}
      variant="default"
      title="Leave setup?"
      description="You're a few steps from your plan recommendation and the one-time 7-day free trial offer. Skip now and you can still upgrade later from Settings → Billing."
      confirmLabel="Skip setup"
      onConfirm={skipSetup}
    />
    </>
  );
}
