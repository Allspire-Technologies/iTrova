import { describe, it, expect } from "vitest";
import { getLimit, isAtLimit, limitMessage, registerPlanLimits } from "./planLimits";

// Every cap now comes from the backend (plans.limits, loaded via registerPlanLimits). There is no
// hardcoded copy in the app to test against — a number written here would only prove the app agrees
// with itself, which is exactly how the old constant drifted from the real Free plan.
describe("getLimit", () => {
  it("caps nothing until the backend has published the plans", () => {
    expect(getLimit("not-loaded-yet", "products")).toBeNull();
    expect(getLimit(null, "products")).toBeNull();
    expect(getLimit(undefined, "staff")).toBeNull();
  });
  it("returns the published cap once the plan is registered", () => {
    registerPlanLimits([{ key: "free", limits: { inventory: 25, invoices: 50, team: 3 } }]);
    expect(getLimit("free", "products")).toBe(25);
    expect(getLimit("free", "invoices")).toBe(50);
    expect(getLimit("free", "staff")).toBe(3);
  });
  it("is unlimited for resources the plan doesn't cap (no key = no cap)", () => {
    registerPlanLimits([{ key: "free", limits: { inventory: 25 } }]);
    expect(getLimit("free", "suppliers")).toBeNull();
    expect(getLimit("free", "purchaseOrders")).toBeNull();
  });
  it("treats malformed caps as no cap — the same fail-open rule as the database", () => {
    // _plan_cap warns and returns null for any non-number JSON value. If the client coerced
    // instead, Number("") = 0 would lock every control while the database accepts the write.
    registerPlanLimits([{ key: "broken", limits: {
      inventory: "25" as unknown as number,   // numeric string: DB ignores it, so must we
      invoices: "" as unknown as number,      // Number("") === 0 — the dangerous one
      team: NaN,
    } }]);
    expect(getLimit("broken", "products")).toBeNull();
    expect(getLimit("broken", "invoices")).toBeNull();
    expect(getLimit("broken", "staff")).toBeNull();
    expect(isAtLimit(999, "broken", "invoices")).toBe(false);
  });
});

describe("isAtLimit", () => {
  it("is true at or over the published cap", () => {
    registerPlanLimits([{ key: "free", limits: { inventory: 25 } }]);
    expect(isAtLimit(25, "free", "products")).toBe(true);
    expect(isAtLimit(26, "free", "products")).toBe(true);
    expect(isAtLimit(24, "free", "products")).toBe(false);
  });
  it("is false where the plan sets no cap", () => {
    registerPlanLimits([{ key: "pro", limits: { team: 7 } }]);
    expect(isAtLimit(99_999, "pro", "products")).toBe(false);
  });
});

describe("limitMessage", () => {
  it("quotes the CALLER'S plan and cap, not Free's", () => {
    registerPlanLimits([
      { key: "free", limits: { team: 3 } },
      { key: "pro", limits: { team: 7 } },
    ]);
    const pro = limitMessage("staff", "pro");
    expect(pro).toContain("7");            // the Pro cap...
    expect(pro).toContain("Pro");
    expect(pro).not.toContain("Free");     // ...never "Free plan limit reached (3)" to a payer
    expect(limitMessage("staff", "free")).toContain("3");
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
