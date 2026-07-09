import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { registerPlanLimits, type PlanLimits } from "@/lib/planLimits";
import type { BillingCycle } from "@/lib/planPricing";
import { canAccessModule, planModules } from "@/lib/moduleAccess";
import { resolvePermissions, type PermissionMap } from "@/lib/permissions";
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
  export_address: string | null;
  export_email: string | null;
  export_phone: string | null;
  export_country: string | null;
  export_invoice_prefix: string | null;
  export_rc_number: string | null;
  export_bank_name: string | null;
  export_account_name: string | null;
  export_account_number: string | null;
  export_swift: string | null;
  subscription_tier: string | null;
  subscription_renews_at: string | null;
  subscription_started_at: string | null;
  subscription_cycle: string | null;
  whatsapp_number: string | null;
  trial_plan: string | null;
  trial_started_at: string | null;
  tax_enabled: boolean | null;
  prices_include_tax: boolean | null;
  tin: string | null;
};

/** Subscription view that keeps the raw paid tier (for display) even once expired. */
export type SubscriptionStatus = {
  tier: string;
  cycle: string | null;
  renewsAt: string | null;
  daysRemaining: number | null;
  expired: boolean;
  /** True while the paid tier came from the onboarding trial and is still running. */
  isTrial: boolean;
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
  /** Permission check (RBAC v1): can the member use this module action? Owner always can. */
  can: (module: string, action: string) => boolean;
  /** Registry modules the member may see (already plan-intersected). */
  permittedModules: string[];
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
  // RBAC inputs loaded per member: assigned/system role map + explicit member override.
  const [access, setAccess] = useState<{ roleMap: PermissionMap | null; override: PermissionMap | null }>({ roleMap: null, override: null });

  const applyBusiness = (biz: Business) => {
    const rawTier = biz.subscription_tier || "free";
    const renewsAt = biz.subscription_renews_at ?? nextRenewal(biz.subscription_started_at, biz.subscription_cycle);
    const expired = isExpired(renewsAt);
    // Enforce expiry at read time: an expired paid tier behaves as Free everywhere
    // that reads business.subscription_tier (limits, modules, plan resolution).
    setBusiness({ ...biz, subscription_tier: expired ? "free" : rawTier });
    // The tier is a trial while it matches the trialed plan, hasn't lapsed, and no billing cycle
    // is set — a real (manual) paid grant always sets subscription_cycle, a trial never does.
    const isTrial = !expired && rawTier !== "free" && !biz.subscription_cycle
      && !!biz.trial_started_at && biz.trial_plan === rawTier;
    setSubscription({ tier: rawTier, cycle: biz.subscription_cycle, renewsAt, daysRemaining: daysRemaining(renewsAt), expired, isTrial });
  };

  // Offline fallback: rehydrate business/profile/role from the last cached session so the app
  // (POS + read-only views) still works with no network. Returns true if anything was restored.
  const hydrateFromCache = async (): Promise<boolean> => {
    try {
      const cached = await readCachedSession();
      if (!cached?.business) return false;
      setProfile((cached.profile as Profile | null) ?? null);
      setRole((cached.role as AppRole | null) ?? null);
      setAccess({
        roleMap: (cached.roleMap as PermissionMap | null) ?? null,
        override: (cached.permissionOverride as PermissionMap | null) ?? null,
      });
      applyBusiness(cached.business as Business);
      return true;
    } catch {
      return false;
    }
  };

  // RBAC (best-effort, non-fatal): the member's assignment/override + this business's edited
  // system defaults. Errors (e.g. migration not applied yet) resolve to nulls → code defaults,
  // which reproduce pre-RBAC behavior exactly. Also re-run by the realtime subscription below.
  const loadAccess = async (uid: string, businessId: string, appRole: AppRole | null) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const [{ data: ma }, { data: sysRoles }] = await Promise.all([
      sb.from("member_access").select("permissions, team_role_id, team_roles(permissions)")
        .eq("user_id", uid).eq("business_id", businessId).maybeSingle(),
      sb.from("team_roles").select("system_key, permissions")
        .eq("business_id", businessId).not("system_key", "is", null),
    ]).catch(() => [{ data: null }, { data: null }]);
    const assignedMap: PermissionMap | null = ma?.team_role_id ? (ma?.team_roles?.permissions ?? null) : null;
    const systemMap: PermissionMap | null =
      (appRole && appRole !== "owner"
        ? (sysRoles as { system_key: string; permissions: PermissionMap }[] | null)?.find(r => r.system_key === appRole)?.permissions
        : null) ?? null;
    setAccess({ roleMap: assignedMap ?? systemMap, override: (ma?.permissions as PermissionMap | null) ?? null });
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
      // trial_plan/trial_started_at postdate the generated Supabase types (20260706150000) —
      // select("*") returns them at runtime; cast through unknown until the types are regenerated.
      const biz = b as unknown as Business | null;
      if (biz) {
        applyBusiness(biz);
      } else {
        setBusiness(null);
        setSubscription(null);
      }
      const list = ((roles as { role: AppRole }[] | null) || []).map(r => r.role);
      list.sort((a, b) => ROLE_RANK[a] - ROLE_RANK[b]);
      const appRole = list[0] ?? null;
      setRole(appRole);
      await loadAccess(uid, p.business_id, appRole);
    } else {
      setBusiness(null);
      setSubscription(null);
      setRole(null);
      setAccess({ roleMap: null, override: null });
    }
  };

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, sess) => {
      setSession(sess);
      setUser(sess?.user ?? null);
      if (sess?.user) {
        setTimeout(() => loadProfile(sess.user.id), 0);
        if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") {
          // Best-effort presence stamp — log if it fails, but never surface to the user.
          supabase.from("profiles").update({ last_seen: new Date().toISOString() }).eq("id", sess.user.id)
            .then(({ error }) => { if (error) console.warn("last_seen update failed:", error.message); });
        }
      } else {
        setProfile(null);
        setBusiness(null);
        setSubscription(null);
        setRole(null);
        setAccess({ roleMap: null, override: null });
      }
    });

    supabase.auth.getSession().then(async ({ data: { session: sess } }) => {
      setSession(sess);
      setUser(sess?.user ?? null);
      try {
        // AWAIT the full member load so `loading` only clears once profile + role + RBAC access are
        // resolved. Otherwise `loading` flips false with role still null, and every route guard sees
        // `can → false` for a beat and flashes "No access" before correcting (loadProfile fails open
        // to cache/nulls, so this never hangs).
        if (sess?.user) {
          await loadProfile(sess.user.id);
          supabase.from("profiles").update({ last_seen: new Date().toISOString() }).eq("id", sess.user.id)
            .then(({ error }) => { if (error) console.warn("last_seen update failed:", error.message); });
        }
      } finally {
        setLoading(false);
      }
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

  // Realtime permission push: when this member's access row or any of the business's roles change,
  // re-resolve permissions live — no re-login needed. Best-effort (offline/websocket failures are
  // silent; the next full load picks changes up anyway).
  useEffect(() => {
    if (!user || !business) return;
    const reload = () => loadAccess(user.id, business.id, role);
    const ch = supabase
      .channel(`rbac-${business.id}-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "member_access", filter: `user_id=eq.${user.id}` }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "team_roles", filter: `business_id=eq.${business.id}` }, reload)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, business?.id, role]);

  const plan = useMemo(
    () => plans.find(p => p.key === (business?.subscription_tier || "free")) ?? null,
    [plans, business?.subscription_tier]
  );

  const hasModule = (key: string) => canAccessModule(planModules(plan), key);

  // Effective permissions for the signed-in member (owner bypass inside resolvePermissions).
  const permissions = useMemo(
    () => resolvePermissions({ appRole: role, roleMap: access.roleMap, override: access.override, planModules: planModules(plan) }),
    [role, access, plan]
  );

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
      roleMap: access.roleMap,
      permissionOverride: access.override,
      cachedAt: Date.now(),
    }).catch(() => {});
  }, [user, business, profile, role, plan, access]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const refresh = async () => {
    if (user) await loadProfile(user.id);
  };

  return (
    <AuthContext.Provider value={{ user, session, profile, business, role, subscription, plans, plan, hasModule, can: permissions.can, permittedModules: permissions.modules, loading, signOut, refresh }}>
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
