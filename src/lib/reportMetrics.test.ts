import { describe, it, expect } from "vitest";
import {
  paymentMethodBreakdown,
  salesRevenue,
  unitsSold,
  computeCogs,
  salesSummary,
  pctChange,
  outOfStockProducts,
  lowStockProducts,
  totalStockUnits,
  topProductsByRevenue,
  staffRevenue,
  productTurnover,
  supplierSpendTotal,
  supplierSpendRows,
} from "./reportMetrics";

const products = [
  { id: "p1", name: "Apples", cost_price: 6, stock_quantity: 0, reorder_level: 5 },
  { id: "p2", name: "Bread", cost_price: 2, stock_quantity: 3, reorder_level: 5 },
  { id: "p3", name: "Cocoa", cost_price: null, stock_quantity: 20, reorder_level: 5 },
];

const sales = [
  { id: "s1", total_amount: 100, staff_id: "u1" },
  { id: "s2", total_amount: 50, staff_id: null },
  { id: "s3", total_amount: 25, staff_id: "u2" },
];

const items = [
  { product_id: "p1", quantity: 2, unit_price: 10 },
  { product_id: "p2", quantity: 5, unit_price: 4 },
  { product_id: null, quantity: 1, unit_price: 7 },
];

describe("salesRevenue / unitsSold", () => {
  it("sums totals and quantities", () => {
    expect(salesRevenue(sales)).toBe(175);
    expect(unitsSold(items)).toBe(8);
    expect(salesRevenue([])).toBe(0);
  });
});

describe("computeCogs", () => {
  it("multiplies each item's quantity by its product cost", () => {
    expect(computeCogs(items, products)).toBe(2 * 6 + 5 * 2 + 0);
  });
  it("treats missing product, null product_id, and null cost as zero cost", () => {
    expect(computeCogs([{ product_id: "ghost", quantity: 9 }], products)).toBe(0);
    expect(computeCogs([{ product_id: "p3", quantity: 9 }], products)).toBe(0);
    expect(computeCogs([{ product_id: null, quantity: 9 }], products)).toBe(0);
  });
});

describe("salesSummary", () => {
  it("rolls up revenue, txns, avg, units, cogs and gross profit", () => {
    expect(salesSummary(sales, items, products)).toEqual({
      revenue: 175,
      txns: 3,
      avg: 175 / 3,
      units: 8,
      cogs: 22,
      grossProfit: 153,
    });
  });
  it("avoids divide-by-zero on the average", () => {
    expect(salesSummary([], [], products).avg).toBe(0);
  });
});

describe("pctChange", () => {
  it("computes percent change and guards a zero base", () => {
    expect(pctChange(150, 100)).toBe(50);
    expect(pctChange(50, 100)).toBe(-50);
    expect(pctChange(5, 0)).toBeNull();
  });
});

describe("stock helpers", () => {
  it("finds out-of-stock products", () => {
    expect(outOfStockProducts(products).map((p) => p.id)).toEqual(["p1"]);
  });
  it("finds low (but not zero) stock products", () => {
    expect(lowStockProducts(products).map((p) => p.id)).toEqual(["p2"]);
  });
  it("totals stock units", () => {
    expect(totalStockUnits(products)).toBe(23);
  });
});

describe("topProductsByRevenue", () => {
  it("aggregates by product and sorts by revenue, naming unknowns", () => {
    const top = topProductsByRevenue(items, products);
    expect(top).toHaveLength(3);
    expect(top[0]).toEqual({ name: "Apples", qty: 2, revenue: 20 });
    expect(top[2]).toEqual({ name: "Unknown", qty: 1, revenue: 7 });
  });
  it("respects the limit", () => {
    expect(topProductsByRevenue(items, products, 1)).toHaveLength(1);
  });
});

describe("staffRevenue", () => {
  it("groups by staff name, labels walk-ins and unknown staff, sorts desc", () => {
    const rows = staffRevenue(
      [...sales, { total_amount: 10, staff_id: "u9" }],
      { u1: "Alice", u2: "Bob" },
    );
    expect(rows[0]).toEqual({ name: "Alice", revenue: 100 });
    expect(rows.find((r) => r.name === "Walk-in")?.revenue).toBe(50);
    expect(rows.find((r) => r.name === "Staff")?.revenue).toBe(10);
  });
});

describe("productTurnover", () => {
  it("keeps only sold products and sorts by turnover rate (null first)", () => {
    const rows = productTurnover(items, products);
    expect(rows.map((r) => r.name)).toEqual(["Apples", "Bread"]);
    expect(rows[0].rate).toBeNull();
    expect(rows[1].rate).toBeCloseTo(5 / 3);
  });
});

describe("supplier spend", () => {
  const purchases = [
    { supplier_id: "sup1", total_cost: 100 },
    { supplier_id: "sup1", total_cost: 50 },
    { supplier_id: null, total_cost: 30 },
  ];
  it("totals all purchases", () => {
    expect(supplierSpendTotal(purchases)).toBe(180);
  });
  it("groups by supplier name and sorts desc", () => {
    const rows = supplierSpendRows(purchases, [{ id: "sup1", name: "Olu Farms" }]);
    expect(rows).toEqual([
      { name: "Olu Farms", total: 150 },
      { name: "Unknown", total: 30 },
    ]);
  });
});

describe("paymentMethodBreakdown", () => {
  it("groups amounts by method, sorts by total desc, and computes the share", () => {
    const rows = paymentMethodBreakdown([
      { method: "cash", amount: 6000 },
      { method: "transfer", amount: 3000 },
      { method: "cash", amount: 1000 },
    ]);
    expect(rows).toEqual([
      { method: "cash", total: 7000, pct: 70 },
      { method: "transfer", total: 3000, pct: 30 },
    ]);
    expect(rows.reduce((s, r) => s + r.pct, 0)).toBeCloseTo(100, 5);
  });

  it("handles a split sale contributing to each of its methods", () => {
    const rows = paymentMethodBreakdown([{ method: "cash", amount: 5000 }, { method: "transfer", amount: 3500 }]);
    expect(rows.map((r) => r.method)).toEqual(["cash", "transfer"]);
    expect(rows[0].total).toBe(5000);
  });

  it("returns empty for no lines and skips zero-total methods", () => {
    expect(paymentMethodBreakdown([])).toEqual([]);
    expect(paymentMethodBreakdown([{ method: "cash", amount: 0 }])).toEqual([]);
  });
});
