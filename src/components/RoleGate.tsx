import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth, AppRole } from "@/contexts/AuthContext";
import { NoAccessCard } from "@/components/PermissionGate";

export function RoleGate({ allow, children, redirect = false }: { allow: AppRole[]; children: ReactNode; redirect?: boolean }) {
  const { role, loading } = useAuth();
  if (loading) return null;
  if (!role || !allow.includes(role)) {
    if (redirect) return <Navigate to="/" replace />;
    return <NoAccessCard />;
  }
  return <>{children}</>;
}
