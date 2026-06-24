import { describe, it, expect } from "vitest";
import { highestCataloguePlan, featuresBeyond } from "./planFeatures";

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
