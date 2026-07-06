import { describe, it, expect } from "vitest";
import { recommendPlan, planCovers, SCALE_QUESTIONS, MODULE_CHOICES, type RecommendablePlan } from "./planRecommend";
import { FREE_MODULES } from "./moduleAccess";

const plan = (over: Partial<RecommendablePlan>): RecommendablePlan => ({
  key: "pro", name: "Pro", modules: [], limits: {}, price_amount: 5000, sort_order: 2, ...over,
});

// Catalogue mirroring the real shape: Free (empty modules → FREE_MODULES fallback, hardcoded caps),
// Pro (bigger caps), Enterprise (everything unlimited + paid modules).
const FREE = plan({ key: "free", name: "Free", modules: [], limits: {}, price_amount: 0, sort_order: 1 });
const PRO = plan({
  key: "pro", name: "Pro", price_amount: 5000, sort_order: 2,
  modules: [...FREE_MODULES, "export_invoices"],
  limits: { inventory: 1000, team: 10, invoices: 2000 },
});
const ENTERPRISE = plan({
  key: "enterprise", name: "Enterprise", price_amount: 20000, sort_order: 3,
  modules: [...FREE_MODULES, "export_invoices", "general_store"],
  limits: { inventory: null, team: null, invoices: null },
});
const CATALOGUE = [ENTERPRISE, FREE, PRO]; // deliberately unsorted

describe("planCovers", () => {
  it("free covers free-tier modules within free caps", () => {
    expect(planCovers(FREE, ["pos", "inventory"], { products: "s", staff: "s", invoices: "s" })).toBe(true);
  });

  it("free does not cover paid modules or bigger scale", () => {
    expect(planCovers(FREE, ["export_invoices"], {})).toBe(false);
    expect(planCovers(FREE, ["pos"], { products: "m" })).toBe(false); // 1,000 products > free's 100
  });

  it("a numeric cap fails an 'unlimited' band; a null cap satisfies it", () => {
    expect(planCovers(PRO, ["pos"], { products: "l" })).toBe(false);
    expect(planCovers(ENTERPRISE, ["pos"], { products: "l" })).toBe(true);
  });

  it("unanswered scale questions add no constraint", () => {
    expect(planCovers(FREE, ["pos"], {})).toBe(true);
  });
});

describe("recommendPlan", () => {
  it("recommends Free when it covers the selection", () => {
    expect(recommendPlan(["pos", "invoices"], { products: "s" }, CATALOGUE)).toEqual({ kind: "free" });
  });

  it("recommends the cheapest qualifying paid plan", () => {
    const r = recommendPlan(["pos", "export_invoices"], { products: "s" }, CATALOGUE);
    expect(r).toMatchObject({ kind: "plan", plan: { key: "pro" } });
  });

  it("escalates to the bigger plan when scale demands it", () => {
    const r = recommendPlan(["pos"], { products: "l" }, CATALOGUE);
    expect(r).toMatchObject({ kind: "plan", plan: { key: "enterprise" } });
  });

  it("returns custom when nothing in the catalogue covers the selection", () => {
    const r = recommendPlan(["some_future_module"], {}, [FREE, plan({ key: "pro", modules: ["pos"] })]);
    expect(r).toEqual({ kind: "custom" });
  });

  it("ignores inactive and business-specific plans", () => {
    const inactive = plan({ key: "pro", is_active: false, modules: [...FREE_MODULES, "export_invoices"] });
    const bespoke = plan({ key: "acme", business_id: "biz-9", modules: [...FREE_MODULES, "export_invoices"] });
    expect(recommendPlan(["export_invoices"], {}, [FREE, inactive, bespoke])).toEqual({ kind: "custom" });
  });

  it("ties on price break by sort_order", () => {
    const a = plan({ key: "a", price_amount: 5000, sort_order: 5, modules: [...FREE_MODULES, "export_invoices"] });
    const b = plan({ key: "b", price_amount: 5000, sort_order: 2, modules: [...FREE_MODULES, "export_invoices"] });
    const r = recommendPlan(["export_invoices"], {}, [FREE, a, b]);
    expect(r).toMatchObject({ kind: "plan", plan: { key: "b" } });
  });
});

describe("registry sanity", () => {
  it("every module choice is a known module key", () => {
    const known = new Set([...FREE_MODULES, "export_invoices", "general_store"]);
    for (const c of MODULE_CHOICES) expect(known.has(c.key), c.key).toBe(true);
  });

  it("every scale question has exactly one unlimited band", () => {
    for (const q of SCALE_QUESTIONS) {
      expect(q.bands.filter(b => b.requires === null)).toHaveLength(1);
    }
  });
});
