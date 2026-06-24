/**
 * Whether a plan grants access to a module. Gating is opt-in: a plan with no modules
 * configured (null/empty) grants everything, so businesses without a configured plan
 * keep full access. Once a plan lists modules, only those are accessible.
 */
export function canAccessModule(planModules: string[] | null | undefined, key: string): boolean {
  if (!planModules || planModules.length === 0) return true;
  return planModules.includes(key);
}

/** Known Free-tier modules — the safety baseline if the Free plan row is misconfigured. */
export const FREE_MODULES = [
  "inventory", "pos", "suppliers", "raw_materials", "invoices",
  "purchase_orders", "reports", "team", "csv_import", "csv_export",
];

/**
 * The modules to gate by for a resolved plan. Surgical guard: if the *Free* plan has no
 * modules configured, fall back to FREE_MODULES instead of letting canAccessModule fail
 * open and silently grant everything. Other plans (and an unresolved/null plan) keep the
 * existing opt-in behaviour.
 */
export function planModules(plan: { key: string; modules?: string[] | null } | null | undefined): string[] | null {
  if (!plan) return null;
  if (plan.modules && plan.modules.length > 0) return plan.modules;
  if (plan.key === "free") return FREE_MODULES;
  return null;
}
