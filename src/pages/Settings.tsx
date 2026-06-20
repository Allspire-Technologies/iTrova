import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import SearchableSelect from "@/components/SearchableSelect";
import { CURRENCY_OPTIONS } from "@/lib/format";
import { toast } from "sonner";
import { Eye, EyeOff, Building2, Globe, Bell, Link2, CreditCard, Shield, CheckCircle2 } from "lucide-react";

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

const PLANS = [
  {
    key: "free",
    name: "Free",
    price: "₦0",
    period: "",
    features: ["Inventory management", "POS & sales", "Invoices & purchase orders", "Supplier management", "Basic reports"],
  },
  {
    key: "pro",
    name: "Pro",
    price: "₦5,000",
    period: "/month",
    features: ["Everything in Free", "AI Business Insights", "Advanced analytics", "PDF report exports", "Priority support"],
  },
  {
    key: "business",
    name: "Business",
    price: "₦15,000",
    period: "/month",
    features: ["Everything in Pro", "Multi-branch support", "API access", "Team analytics", "Dedicated support"],
  },
];

type NotifPrefs = { low_stock_alerts: boolean; overdue_invoice_alerts: boolean; daily_summary: boolean };
const DEFAULT_PREFS: NotifPrefs = { low_stock_alerts: true, overdue_invoice_alerts: true, daily_summary: false };

export default function Settings() {
  const { user, profile, business, role, refresh } = useAuth();
  const isOwner = role === "owner";

  // Business Profile
  const [bizName, setBizName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);

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

  useEffect(() => {
    if (business) {
      setBizName(business.name || "");
      setCurrency(business.currency || "NGN");
      setTimezone(business.timezone || "Africa/Lagos");
      setCurrentPlan(business.subscription_tier || "free");
      setWhatsapp(business.whatsapp_number || "");
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
        if (data?.notification_prefs) setPrefs(data.notification_prefs as NotifPrefs);
      });
  }, [user]);

  const saveProfile = async () => {
    if (!business || !user) return;
    setProfileBusy(true);
    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      supabase.from("businesses").update({ name: bizName }).eq("id", business.id),
      supabase.from("profiles").update({ owner_name: ownerName }).eq("id", user.id),
    ]);
    setProfileBusy(false);
    if (e1 || e2) return toast.error((e1 || e2)!.message);
    await refresh();
    toast.success("Profile saved");
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

  return (
    <div className="space-y-6 w-full max-w-3xl">
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
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Owner name</Label>
                <Input value={ownerName} onChange={e => setOwnerName(e.target.value)} placeholder="Enter your name" />
              </div>
              <div className="space-y-2">
                <Label>Email address</Label>
                <Input value={user?.email || ""} disabled className="bg-secondary/50 text-muted-foreground" />
              </div>
            </div>
            <div className="flex justify-end">
              <Button variant="brand" onClick={saveProfile} disabled={profileBusy}>
                {profileBusy ? "Saving..." : "Save profile"}
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
            <div className="grid grid-cols-2 gap-4">
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
              <Button variant="brand" onClick={saveRegional} disabled={regionalBusy}>
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
              <div className="flex gap-3">
                <Input
                  value={whatsapp}
                  onChange={e => setWhatsapp(e.target.value)}
                  placeholder="+234 801 234 5678"
                  className="max-w-xs"
                />
                <Button variant="brand" onClick={saveIntegrations} disabled={integrationsBusy}>
                  {integrationsBusy ? "Saving..." : "Save"}
                </Button>
              </div>
            </div>
            <div className="rounded-lg border border-border/60 p-4 flex items-center justify-between bg-secondary/30">
              <div>
                <p className="text-sm font-medium">Paystack</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Accept card and bank transfer payments directly from invoices.
                </p>
              </div>
              <Badge variant="outline" className="text-[10px] uppercase tracking-wider">Coming soon</Badge>
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
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {PLANS.map(plan => {
                const active = plan.key === currentPlan;
                return (
                  <div
                    key={plan.key}
                    className={`rounded-xl border-2 p-4 flex flex-col gap-3 transition-colors ${
                      active ? "border-brand bg-brand-light/30" : "border-border/60"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-display font-semibold text-brand-dark">{plan.name}</span>
                      {active && <CheckCircle2 className="size-4 text-brand" />}
                    </div>
                    <div>
                      <span className="text-2xl font-display font-bold text-brand-dark">{plan.price}</span>
                      <span className="text-xs text-muted-foreground">{plan.period}</span>
                    </div>
                    <ul className="space-y-1.5 flex-1">
                      {plan.features.map(f => (
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
                        <Button variant="outline" size="sm" disabled className="w-full">
                          Upgrade — Coming soon
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
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
          <form onSubmit={changePassword} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
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
              <Button type="submit" variant="brand" disabled={securityBusy}>
                {securityBusy ? "Updating..." : "Update password"}
              </Button>
            </div>
          </form>
          <div className="rounded-lg border border-border/60 p-4 flex items-center justify-between bg-secondary/30">
            <div>
              <p className="text-sm font-medium">Two-factor authentication</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Add an extra layer of security with an authenticator app.
              </p>
            </div>
            <Badge variant="outline" className="text-[10px] uppercase tracking-wider">Coming soon</Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
