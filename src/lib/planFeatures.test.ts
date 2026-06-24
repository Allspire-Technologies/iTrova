import { describe, it, expect } from "vitest";
import { highestCataloguePlan, previousCataloguePlan, includesAll, featuresBeyond, planChangeAction } from "./planFeatures";

const plan = (key: string, sort_order: number, business_id: string | null = null) => ({ key, sort_order, business_id });

describe("highestCataloguePlan", () => {
  it("returns the catalogue plan with the highest sort_order", () => {
    const plans = [plan("free", 1), plan("pro", 2), plan("enterprise", 4), plan("business", 3)];
    expect(highestCataloguePlan(plans)?.key).toBe("enterprise");
  });
  it("ignores per-business custom plans", () => {
    const plans = [plan("enterprise", 4), plan("bespoke", 99, "biz-1")];
    expect(highestCataloguePlan(plans)?.key).toBe("enterprise");
  });
  it("returns null when there are no catalogue plans", () => {
    expect(highestCataloguePlan([])).toBeNull();
    expect(highestCataloguePlan([plan("bespoke", 5, "biz-1")])).toBeNull();
  });
});

describe("previousCataloguePlan", () => {
  const free = plan("free", 1), pro = plan("pro", 2), business = plan("business", 3), enterprise = plan("enterprise", 4);
  const plans = [free, pro, business, enterprise];
  it("finds the next-lower catalogue tier", () => {
    expect(previousCataloguePlan(plans, pro)?.key).toBe("free");
    expect(previousCataloguePlan(plans, enterprise)?.key).toBe("business");
  });
  it("returns null for the lowest plan", () => {
    expect(previousCataloguePlan(plans, free)).toBeNull();
  });
  it("ignores per-business custom plans as references", () => {
    const custom = plan("bespoke", 2.5, "biz-1");
    expect(previousCataloguePlan([...plans, custom], business)?.key).toBe("pro");
  });
});

describe("includesAll", () => {
  it("is true when every base feature is present", () => {
    expect(includesAll(["A", "B", "C"], ["A", "B"])).toBe(true);
    expect(includesAll(["A", "B"], [])).toBe(true);
  });
  it("is false when a base feature is missing", () => {
    expect(includesAll(["A", "C"], ["A", "B"])).toBe(false);
  });
});

describe("planChangeAction", () => {
  it("is a downgrade when the target tier is below the current tier", () => {
    expect(planChangeAction(1, 4)).toBe("downgrade"); // Free while on Enterprise
    expect(planChangeAction(2, 3)).toBe("downgrade");
  });
  it("is an upgrade when the target tier is above the current tier", () => {
    expect(planChangeAction(4, 1)).toBe("upgrade");
  });
  it("defaults to upgrade when the current tier is unknown", () => {
    expect(planChangeAction(1, null)).toBe("upgrade");
    expect(planChangeAction(1, undefined)).toBe("upgrade");
  });
});

describe("featuresBeyond", () => {
  it("keeps only features not already in the base", () => {
    expect(featuresBeyond(["API integrations", "SLA agreements", "Reports"], ["Reports", "POS"]))
      .toEqual(["API integrations", "SLA agreements"]);
  });
  it("returns all features when the base is empty", () => {
    expect(featuresBeyond(["A", "B"], [])).toEqual(["A", "B"]);
  });
  it("de-duplicates", () => {
    expect(featuresBeyond(["A", "A", "B"], [])).toEqual(["A", "B"]);
  });
});
