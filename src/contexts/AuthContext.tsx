import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

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
  currency: string;
  timezone: string | null;
  subscription_tier: string | null;
  whatsapp_number: string | null;
};

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  business: Business | null;
  role: AppRole | null;
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
  const [loading, setLoading] = useState(true);

  const loadProfile = async (uid: string) => {
    const { data: p } = await supabase.from("profiles").select("*").eq("id", uid).maybeSingle();
    setProfile(p as Profile | null);
    if (p?.business_id) {
      const [{ data: b }, { data: roles }] = await Promise.all([
        supabase.from("businesses").select("*").eq("id", p.business_id).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", uid).eq("business_id", p.business_id),
      ]);
      setBusiness(b as Business | null);
      const list = ((roles as { role: AppRole }[] | null) || []).map(r => r.role);
      list.sort((a, b) => ROLE_RANK[a] - ROLE_RANK[b]);
      setRole(list[0] ?? null);
    } else {
      setBusiness(null);
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

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const refresh = async () => {
    if (user) await loadProfile(user.id);
  };

  return (
    <AuthContext.Provider value={{ user, session, profile, business, role, loading, signOut, refresh }}>
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
