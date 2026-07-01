import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { registerPlanLimits, type PlanLimits } from "@/lib/planLimits";
import type { BillingCycle } from "@/lib/planPricing";
import { canAccessModule, planModules } from "@/lib/moduleAccess";
import { isExpired, daysRemaining, nextRenewal } from "@/lib/subscription";
import { cacheSession, readCachedSession } from "@/lib/offlineStore";

export type AppRole = Database["public"]["Enums"]["app_role"];

type Profile = {
  id: string;
  owner_name: string;
  business_id: string | null;
  onboarded: boolean;
};

type Business = {
  id: string;
  name: string;
  industry: string | null;
  industry_other: string | null;
  city: string | null;
  state: string | null;
  currency: string;
  timezone: string | null;
  subscription_tier: string | null;
  subscription_renews_at: string | null;
  subscription_started_at: string | null;
  subscription_cycle: string | null;
  whatsapp_number: string | null;
};

/** Subscription view that keeps the raw paid tier (for display) even once expired. */
export type SubscriptionStatus = {
  tier: string;
  cycle: string | null;
  renewsAt: string | null;
  daysRemaining: number | null;
  expired: boolean;
};

export type PlanPrice = {
  id: string;
  cycle: BillingCycle;
  price_amount: number;
  discount_percent: number;
  is_active: boolean;
  sort_order: number;
};

export type Plan = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  price_amount: number;
  price_currency: string;
  billing_period: string | null;
  features: string[];
  limits: PlanLimits;
  is_active: boolean;
  sort_order: number;
  business_id: string | null;
  promo_percent: number;
  promo_label: string | null;
  promo_until: string | null;
  modules: string[];
  prices: PlanPrice[];
};

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  business: Business | null;
  role: AppRole | null;
  subscription: SubscriptionStatus | null;
  plans: Plan[];
  plan: Plan | null;
  hasModule: (key: string) => boolean;
  loading: boolean;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const ROLE_RANK: Record<AppRole, number> = { owner: 1, manager: 2, cashier: 3 };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [business, setBusiness] = useState<Business | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionStatus | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);

  const applyBusiness = (biz: Business) => {
    const rawTier = biz.subscription_tier || "free";
    const renewsAt = biz.subscription_renews_at ?? nextRenewal(biz.subscription_started_at, biz.subscription_cycle);
    const expired = isExpired(renewsAt);
    // Enforce expiry at read time: an expired paid tier behaves as Free everywhere
    // that reads business.subscription_tier (limits, modules, plan resolution).
    setBusiness({ ...biz, subscription_tier: expired ? "free" : rawTier });
    setSubscription({ tier: rawTier, cycle: biz.subscription_cycle, renewsAt, daysRemaining: daysRemaining(renewsAt), expired });
  };

  // Offline fallback: rehydrate business/profile/role from the last cached session so the app
  // (POS + read-only views) still works with no network. Returns true if anything was restored.
  const hydrateFromCache = async (): Promise<boolean> => {
    try {
      const cached = await readCachedSession();
      if (!cached?.business) return false;
      setProfile((cached.profile as Profile | null) ?? null);
      setRole((cached.role as AppRole | null) ?? null);
      applyBusiness(cached.business as Business);
      return true;
    } catch {
      return false;
    }
  };

  const loadProfile = async (uid: string) => {
    const { data: p, error: pErr } = await supabase.from("profiles").select("*").eq("id", uid).maybeSingle();
    if (pErr) { await hydrateFromCache(); return; } // offline / unreachable
    setProfile(p as Profile | null);
    if (p?.business_id) {
      const [{ data: b, error: bErr }, { data: roles, error: rErr }] = await Promise.all([
        supabase.from("businesses").select("*").eq("id", p.business_id).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", uid).eq("business_id", p.business_id),
      ]);
      if (bErr || rErr) { await hydrateFromCache(); return; } // offline mid-load
      // select("*") returns the new industry_other/city/state columns at runtime; the generated
      // types lag until regenerated, so widen through unknown.
      const biz = b as unknown as Business | null;
      if (biz) {
        applyBusiness(biz);
      } else {
        setBusiness(null);
        setSubscription(null);
      }
      const list = ((roles as { role: AppRole }[] | null) || []).map(r => r.role);
      list.sort((a, b) => ROLE_RANK[a] - ROLE_RANK[b]);
      setRole(list[0] ?? null);
    } else {
      setBusiness(null);
      setSubscription(null);
      setRole(null);
    }
  };

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, sess) => {
      setSession(sess);
      setUser(sess?.user ?? null);
      if (sess?.user) {
        setTimeout(() => loadProfile(sess.user.id), 0);
        if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") {
          supabase.from("profiles").update({ last_seen: new Date().toISOString() }).eq("id", sess.user.id).then();
        }
      } else {
        setProfile(null);
        setBusiness(null);
        setSubscription(null);
        setRole(null);
      }
    });

    supabase.auth.getSession().then(({ data: { session: sess } }) => {
      setSession(sess);
      setUser(sess?.user ?? null);
      if (sess?.user) {
        loadProfile(sess.user.id);
        supabase.from("profiles").update({ last_seen: new Date().toISOString() }).eq("id", sess.user.id).then();
      }
      setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) { setPlans([]); return; }
    (supabase as unknown as { from: (t: string) => any })
      .from("plans")
      .select("*, prices:plan_prices(*)")
      .eq("is_active", true)
      .order("sort_order")
      .then(({ data }: { data: Plan[] | null }) => {
        const rows = (data ?? []).map((p) => ({ ...p, prices: p.prices ?? [], modules: p.modules ?? [] }));
        setPlans(rows);
        registerPlanLimits(rows);
      });
  }, [user]);

  const plan = useMemo(
    () => plans.find(p => p.key === (business?.subscription_tier || "free")) ?? null,
    [plans, business?.subscription_tier]
  );

  const hasModule = (key: string) => canAccessModule(planModules(plan), key);

  // Persist a minimal session snapshot whenever we have live data, so the next offline load can
  // rehydrate business/profile/role + plan modules without the network.
  useEffect(() => {
    if (!user || !business) return;
    cacheSession({
      businessId: business.id,
      business,
      profile,
      staffId: user.id,
      role,
      planModules: plan?.modules ?? null,
      cachedAt: Date.now(),
    }).catch(() => {});
  }, [user, business, profile, role, plan]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const refresh = async () => {
    if (user) await loadProfile(user.id);
  };

  return (
    <AuthContext.Provider value={{ user, session, profile, business, role, subscription, plans, plan, hasModule, loading, signOut, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function useHasRole(...allowed: AppRole[]) {
  const { role } = useAuth();
  return role ? allowed.includes(role) : false;
}
