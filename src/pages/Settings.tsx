import { useEffect, useState } from "react";
import { useAuth, type Plan } from "@/contexts/AuthContext";
import { CYCLE_ORDER, CYCLE_LABEL, CYCLE_PERIOD, isPromoActive, cyclePrice, type BillingCycle } from "@/lib/planPricing";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import SearchableSelect from "@/components/SearchableSelect";
import { CURRENCY_OPTIONS } from "@/lib/format";
import { INDUSTRY_OPTIONS } from "@/lib/industries";
import { useDateFormat } from "@/hooks/useDateFormat";
import { SETTINGS_PAGE_CLASS, SETTINGS_FIELD_GRID, SETTINGS_PLANS_GRID } from "@/lib/settingsLayout";
import { highestCataloguePlan, previousCataloguePlan, includesAll, featuresBeyond, planChangeAction, type PlanChange } from "@/lib/planFeatures";
import { isDirty, isPasswordFormReady } from "@/lib/settingsForms";
import { toast } from "sonner";
import { Eye, EyeOff, Building2, Globe, Bell, Link2, CreditCard, Shield, CheckCircle2, Scale, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { LEGAL_LINKS } from "@/lib/legalLinks";
import { isEmailConfirmed, isValidEmail, normalizeEmail, verifyAction } from "@/lib/emailVerification";

const TIMEZONES = [
  // Africa
  { value: "Africa/Abidjan", label: "Africa/Abidjan (UTC+0) — Ivory Coast" },
  { value: "Africa/Accra", label: "Africa/Accra (UTC+0) — Ghana" },
  { value: "Africa/Lagos", label: "Africa/Lagos (UTC+1) — Nigeria" },
  { value: "Africa/Casablanca", label: "Africa/Casablanca (UTC+1) — Morocco" },
  { value: "Africa/Cairo", label: "Africa/Cairo (UTC+2) — Egypt" },
  { value: "Africa/Johannesburg", label: "Africa/Johannesburg (UTC+2) — South Africa" },
  { value: "Africa/Nairobi", label: "Africa/Nairobi (UTC+3) — Kenya, E. Africa" },
  // Universal & Europe
  { value: "UTC", label: "UTC" },
  { value: "Europe/London", label: "Europe/London (UTC+0/+1) — UK" },
  { value: "Europe/Paris", label: "Europe/Paris (UTC+1/+2) — Central Europe" },
  { value: "Europe/Istanbul", label: "Europe/Istanbul (UTC+3) — Türkiye" },
  // Middle East & Asia
  { value: "Asia/Dubai", label: "Asia/Dubai (UTC+4) — UAE" },
  { value: "Asia/Karachi", label: "Asia/Karachi (UTC+5) — Pakistan" },
  { value: "Asia/Kolkata", label: "Asia/Kolkata (UTC+5:30) — India" },
  { value: "Asia/Dhaka", label: "Asia/Dhaka (UTC+6) — Bangladesh" },
  { value: "Asia/Singapore", label: "Asia/Singapore (UTC+8) — Singapore" },
  { value: "Asia/Shanghai", label: "Asia/Shanghai (UTC+8) — China" },
  { value: "Asia/Tokyo", label: "Asia/Tokyo (UTC+9) — Japan" },
  // Americas
  { value: "America/Sao_Paulo", label: "America/Sao_Paulo (UTC−3) — Brazil" },
  { value: "America/New_York", label: "America/New_York (UTC−5/−4) — US Eastern" },
  { value: "America/Chicago", label: "America/Chicago (UTC−6/−5) — US Central" },
  { value: "America/Denver", label: "America/Denver (UTC−7/−6) — US Mountain" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles (UTC−8/−7) — US Pacific" },
  { value: "Pacific/Honolulu", label: "Pacific/Honolulu (UTC−10) — Hawaii" },
  // Oceania
  { value: "Australia/Sydney", label: "Australia/Sydney (UTC+10/+11) — Australia East" },
  { value: "Pacific/Auckland", label: "Pacific/Auckland (UTC+12/+13) — New Zealand" },
];

type NotifPrefs = { low_stock_alerts: boolean; overdue_invoice_alerts: boolean; expiry_alerts: boolean; daily_summary: boolean };
const DEFAULT_PREFS: NotifPrefs = { low_stock_alerts: true, overdue_invoice_alerts: true, expiry_alerts: true, daily_summary: false };

function PlanCard({ plan, inheritsFrom, action, currentPlan, businessName }: { plan: Plan; inheritsFrom: { name: string; features: string[] } | null; action: PlanChange; currentPlan: string; businessName: string }) {
  const active = plan.key === currentPlan;
  const shownFeatures = inheritsFrom ? featuresBeyond(plan.features || [], inheritsFrom.features) : (plan.features || []);
  const cycles = (plan.prices || [])
    .filter(p => p.is_active)
    .sort((a, b) => CYCLE_ORDER.indexOf(a.cycle) - CYCLE_ORDER.indexOf(b.cycle));
  const [cycle, setCycle] = useState<BillingCycle>(cycles[0]?.cycle ?? "monthly");
  const selected = cycles.find(p => p.cycle === cycle) ?? cycles[0];
  const base = selected ? Number(selected.price_amount) : Number(plan.price_amount);
  const cycleDiscount = selected ? Number(selected.discount_percent) : 0;
  const promoOn = isPromoActive(plan.promo_percent, plan.promo_until);
  const effective = cyclePrice(base, cycleDiscount, plan.promo_percent, plan.promo_until);
  const money = (n: number) =>
    n === 0
      ? "Free"
      : new Intl.NumberFormat(undefined, { style: "currency", currency: plan.price_currency || "NGN", currencyDisplay: "narrowSymbol", maximumFractionDigits: 0 }).format(n);

  return (
    <div className={`rounded-xl border-2 p-4 flex flex-col gap-3 transition-colors ${active ? "border-brand bg-brand-light/30" : "border-border/60"}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-display font-semibold text-brand-dark">{plan.name}</span>
        <div className="flex items-center gap-1.5">
          {plan.business_id && <Badge variant="outline" className="text-[10px] bg-secondary">Custom</Badge>}
          {active && <CheckCircle2 className="size-4 text-brand" />}
        </div>
      </div>

      {cycles.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {cycles.map(p => (
            <button
              key={p.cycle}
              onClick={() => setCycle(p.cycle)}
              className={`text-[11px] px-2 py-1 rounded-md border transition-colors ${cycle === p.cycle ? "bg-brand text-brand-foreground border-brand" : "border-border text-muted-foreground hover:border-brand/40"}`}
            >
              {CYCLE_LABEL[p.cycle]}
            </button>
          ))}
        </div>
      )}

      <div>
        <div className="flex items-baseline gap-1.5 flex-wrap">
          {effective < base && <span className="text-sm text-muted-foreground line-through">{money(base)}</span>}
          <span className="text-2xl font-display font-bold text-brand-dark">{money(effective)}</span>
          {base > 0 && <span className="text-xs text-muted-foreground">/{CYCLE_PERIOD[cycle]}</span>}
        </div>
        <div className="flex flex-wrap gap-1.5 mt-1.5 empty:hidden">
          {selected && Number(selected.discount_percent) > 0 && (
            <Badge variant="outline" className="text-[10px] bg-brand-light text-brand border-brand/20">Save {Number(selected.discount_percent)}%</Badge>
          )}
          {promoOn && (
            <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">{plan.promo_label || "Promo"} · {Number(plan.promo_percent)}% off</Badge>
          )}
        </div>
      </div>

      <ul className="space-y-1.5 flex-1">
        {inheritsFrom && (
          <li className="text-xs font-medium text-brand-dark flex items-start gap-1.5">
            <span className="text-brand shrink-0 mt-0.5">✓</span>
            Everything in {inheritsFrom.name}
          </li>
        )}
        {shownFeatures.map(f => (
          <li key={f} className="text-xs text-muted-foreground flex items-start gap-1.5">
            <span className="text-brand shrink-0 mt-0.5">✓</span>
            {f}
          </li>
        ))}
      </ul>

      <div className="pt-1">
        {active ? (
          <p className="text-xs text-brand font-medium text-center">Current plan</p>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => {
              const priceText = base > 0 ? `${money(effective)}/${CYCLE_PERIOD[cycle]}` : money(effective);
              const msg = `Hi, I'd like to ${action} ${businessName || "my business"} to the ${plan.name} plan (${CYCLE_LABEL[cycle]}) — ${priceText}.`;
              window.open(`https://wa.me/2348137000305?text=${encodeURIComponent(msg)}`, "_blank");
            }}
          >
            {action === "downgrade" ? "Request downgrade" : "Request upgrade"}
          </Button>
        )}
      </div>
    </div>
  );
}

const CUSTOM_PLAN_IDEAL = ["Large organisations", "Enterprise deployments", "Sector-specific implementations"];
const CUSTOM_PLAN_PLUS = [
  "Custom branding",
  "Custom workflows",
  "Custom reports",
  "Dedicated infrastructure",
  "API integrations",
  "SLA agreements",
  "Custom onboarding and training",
];

function CustomPlanCard({ reference }: { reference: { name: string; features: string[] } | null }) {
  const plus = featuresBeyond(CUSTOM_PLAN_PLUS, reference?.features ?? []);
  return (
    <div className="mt-4 rounded-xl border-2 border-brand/30 bg-brand-light/20 p-5 flex flex-col lg:flex-row gap-6">
      <div className="lg:w-1/4 lg:border-r lg:border-border/60 lg:pr-6 space-y-3">
        <div>
          <Badge variant="outline" className="text-[10px] uppercase tracking-wider bg-secondary">Custom Plan</Badge>
          <p className="mt-2 text-2xl font-display font-bold text-brand-dark">Custom Pricing</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ideal for</p>
          <ul className="mt-1.5 space-y-1">
            {CUSTOM_PLAN_IDEAL.map(t => (
              <li key={t} className="text-sm text-muted-foreground">{t}</li>
            ))}
          </ul>
        </div>
      </div>
      <div className="flex-1 space-y-4">
        {reference && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Includes</p>
            <p className="mt-1.5 text-sm text-brand-dark flex items-center gap-1.5">
              <span className="text-brand shrink-0">✓</span> Everything in {reference.name}
            </p>
          </div>
        )}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{reference ? "Plus" : "Includes"}</p>
          <ul className="mt-1.5 grid sm:grid-cols-2 gap-x-4 gap-y-1.5">
            {plus.map(f => (
              <li key={f} className="text-sm text-muted-foreground flex items-start gap-1.5">
                <span className="text-brand shrink-0 mt-0.5">✓</span>
                {f}
              </li>
            ))}
          </ul>
        </div>
        <div className="pt-1">
          <Button asChild variant="brand" className="w-full sm:w-auto">
            <a href="mailto:sales@allspire.tech?subject=Custom%20Plan%20enquiry">Contact Sales</a>
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function Settings() {
  const { user, profile, business, role, subscription, plans, refresh } = useAuth();
  const { fmtDate } = useDateFormat();
  const isOwner = role === "owner";

  // Business Profile
  const [bizName, setBizName] = useState("");
  const [industry, setIndustry] = useState("");
  const [industryOther, setIndustryOther] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);

  // Exporter profile (export invoices)
  const [exportAddress, setExportAddress] = useState("");
  const [exportEmail, setExportEmail] = useState("");
  const [exportPhone, setExportPhone] = useState("");
  const [exportCountry, setExportCountry] = useState("");
  const [exportPrefix, setExportPrefix] = useState("");
  const [exportRc, setExportRc] = useState("");
  const [exportBankName, setExportBankName] = useState("");
  const [exportAccountName, setExportAccountName] = useState("");
  const [exportAccountNumber, setExportAccountNumber] = useState("");
  const [exportSwift, setExportSwift] = useState("");
  const [exporterBusy, setExporterBusy] = useState(false);

  // Regional
  const [currency, setCurrency] = useState("NGN");
  const [timezone, setTimezone] = useState("Africa/Lagos");
  const [regionalBusy, setRegionalBusy] = useState(false);

  // Notifications
  const [prefs, setPrefs] = useState<NotifPrefs>(DEFAULT_PREFS);
  const [prefsBusy, setPrefsBusy] = useState(false);

  // Integrations
  const [whatsapp, setWhatsapp] = useState("");
  const [integrationsBusy, setIntegrationsBusy] = useState(false);

  // Subscription
  const [currentPlan, setCurrentPlan] = useState("free");

  // Security
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [securityBusy, setSecurityBusy] = useState(false);

  // Email verification
  const [email, setEmail] = useState(user?.email || "");
  const [emailBusy, setEmailBusy] = useState(false);
  const emailConfirmed = isEmailConfirmed(user);
  useEffect(() => { setEmail(user?.email || ""); }, [user?.email]);

  useEffect(() => {
    if (business) {
      setBizName(business.name || "");
      setIndustry(business.industry || "");
      setIndustryOther(business.industry_other || "");
      setCity(business.city || "");
      setState(business.state || "");
      setCurrency(business.currency || "NGN");
      setTimezone(business.timezone || "Africa/Lagos");
      setCurrentPlan(business.subscription_tier || "free");
      setWhatsapp(business.whatsapp_number || "");
      setExportAddress(business.export_address || "");
      setExportEmail(business.export_email || "");
      setExportPhone(business.export_phone || "");
      setExportCountry(business.export_country || "");
      setExportPrefix(business.export_invoice_prefix || "");
      setExportRc(business.export_rc_number || "");
      setExportBankName(business.export_bank_name || "");
      setExportAccountName(business.export_account_name || "");
      setExportAccountNumber(business.export_account_number || "");
      setExportSwift(business.export_swift || "");
    }
    if (profile) setOwnerName(profile.owner_name || "");
  }, [business, profile]);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("notification_prefs")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        // Merge over defaults so newly-added prefs (e.g. expiry_alerts) read as on for
        // existing users whose saved prefs predate the key.
        if (data?.notification_prefs) setPrefs({ ...DEFAULT_PREFS, ...(data.notification_prefs as Partial<NotifPrefs>) });
      });
  }, [user]);

  const saveProfile = async () => {
    if (!business || !user) return;
    if (industry === "Other" && !industryOther.trim()) return toast.error("Tell us your industry");
    setProfileBusy(true);
    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      supabase.from("businesses").update({
        name: bizName,
        industry: industry || null,
        industry_other: industry === "Other" ? (industryOther.trim() || null) : null,
        city: city.trim() || null,
        state: state.trim() || null,
      }).eq("id", business.id),
      supabase.from("profiles").update({ owner_name: ownerName }).eq("id", user.id),
    ]);
    setProfileBusy(false);
    if (e1 || e2) return toast.error((e1 || e2)!.message);
    await refresh();
    toast.success("Profile saved");
  };

  const saveExporter = async () => {
    if (!business) return;
    setExporterBusy(true);
    const { error } = await supabase.from("businesses").update({
      export_address: exportAddress.trim() || null,
      export_email: exportEmail.trim() || null,
      export_phone: exportPhone.trim() || null,
      export_country: exportCountry.trim() || null,
      export_invoice_prefix: exportPrefix.trim().toUpperCase() || null,
      export_rc_number: exportRc.trim() || null,
      export_bank_name: exportBankName.trim() || null,
      export_account_name: exportAccountName.trim() || null,
      export_account_number: exportAccountNumber.trim() || null,
      export_swift: exportSwift.trim() || null,
    } as any).eq("id", business.id);
    setExporterBusy(false);
    if (error) return toast.error(error.message);
    await refresh();
    toast.success("Exporter profile saved");
  };

  const saveRegional = async () => {
    if (!business) return;
    setRegionalBusy(true);
    const { error } = await supabase
      .from("businesses")
      .update({ currency, timezone } as any)
      .eq("id", business.id);
    setRegionalBusy(false);
    if (error) return toast.error(error.message);
    await refresh();
    toast.success("Regional settings saved");
  };

  const togglePref = async (key: keyof NotifPrefs) => {
    if (!user) return;
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    setPrefsBusy(true);
    const { error } = await supabase
      .from("profiles")
      .update({ notification_prefs: next } as any)
      .eq("id", user.id);
    setPrefsBusy(false);
    if (error) {
      setPrefs(prefs);
      toast.error(error.message);
    }
  };

  const saveIntegrations = async () => {
    if (!business) return;
    setIntegrationsBusy(true);
    const { error } = await supabase
      .from("businesses")
      .update({ whatsapp_number: whatsapp.trim() || null } as any)
      .eq("id", business.id);
    setIntegrationsBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Integrations saved");
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) return toast.error("Passwords do not match");
    setSecurityBusy(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSecurityBusy(false);
    if (error) return toast.error(error.message);
    setNewPassword("");
    setConfirmPassword("");
    toast.success("Password updated");
  };

  const verifyEmail = async () => {
    const next = normalizeEmail(email);
    if (!isValidEmail(next)) return toast.error("Enter a valid email address");
    setEmailBusy(true);
    const options = { emailRedirectTo: `${window.location.origin}/settings` };
    const action = verifyAction(user?.email, next);
    const { error } = action === "change"
      ? await supabase.auth.updateUser({ email: next }, options)
      : await supabase.auth.resend({ type: "signup", email: next, options });
    setEmailBusy(false);
    if (error) return toast.error(error.message);
    toast.success(action === "change"
      ? `Confirmation sent to ${next}. Click the link in the email to verify.`
      : "Verification email sent. Check your inbox to confirm.");
  };

  const profileDirty = isDirty(
    [bizName, industry, industryOther, city, state, ownerName],
    [business?.name || "", business?.industry || "", business?.industry_other || "", business?.city || "", business?.state || "", profile?.owner_name || ""],
  );
  const exporterDirty = isDirty(
    [exportAddress, exportEmail, exportPhone, exportCountry, exportPrefix, exportRc, exportBankName, exportAccountName, exportAccountNumber, exportSwift],
    [business?.export_address || "", business?.export_email || "", business?.export_phone || "", business?.export_country || "", business?.export_invoice_prefix || "", business?.export_rc_number || "", business?.export_bank_name || "", business?.export_account_name || "", business?.export_account_number || "", business?.export_swift || ""],
  );
  const regionalDirty = isDirty([currency, timezone], [business?.currency || "NGN", business?.timezone || "Africa/Lagos"]);
  const integrationsDirty = isDirty([whatsapp], [business?.whatsapp_number || ""]);
  const securityReady = isPasswordFormReady(newPassword, confirmPassword);

  return (
    <div className={SETTINGS_PAGE_CLASS}>
      <div>
        <h1 className="font-display text-3xl lg:text-4xl font-bold text-brand-dark">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your account and business preferences.</p>
      </div>

      {/* Business Profile — owner only */}
      {isOwner && (
        <Card className="shadow-card border-border/60">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-3">
              <div className="size-9 rounded-lg bg-brand-light grid place-items-center text-brand">
                <Building2 className="size-4" />
              </div>
              <div>
                <CardTitle className="font-display text-lg">Business Profile</CardTitle>
                <CardDescription>Update your business name and owner details.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Business name</Label>
              <Input value={bizName} onChange={e => setBizName(e.target.value)} placeholder="Enter your business name" />
            </div>
            <div className="space-y-2">
              <Label>Industry</Label>
              <SearchableSelect
                value={industry}
                onValueChange={setIndustry}
                options={INDUSTRY_OPTIONS}
                placeholder="Select your industry"
              />
            </div>
            {industry === "Other" && (
              <div className="space-y-2">
                <Label>Which industry?</Label>
                <Input value={industryOther} onChange={e => setIndustryOther(e.target.value)} placeholder="Tell us your industry" />
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>City</Label>
                <Input value={city} onChange={e => setCity(e.target.value)} placeholder="e.g. Ikeja" />
              </div>
              <div className="space-y-2">
                <Label>State</Label>
                <Input value={state} onChange={e => setState(e.target.value)} placeholder="e.g. Lagos" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Owner name</Label>
              <Input value={ownerName} onChange={e => setOwnerName(e.target.value)} placeholder="Enter your name" />
            </div>
            <div className="flex justify-end">
              <Button variant="brand" onClick={saveProfile} disabled={profileBusy || !profileDirty}>
                {profileBusy ? "Saving..." : "Save profile"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Exporter Profile — owner only (prefills export invoices) */}
      {isOwner && (
        <Card className="shadow-card border-border/60">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-3">
              <div className="size-9 rounded-lg bg-brand-light grid place-items-center text-brand">
                <Globe className="size-4" />
              </div>
              <div>
                <CardTitle className="font-display text-lg">Exporter Profile</CardTitle>
                <CardDescription>Seller details prefilled onto export (commercial) invoices. Only you (the owner) can edit these.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Exporter address</Label>
              <Input value={exportAddress} onChange={e => setExportAddress(e.target.value)} placeholder="Street, area, city, state" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Exporter email</Label>
                <Input type="email" value={exportEmail} onChange={e => setExportEmail(e.target.value)} placeholder="exports@example.com" />
              </div>
              <div className="space-y-2">
                <Label>Exporter phone</Label>
                <Input value={exportPhone} onChange={e => setExportPhone(e.target.value)} placeholder="Phone number" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Country of origin</Label>
                <Input value={exportCountry} onChange={e => setExportCountry(e.target.value)} placeholder="Country" />
              </div>
              <div className="space-y-2">
                <Label>Invoice number prefix</Label>
                <Input value={exportPrefix} onChange={e => setExportPrefix(e.target.value)} placeholder="e.g. ABC" />
                <p className="text-xs text-muted-foreground">Used in numbers like {(exportPrefix.trim().toUpperCase() || "PREFIX")}/EXP/{new Date().getFullYear()}/001.</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>RC number</Label>
                <Input value={exportRc} onChange={e => setExportRc(e.target.value)} placeholder="Company registration number" />
              </div>
              <div className="space-y-2">
                <Label>Bank name</Label>
                <Input value={exportBankName} onChange={e => setExportBankName(e.target.value)} placeholder="Bank name" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Account name</Label>
                <Input value={exportAccountName} onChange={e => setExportAccountName(e.target.value)} placeholder="Account holder name" />
              </div>
              <div className="space-y-2">
                <Label>Account number</Label>
                <Input value={exportAccountNumber} onChange={e => setExportAccountNumber(e.target.value)} placeholder="Account number" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>SWIFT / IBAN <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input value={exportSwift} onChange={e => setExportSwift(e.target.value)} placeholder="SWIFT or IBAN" />
            </div>
            <div className="flex justify-end">
              <Button variant="brand" onClick={saveExporter} disabled={exporterBusy || !exporterDirty}>
                {exporterBusy ? "Saving..." : "Save exporter profile"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Currency & Region — owner only */}
      {isOwner && (
        <Card className="shadow-card border-border/60">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-3">
              <div className="size-9 rounded-lg bg-brand-light grid place-items-center text-brand">
                <Globe className="size-4" />
              </div>
              <div>
                <CardTitle className="font-display text-lg">Currency & Region</CardTitle>
                <CardDescription>Set your local currency and timezone for reports and dates.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className={SETTINGS_FIELD_GRID}>
              <div className="space-y-2">
                <Label>Currency</Label>
                <SearchableSelect
                  value={currency}
                  onValueChange={setCurrency}
                  options={CURRENCY_OPTIONS}
                  placeholder="Select currency"
                />
              </div>
              <div className="space-y-2">
                <Label>Timezone</Label>
                <SearchableSelect
                  value={timezone}
                  onValueChange={setTimezone}
                  options={TIMEZONES}
                  placeholder="Select timezone"
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button variant="brand" onClick={saveRegional} disabled={regionalBusy || !regionalDirty}>
                {regionalBusy ? "Saving..." : "Save"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Notification Preferences — all roles */}
      <Card className="shadow-card border-border/60">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-lg bg-brand-light grid place-items-center text-brand">
              <Bell className="size-4" />
            </div>
            <div>
              <CardTitle className="font-display text-lg">Notification Preferences</CardTitle>
              <CardDescription>Choose which alerts you want to receive in the app.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="divide-y divide-border/50">
          {[
            {
              key: "low_stock_alerts" as const,
              label: "Low stock alerts",
              desc: "Get notified when products fall below their reorder level",
              disabled: false,
              soon: false,
            },
            {
              key: "overdue_invoice_alerts" as const,
              label: "Overdue invoice alerts",
              desc: "Get notified when invoices are past their due date",
              disabled: false,
              soon: false,
            },
            {
              key: "expiry_alerts" as const,
              label: "Expiry alerts",
              desc: "Get notified when products are within 30 days of expiry (or already expired)",
              disabled: false,
              soon: false,
            },
            {
              key: "daily_summary" as const,
              label: "Daily summary",
              desc: "Receive a daily business performance digest",
              disabled: true,
              soon: true,
            },
          ].map(({ key, label, desc, disabled, soon }) => (
            <div key={key} className="flex items-center justify-between py-4">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  {label}
                  {soon && (
                    <Badge variant="outline" className="text-[10px] uppercase tracking-wider px-1.5 py-0">
                      Soon
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
              </div>
              <Switch
                checked={prefs[key]}
                onCheckedChange={() => !disabled && togglePref(key)}
                disabled={disabled || prefsBusy}
                aria-label={label}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Integrations — owner only */}
      {isOwner && (
        <Card className="shadow-card border-border/60">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-3">
              <div className="size-9 rounded-lg bg-brand-light grid place-items-center text-brand">
                <Link2 className="size-4" />
              </div>
              <div>
                <CardTitle className="font-display text-lg">Integrations</CardTitle>
                <CardDescription>Connect external services to your iTrova account.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium">WhatsApp Business</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Your business WhatsApp number, used as the default for invoice and receipt sharing.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <Input
                  value={whatsapp}
                  onChange={e => setWhatsapp(e.target.value)}
                  placeholder="+234 801 234 5678"
                  className="w-full sm:max-w-xs"
                />
                <Button variant="brand" onClick={saveIntegrations} disabled={integrationsBusy || !integrationsDirty} className="w-full sm:w-auto">
                  {integrationsBusy ? "Saving..." : "Save"}
                </Button>
              </div>
            </div>
            <div className="rounded-lg border border-border/60 p-4 flex items-center justify-between gap-3 bg-secondary/30">
              <div>
                <p className="text-sm font-medium">Paystack</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Accept card and bank transfer payments directly from invoices.
                </p>
              </div>
              <Badge variant="outline" className="text-[10px] uppercase tracking-wider shrink-0">Coming soon</Badge>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Subscription Plan — owner only */}
      {isOwner && (
        <Card className="shadow-card border-border/60">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-3">
              <div className="size-9 rounded-lg bg-brand-light grid place-items-center text-brand">
                <CreditCard className="size-4" />
              </div>
              <div>
                <CardTitle className="font-display text-lg">Subscription Plan</CardTitle>
                <CardDescription>
                  You are currently on the{" "}
                  <strong className="text-foreground capitalize">{currentPlan}</strong> plan.
                  {subscription?.expired && (
                    <span className="block mt-0.5 text-destructive">
                      Your {plans.find(p => p.key === subscription.tier)?.name ?? subscription.tier} plan expired
                      {subscription.renewsAt ? ` on ${fmtDate(subscription.renewsAt)}` : ""} — you've been moved to Free.
                    </span>
                  )}
                  {!subscription?.expired && subscription?.daysRemaining != null && subscription.tier !== "free" && (
                    <span className="block mt-0.5">
                      {subscription.cycle ? `${CYCLE_LABEL[subscription.cycle as BillingCycle] ?? subscription.cycle} · ` : ""}
                      renews {subscription.renewsAt ? fmtDate(subscription.renewsAt) : "—"} (in {subscription.daysRemaining} day{subscription.daysRemaining === 1 ? "" : "s"}).
                    </span>
                  )}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {plans.length === 0 ? (
              <p className="text-sm text-muted-foreground">No plans available yet.</p>
            ) : (
            <div className={SETTINGS_PLANS_GRID}>
              {plans.map(plan => {
                const prev = previousCataloguePlan(plans, plan);
                const inheritsFrom = prev && includesAll(plan.features || [], prev.features) ? prev : null;
                const currentSortOrder = plans.find(p => p.key === currentPlan)?.sort_order ?? null;
                const action = planChangeAction(plan.sort_order, currentSortOrder);
                return (
                  <PlanCard key={plan.key} plan={plan} inheritsFrom={inheritsFrom} action={action} currentPlan={currentPlan} businessName={business?.name || ""} />
                );
              })}
            </div>
            )}
            <CustomPlanCard reference={highestCataloguePlan(plans)} />
          </CardContent>
        </Card>
      )}

      {/* Account Security — all roles */}
      <Card className="shadow-card border-border/60">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-lg bg-brand-light grid place-items-center text-brand">
              <Shield className="size-4" />
            </div>
            <div>
              <CardTitle className="font-display text-lg">Account Security</CardTitle>
              <CardDescription>Update your password to keep your account secure.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="acct-email">Email address</Label>
            {emailConfirmed ? (
              <div className="flex items-center gap-2">
                <Input id="acct-email" value={user?.email || ""} disabled className="bg-secondary/50 text-muted-foreground" />
                <Badge variant="outline" className="shrink-0 gap-1 bg-success/10 text-success border-success/20">
                  <CheckCircle2 className="size-3" /> Verified
                </Badge>
              </div>
            ) : (
              <>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input id="acct-email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@business.com" />
                  <Button type="button" variant="brand" onClick={verifyEmail} disabled={emailBusy} className="shrink-0">
                    {emailBusy ? "Sending…" : "Verify email"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Your email isn't verified yet. Update it if it's wrong, then click Verify — we'll send a confirmation link.
                </p>
              </>
            )}
          </div>
          <form onSubmit={changePassword} className="space-y-4">
            <div className={SETTINGS_FIELD_GRID}>
              <div className="space-y-2">
                <Label htmlFor="np">New password</Label>
                <div className="relative">
                  <Input
                    id="np"
                    type={showNew ? "text" : "password"}
                    required
                    minLength={8}
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    placeholder="Create new password"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNew(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                    aria-label={showNew ? "Hide password" : "Show password"}
                  >
                    {showNew ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cp2">Confirm password</Label>
                <div className="relative">
                  <Input
                    id="cp2"
                    type={showConfirm ? "text" : "password"}
                    required
                    minLength={8}
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter new password"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                    aria-label={showConfirm ? "Hide password" : "Show password"}
                  >
                    {showConfirm ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>
            </div>
            <div className="flex justify-end">
              <Button type="submit" variant="brand" disabled={securityBusy || !securityReady}>
                {securityBusy ? "Updating..." : "Update password"}
              </Button>
            </div>
          </form>
          <div className="rounded-lg border border-border/60 p-4 flex items-center justify-between gap-3 bg-secondary/30">
            <div>
              <p className="text-sm font-medium">Two-factor authentication</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Add an extra layer of security with an authenticator app.
              </p>
            </div>
            <Badge variant="outline" className="text-[10px] uppercase tracking-wider shrink-0">Coming soon</Badge>
          </div>
        </CardContent>
      </Card>

      {/* Legal & Compliance — all roles */}
      <Card className="shadow-card border-border/60">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-lg bg-brand-light grid place-items-center text-brand">
              <Scale className="size-4" />
            </div>
            <div>
              <CardTitle className="font-display text-lg">Legal &amp; Compliance</CardTitle>
              <CardDescription>Read the policies that govern your use of iTrova.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="divide-y divide-border/50">
          {LEGAL_LINKS.map(link => (
            <Link
              key={link.slug}
              to={`/legal/${link.slug}`}
              className="group flex items-center justify-between gap-3 py-4 first:pt-0 last:pb-0"
            >
              <div>
                <div className="text-sm font-medium text-foreground group-hover:text-brand transition-colors">{link.label}</div>
                <p className="text-xs text-muted-foreground mt-0.5">{link.description}</p>
              </div>
              <ChevronRight className="size-4 text-muted-foreground group-hover:text-brand shrink-0 transition-colors" />
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
