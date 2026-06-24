import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Lock } from "lucide-react";

export function ModuleGate({ module, children, redirect = false }: { module: string; children: ReactNode; redirect?: boolean }) {
  const { hasModule, loading } = useAuth();
  if (loading) return null;
  if (!hasModule(module)) {
    if (redirect) return <Navigate to="/" replace />;
    return (
      <div className="max-w-md mx-auto mt-24 text-center space-y-3 p-8 rounded-2xl bg-card border border-border/60 shadow-card">
        <Lock className="size-10 mx-auto text-warning" />
        <h1 className="font-display text-xl font-bold text-brand-dark">Not on your plan</h1>
        <p className="text-sm text-muted-foreground">
          This feature isn't included in your current plan. Check Settings for available plans.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
