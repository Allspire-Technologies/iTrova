import { describe, it, expect } from "vitest";
import {
  cartSubtotal,
  summarizeHeldSale,
  heldItemsPreview,
  heldStorageKey,
  parseHeldSales,
  serializeHeldSales,
  HeldSale,
} from "./heldSales";

const item = (id: string, price: number, qty: number) => ({
  product: { id, name: id, selling_price: price, stock_quantity: 100 },
  qty,
});

const sale: HeldSale = {
  id: "h1",
  createdAt: "2026-06-23T10:00:00.000Z",
  items: [item("a", 8500, 2), item("b", 8000, 1)],
  discount: 1000,
};

describe("cartSubtotal", () => {
  it("sums quantity × price", () => {
    expect(cartSubtotal(sale.items)).toBe(8500 * 2 + 8000);
  });
  it("is zero for an empty cart", () => {
    expect(cartSubtotal([])).toBe(0);
  });
});

describe("summarizeHeldSale", () => {
  it("counts line items and applies the discount", () => {
    expect(summarizeHeldSale(sale)).toEqual({ count: 2, subtotal: 25000, total: 24000 });
  });
  it("never goes below zero when the discount exceeds the subtotal", () => {
    expect(summarizeHeldSale({ items: [item("a", 100, 1)], discount: 500 }).total).toBe(0);
  });
});

describe("heldItemsPreview", () => {
  it("lists quantity × name for each item", () => {
    expect(heldItemsPreview(sale.items)).toBe("2× a, 1× b");
  });
  it("truncates beyond the max with a +N more suffix", () => {
    const items = [item("a", 1, 1), item("b", 1, 2), item("c", 1, 3), item("d", 1, 4)];
    expect(heldItemsPreview(items, 2)).toBe("1× a, 2× b +2 more");
  });
});

describe("heldStorageKey", () => {
  it("namespaces by business", () => {
    expect(heldStorageKey("biz-1")).toBe("itrova:held-sales:biz-1");
  });
});

describe("parseHeldSales / serializeHeldSales", () => {
  it("round-trips a list of held sales", () => {
    expect(parseHeldSales(serializeHeldSales([sale]))).toEqual([sale]);
  });
  it("returns an empty list for null, invalid JSON or a non-array", () => {
    expect(parseHeldSales(null)).toEqual([]);
    expect(parseHeldSales("not json")).toEqual([]);
    expect(parseHeldSales('{"a":1}')).toEqual([]);
  });
  it("drops malformed entries", () => {
    const raw = JSON.stringify([sale, { id: "x" }, { items: [] }, null]);
    expect(parseHeldSales(raw)).toEqual([sale]);
  });
});
