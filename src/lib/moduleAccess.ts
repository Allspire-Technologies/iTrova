/**
 * Whether a plan grants access to a module. Gating is opt-in: a plan with no modules
 * configured (null/empty) grants everything, so businesses without a configured plan
 * keep full access. Once a plan lists modules, only those are accessible.
 */
export function canAccessModule(planModules: string[] | null | undefined, key: string): boolean {
  if (!planModules || planModules.length === 0) return true;
  return planModules.includes(key);
}

/**
 * The modules to gate by for a resolved plan — whatever the backend published for it, and nothing
 * else. There is deliberately no hardcoded list here: plans.modules is edited from the CRM, so a
 * copy in the app is stale the day someone changes a plan (the old FREE_MODULES constant still
 * carried suppliers, raw materials, purchase orders and CSV long after Free stopped including
 * them). The database enforces entitlement independently, so a plan row that lists nothing grants
 * everything in both layers rather than the two disagreeing.
 */
export function planModules(plan: { key: string; modules?: string[] | null } | null | undefined): string[] | null {
  if (!plan) return null;
  return plan.modules && plan.modules.length > 0 ? plan.modules : null;
}
