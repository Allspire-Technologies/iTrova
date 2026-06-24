/**
 * Whether a plan grants access to a module. Gating is opt-in: a plan with no modules
 * configured (null/empty) grants everything, so businesses without a configured plan
 * keep full access. Once a plan lists modules, only those are accessible.
 */
export function canAccessModule(planModules: string[] | null | undefined, key: string): boolean {
  if (!planModules || planModules.length === 0) return true;
  return planModules.includes(key);
}
