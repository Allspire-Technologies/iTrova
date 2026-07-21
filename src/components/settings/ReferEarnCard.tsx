import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Gift, Copy, MessageCircle } from "lucide-react";

// Refer & earn (Settings → Billing). MVP per docs/knowledge/iTrova-referral-program.md:
// - shows/generates the business's own referral code (NAMESLUG + last 4 phone digits, server-side)
// - one-tap WhatsApp share of the ?ref= signup link
// - if THIS business was referred and hasn't paid yet, shows the first-payment discount note.
// All program numbers come from referral_config (nothing hardcoded); rewards are applied manually
// by the team, so this card is informational + share tooling only.

const SIGNUP_BASE = "https://itrova.allspire.tech/auth";

type Config = { affiliate_share_percent: number; referee_discount_percent: number; business_free_months: number; business_referrals_per_free_month: number };

export default function ReferEarnCard() {
  const { business } = useAuth();
  const [config, setConfig] = useState<Config | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [referredBy, setReferredBy] = useState<string | null>(null);
  const [stats, setStats] = useState<{ referred: number; converted: number } | null>(null);
  const [busy, setBusy] = useState(false);

  // referral columns/config/RPCs postdate the generated Supabase types — cast until the next regen.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const loadStats = async () => {
    const { data } = await sb.rpc("my_referral_stats");
    const row = Array.isArray(data) ? data[0] : data;
    if (row) setStats({ referred: Number(row.referred_count) || 0, converted: Number(row.converted_count) || 0 });
  };

  useEffect(() => {
    if (!business) return;
    (async () => {
      const [cfg, biz] = await Promise.all([
        sb.from("referral_config").select("affiliate_share_percent, referee_discount_percent, business_free_months, business_referrals_per_free_month").maybeSingle(),
        sb.from("businesses").select("referral_code, referred_by_code").eq("id", business.id).maybeSingle(),
      ]);
      if (cfg.data) setConfig(cfg.data as Config);
      if (biz.data) { setCode(biz.data.referral_code ?? null); setReferredBy(biz.data.referred_by_code ?? null); }
      await loadStats();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business]);

  const generate = async () => {
    setBusy(true);
    const { data, error } = await sb.rpc("ensure_referral_code");
    setBusy(false);
    if (error) return toast.error(error.message);
    setCode(String(data));
    loadStats();
  };

  const shareLink = code ? `${SIGNUP_BASE}?ref=${encodeURIComponent(code)}` : "";
  const shareMsg = code
    ? `I run my business on iTrova — inventory, sales and accounting in one app. Sign up with my link and you get ${config?.referee_discount_percent ?? 20}% off your first payment: ${shareLink}`
    : "";

  const copy = async (text: string, label: string) => {
    try { await navigator.clipboard.writeText(text); toast.success(`${label} copied`); }
    catch { toast.error("Couldn't copy — long-press to copy instead"); }
  };

  // Referee note: referred + never paid (free tier, no renewal date) = first payment still ahead.
  const showRefereeNote = !!referredBy
    && (business?.subscription_tier ?? "free") === "free"
    && !business?.subscription_renews_at;

  return (
    <Card className="shadow-card border-border/60">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-lg bg-brand-light grid place-items-center text-brand"><Gift className="size-4" /></div>
          <div>
            <CardTitle className="font-display text-lg">Refer &amp; earn</CardTitle>
            <CardDescription>
              Refer other businesses — earn{" "}
              <strong className="text-foreground">{config?.business_free_months ?? 1} free month{(config?.business_free_months ?? 1) === 1 ? "" : "s"}</strong>{" "}
              for every <strong className="text-foreground">{config?.business_referrals_per_free_month ?? 3}</strong>{" "}
              that subscribe, and each of them gets <strong className="text-foreground">{config?.referee_discount_percent ?? 20}% off</strong> their first payment.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {showRefereeNote && (
          <div className="rounded-xl border border-brand/30 bg-brand-light/50 px-4 py-2.5 text-sm text-brand-dark">
            Referral applied (code <span className="font-semibold">{referredBy}</span>) — you get{" "}
            <span className="font-semibold">{config?.referee_discount_percent ?? 20}% off your first payment</span>. The discount is applied when you upgrade.
          </div>
        )}
        {code ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-lg border border-border bg-muted/40 px-3 py-1.5 font-mono text-sm font-semibold tracking-wider text-brand-dark">{code}</span>
              <Button variant="outline" size="sm" onClick={() => copy(code, "Code")}><Copy className="size-4" /> Copy code</Button>
              <Button variant="outline" size="sm" onClick={() => copy(shareLink, "Link")}><Copy className="size-4" /> Copy link</Button>
              <Button variant="brand" size="sm" onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(shareMsg)}`, "_blank", "noopener,noreferrer")}>
                <MessageCircle className="size-4" /> Share on WhatsApp
              </Button>
            </div>
            {stats && stats.referred > 0 ? (
              <div className="flex flex-wrap gap-3 pt-1">
                <div className="rounded-lg border border-border bg-muted/30 px-4 py-2">
                  <div className="text-lg font-semibold text-brand-dark">{stats.referred}</div>
                  <div className="text-xs text-muted-foreground">business{stats.referred === 1 ? "" : "es"} referred</div>
                </div>
                <div className="rounded-lg border border-border bg-muted/30 px-4 py-2">
                  <div className="text-lg font-semibold text-brand">{stats.converted}</div>
                  <div className="text-xs text-muted-foreground">now subscribed</div>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Anyone who signs up through your link is counted here automatically. Rewards are applied by our team once they pay.</p>
            )}
          </>
        ) : (
          <Button variant="brand" size="sm" onClick={generate} disabled={busy}>
            {busy ? "Creating…" : "Get my referral code"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
