import { describe, it, expect } from "vitest";
import { getLimit, isAtLimit, limitMessage, registerPlanLimits } from "./planLimits";

describe("getLimit", () => {
  it("returns the free cap for free/unset tiers", () => {
    expect(getLimit("free", "products")).toBe(25);
    expect(getLimit(null, "products")).toBe(25);
    expect(getLimit(undefined, "staff")).toBe(3);
  });
  it("is unlimited for resources Free's plan doesn't include (no module = no cap)", () => {
    expect(getLimit("free", "suppliers")).toBeNull();
    expect(getLimit("free", "purchaseOrders")).toBeNull();
  });
  it("returns null (unlimited) for paid tiers", () => {
    expect(getLimit("pro", "products")).toBeNull();
    expect(getLimit("business", "invoices")).toBeNull();
  });
});

describe("isAtLimit", () => {
  it("is true at or over the cap on free", () => {
    expect(isAtLimit(25, "free", "products")).toBe(true);
    expect(isAtLimit(26, "free", "products")).toBe(true);
  });
  it("is false below the cap", () => {
    expect(isAtLimit(24, "free", "products")).toBe(false);
  });
  it("is always false on paid tiers", () => {
    expect(isAtLimit(99_999, "pro", "products")).toBe(false);
  });
});

describe("limitMessage", () => {
  it("mentions the cap and the resource label", () => {
    const msg = limitMessage("products");
    expect(msg).toContain("25");
    expect(msg).toContain("products");
  });
});

describe("registerPlanLimits (DB-driven)", () => {
  it("uses the registered caps for a tier, with null meaning unlimited", () => {
    registerPlanLimits([{ key: "scale", limits: { products: 500, staff: null } }]);
    expect(getLimit("scale", "products")).toBe(500);
    expect(getLimit("scale", "staff")).toBeNull();
    expect(isAtLimit(500, "scale", "products")).toBe(true);
    expect(isAtLimit(499, "scale", "products")).toBe(false);
  });

  it("treats a resource absent from the registered plan as unlimited (non-free tier)", () => {
    registerPlanLimits([{ key: "partial", limits: { products: 7 } }]);
    expect(getLimit("partial", "products")).toBe(7);
    expect(getLimit("partial", "suppliers")).toBeNull();
  });

  it("resolves limits keyed by module name", () => {
    registerPlanLimits([{ key: "modplan", limits: { inventory: 80, team: null } }]);
    expect(getLimit("modplan", "products")).toBe(80); // products -> inventory module
    expect(getLimit("modplan", "staff")).toBeNull();  // staff -> team module (unlimited)
  });
});
