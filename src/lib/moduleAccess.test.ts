import { describe, it, expect } from "vitest";
import { canAccessModule, planModules } from "./moduleAccess";

describe("canAccessModule", () => {
  it("grants everything when no modules are configured (opt-in gating)", () => {
    expect(canAccessModule(null, "inventory")).toBe(true);
    expect(canAccessModule(undefined, "inventory")).toBe(true);
    expect(canAccessModule([], "inventory")).toBe(true);
  });
  it("grants only listed modules once a plan configures them", () => {
    expect(canAccessModule(["inventory", "pos"], "inventory")).toBe(true);
    expect(canAccessModule(["inventory", "pos"], "insights")).toBe(false);
  });
});

describe("planModules", () => {
  it("returns the plan's own modules when configured", () => {
    expect(planModules({ key: "pro", modules: ["inventory", "insights"] })).toEqual(["inventory", "insights"]);
  });
  it("invents nothing — a plan with no modules is the backend's answer, not ours", () => {
    // There is deliberately no hardcoded free baseline any more: a copy of the list in the app
    // goes stale the moment a plan is edited in the CRM (the old constant still claimed Free
    // included suppliers, raw materials, purchase orders and CSV long after it didn't).
    expect(planModules(null)).toBeNull();
    expect(planModules({ key: "free", modules: [] })).toBeNull();
    expect(planModules({ key: "free", modules: null })).toBeNull();
    expect(planModules({ key: "business", modules: [] })).toBeNull();
  });

  it("an unconfigured plan grants everything in the app because the database agrees", () => {
    // _plan_has_module applies the same opt-in rule, so a misconfigured plan row can't leave the
    // UI blocking what the database allows (or the reverse).
    const gated = planModules({ key: "free", modules: [] });
    expect(canAccessModule(gated, "inventory")).toBe(true);
    expect(canAccessModule(gated, "insights")).toBe(true);
  });
});
