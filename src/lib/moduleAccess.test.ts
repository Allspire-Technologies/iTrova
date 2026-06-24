import { describe, it, expect } from "vitest";
import { canAccessModule, planModules, FREE_MODULES } from "./moduleAccess";

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
  it("falls back to FREE_MODULES when the Free plan has no modules", () => {
    expect(planModules({ key: "free", modules: [] })).toEqual(FREE_MODULES);
    expect(planModules({ key: "free", modules: null })).toEqual(FREE_MODULES);
  });
  it("does not invent modules for a null plan or a non-free empty plan", () => {
    expect(planModules(null)).toBeNull();
    expect(planModules({ key: "business", modules: [] })).toBeNull();
  });

  it("a misconfigured Free plan stays gated to the free baseline, not everything", () => {
    const gated = planModules({ key: "free", modules: [] });
    expect(canAccessModule(gated, "inventory")).toBe(true);   // a free module
    expect(canAccessModule(gated, "insights")).toBe(false);   // a paid module — must stay blocked
  });
});
