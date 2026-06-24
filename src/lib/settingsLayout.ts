export const SETTINGS_PAGE_CLASS = "space-y-6 w-full";
export const SETTINGS_FIELD_GRID = "grid grid-cols-1 sm:grid-cols-2 gap-4";
export const SETTINGS_PLANS_GRID = "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4";

/** A container that spans the full available width with no fixed max-width cap. */
export function fillsViewportWidth(cls: string): boolean {
  const tokens = cls.split(/\s+/);
  return tokens.includes("w-full") && !tokens.some(t => /^(max-w-|sm:max-w-|md:max-w-|lg:max-w-)/.test(t));
}

/** Mobile-first grid: single column on the smallest breakpoint, more columns above it. */
export function isMobileFirstGrid(cls: string): boolean {
  const tokens = cls.split(/\s+/);
  return tokens.includes("grid-cols-1") && tokens.some(t => /^(sm|md|lg|xl):grid-cols-[2-9]/.test(t));
}
