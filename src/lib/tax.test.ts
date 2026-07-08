import { describe, it, expect, vi } from "vitest";
import { lineTax, summariseCart, netVat, productRate, formatRate } from "./tax";

// tax.ts imports the Supabase client transitively; stub it so importing needs no env.
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn() } }));

describe("lineTax (VAT 7.5%)", () => {
  it("inclusive: extracts the embedded VAT", () => {
    const { base, tax, gross } = lineTax(1075, 1, 7.5, true);
    expect(gross).toBe(1075);
    expect(base).toBeCloseTo(1000, 6);
    expect(tax).toBeCloseTo(75, 6);
  });
  it("exclusive: adds VAT on top", () => {
    const { base, tax, gross } = lineTax(1000, 2, 7.5, false);
    expect(base).toBe(2000);
    expect(tax).toBeCloseTo(150, 6);
    expect(gross).toBeCloseTo(2150, 6);
  });
  it("exempt (null/0 rate) has no tax", () => {
    expect(lineTax(1000, 3, null, true)).toEqual({ base: 3000, tax: 0, gross: 3000 });
    expect(lineTax(1000, 3, 0, false)).toEqual({ base: 3000, tax: 0, gross: 3000 });
  });
});

describe("summariseCart", () => {
  it("inclusive mixed cart: total unchanged, VAT embedded, exempt line untaxed", () => {
    const s = summariseCart([
      { unitPrice: 1075, qty: 1, ratePct: 7.5 }, // taxable, VAT included
      { unitPrice: 500, qty: 2, ratePct: null },  // exempt (e.g. garri)
    ], 0, true);
    expect(s.subtotal).toBe(2075);
    expect(s.total).toBe(2075);          // inclusive → customer pays the tag price
    expect(s.taxTotal).toBeCloseTo(75, 2);
    expect(s.exemptBase).toBe(1000);
    expect(s.taxableBase).toBeCloseTo(1000, 2);
  });

  it("exclusive: VAT added on top of taxable, exempt excluded", () => {
    const s = summariseCart([
      { unitPrice: 1000, qty: 1, ratePct: 7.5 },
      { unitPrice: 500, qty: 1, ratePct: null },
    ], 0, false);
    expect(s.subtotal).toBe(1500);
    expect(s.taxTotal).toBeCloseTo(75, 2);   // 7.5% of the 1000 taxable line only
    expect(s.total).toBeCloseTo(1575, 2);
    expect(s.exemptBase).toBe(500);
  });

  it("discount is applied pro-rata before tax (inclusive)", () => {
    // Single taxable line, 100 discount off 1075 → taxed on 975 gross.
    const s = summariseCart([{ unitPrice: 1075, qty: 1, ratePct: 7.5 }], 100, true);
    expect(s.total).toBe(975);
    expect(s.taxTotal).toBeCloseTo(975 - 975 / 1.075, 2);
  });

  it("clamps an over-large discount to the subtotal", () => {
    const s = summariseCart([{ unitPrice: 1000, qty: 1, ratePct: null }], 5000, true);
    expect(s.discount).toBe(1000);
    expect(s.total).toBe(0);
  });
});

describe("netVat", () => {
  it("output minus input", () => {
    expect(netVat(48200, 12000)).toBe(36200);
    expect(netVat(0, 0)).toBe(0);
  });
});

describe("productRate", () => {
  const taxes = [{ id: "t1", rate: 7.5, active: true }, { id: "t2", rate: 5, active: false }];
  it("resolves an active tax's rate; null for exempt/inactive/missing", () => {
    expect(productRate("t1", taxes)).toBe(7.5);
    expect(productRate("t2", taxes)).toBeNull(); // inactive
    expect(productRate(null, taxes)).toBeNull();
    expect(productRate("nope", taxes)).toBeNull();
  });
});

describe("formatRate", () => {
  it("trims whole numbers, keeps one decimal otherwise", () => {
    expect(formatRate(7.5)).toBe("7.5%");
    expect(formatRate(5)).toBe("5%");
  });
});
