import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { ShieldAlert } from "lucide-react";

/** Shared "no access" fallback used by RoleGate and PermissionGate. */
export function NoAccessCard() {
  return (
    <div className="max-w-md mx-auto mt-24 text-center space-y-3 p-8 rounded-2xl bg-card border border-border/60 shadow-card">
      <ShieldAlert className="size-10 mx-auto text-warning" />
      <h1 className="font-display text-xl font-bold text-brand-dark">No access</h1>
      <p className="text-sm text-muted-foreground">
        You don't have permission to view this page. Ask the business owner to grant you access.
      </p>
    </div>
  );
}

/** Route/section guard driven by the RBAC permission map (module × action). */
export function PermissionGate({ module, action = "view", children, redirect = false }:
  { module: string; action?: string; children: ReactNode; redirect?: boolean }) {
  const { can, loading } = useAuth();
  if (loading) return null;
  if (!can(module, action)) {
    if (redirect) return <Navigate to="/" replace />;
    return <NoAccessCard />;
  }
  return <>{children}</>;
}
