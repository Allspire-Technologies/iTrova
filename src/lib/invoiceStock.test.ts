import { describe, it, expect } from "vitest";
import { CUSTOM, qtyByProduct, availableFor, stockShortfalls } from "./invoiceStock";

const products = [
  { id: "p1", name: "Bag of rice", stock_quantity: 10 },
  { id: "p2", name: "Bottle of oil", stock_quantity: 3 },
];

describe("qtyByProduct", () => {
  it("aggregates the same product across lines and ignores custom/empty lines", () => {
    const lines = [
      { productKey: "p1", quantity: 2 },
      { productKey: "p1", quantity: 3 },
      { productKey: CUSTOM, quantity: 5 }, // custom line — no stock
      { productKey: "", quantity: 9 },      // unselected — ignored
    ];
    expect(qtyByProduct(lines)).toEqual({ p1: 5 });
  });

  it("is empty when there are no inventory lines", () => {
    expect(qtyByProduct([{ productKey: CUSTOM, quantity: 4 }])).toEqual({});
  });
});

describe("availableFor", () => {
  it("returns live stock when nothing is committed (new invoice)", () => {
    expect(availableFor("p2", products)).toBe(3);
  });

  it("adds back the quantity this invoice already holds (edit frees its own stock)", () => {
    // Editing an invoice that already took 4 of p1: 10 live + 4 held = 14 available to it.
    expect(availableFor("p1", products, { p1: 4 })).toBe(14);
  });

  it("returns 0 for an unknown product", () => {
    expect(availableFor("ghost", products)).toBe(0);
  });
});

describe("stockShortfalls", () => {
  it("passes when every line is within stock", () => {
    expect(stockShortfalls([{ productKey: "p1", quantity: 10 }], products)).toEqual([]);
  });

  it("flags a line that exceeds available stock", () => {
    const errs = stockShortfalls([{ productKey: "p2", quantity: 5 }], products);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain("Bottle of oil");
    expect(errs[0]).toContain("only 3");
  });

  it("sums duplicate product lines before checking (2 + 2 of a 3-stock item oversells)", () => {
    const errs = stockShortfalls(
      [{ productKey: "p2", quantity: 2 }, { productKey: "p2", quantity: 2 }],
      products,
    );
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain("4 requested");
  });

  it("counts committed stock so an edit that keeps the same quantity is allowed", () => {
    // Invoice already holds 5 of p1 (live stock shows 10). Re-saving 12 needs 12 <= 10 + 5 = 15 → ok.
    expect(stockShortfalls([{ productKey: "p1", quantity: 12 }], products, { p1: 5 })).toEqual([]);
    // ...but 16 still oversells.
    expect(stockShortfalls([{ productKey: "p1", quantity: 16 }], products, { p1: 5 })).toHaveLength(1);
  });

  it("never flags custom lines", () => {
    expect(stockShortfalls([{ productKey: CUSTOM, quantity: 9999 }], products)).toEqual([]);
  });
});
