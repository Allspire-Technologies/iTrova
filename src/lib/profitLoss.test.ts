import { describe, it, expect } from "vitest";
import {
  netOfVat, margin, revenueNetOfVat, isRevenueInvoice, computeCogs, itemsMissingCost,
  expenseLinesNetOfVat, buildPnl, pctChange,
} from "./profitLoss";

describe("netOfVat", () => {
  it("strips VAT from a gross amount", () => {
    expect(netOfVat(107500, 7500)).toBe(100000);
  });
  it("is the gross when there is no VAT", () => {
    expect(netOfVat(50000, 0)).toBe(50000);
  });
});

describe("margin", () => {
  it("is a percentage of revenue", () => {
    expect(margin(40000, 100000)).toBe(40);
  });
  it("is null when revenue is zero", () => {
    expect(margin(0, 0)).toBeNull();
  });
  it("can be negative (a loss)", () => {
    expect(margin(-20000, 100000)).toBe(-20);
  });
});

describe("revenue from invoices", () => {
  it("only issued/partial/paid invoices recognise revenue", () => {
    expect(isRevenueInvoice({ status: "issued" })).toBe(true);
    expect(isRevenueInvoice({ status: "partial" })).toBe(true);
    expect(isRevenueInvoice({ status: "paid" })).toBe(true);
    expect(isRevenueInvoice({ status: "draft" })).toBe(false);
    expect(isRevenueInvoice({ status: "void" })).toBe(false);
  });
  it("sums invoices net of VAT", () => {
    expect(revenueNetOfVat([
      { total: 107500, tax: 7500, status: "paid" },
      { total: 50000, tax: 0, status: "issued" },
    ])).toBe(150000);
  });
});

describe("computeCogs", () => {
  const products = [{ id: "p1", cost_price: 600 }, { id: "p2", cost_price: 1000 }];
  it("prefers the captured unit_cost", () => {
    expect(computeCogs([{ product_id: "p1", quantity: 10, unit_cost: 550 }], products)).toBe(5500);
  });
  it("falls back to the product's current cost when unit_cost is null", () => {
    expect(computeCogs([{ product_id: "p1", quantity: 10, unit_cost: null }], products)).toBe(6000);
  });
  it("treats unlinked lines as zero cost", () => {
    expect(computeCogs([{ product_id: null, quantity: 5 }], products)).toBe(0);
  });
  it("sums a mixed cart", () => {
    expect(computeCogs([
      { product_id: "p1", quantity: 10, unit_cost: 550 }, // 5500
      { product_id: "p2", quantity: 3 },                   // 3000 (fallback)
    ], products)).toBe(8500);
  });
});

describe("itemsMissingCost", () => {
  const products = [{ id: "p1", cost_price: 600 }, { id: "p2", cost_price: 0 }];
  it("counts units with neither a captured nor a product cost", () => {
    expect(itemsMissingCost([
      { product_id: "p1", quantity: 5, unit_cost: 550 }, // known (captured)
      { product_id: "p1", quantity: 2 },                  // known (product cost)
      { product_id: "p2", quantity: 4 },                  // missing (cost 0)
      { product_id: null, quantity: 3 },                  // missing (no product)
    ], products)).toBe(7);
  });
});

describe("expenseLinesNetOfVat", () => {
  it("groups by category net of VAT, largest first", () => {
    expect(expenseLinesNetOfVat([
      { category: "Rent", amount: 150000, tax_amount: 0 },
      { category: "Salaries", amount: 200000 },
      { category: "Rent", amount: 21500, tax_amount: 1500 },
    ])).toEqual([
      { category: "Salaries", amount: 200000 },
      { category: "Rent", amount: 170000 },
    ]);
  });
  it("labels blank categories Uncategorised", () => {
    expect(expenseLinesNetOfVat([{ category: "  ", amount: 5000 }])[0].category).toBe("Uncategorised");
  });
});

describe("buildPnl", () => {
  it("computes gross/net profit and margins", () => {
    const s = buildPnl({
      revenue: 500000, cogs: 300000,
      expenses: [{ category: "Salaries", amount: 80000 }, { category: "Rent", amount: 50000 }],
    });
    expect(s.grossProfit).toBe(200000);
    expect(s.grossMargin).toBe(40);
    expect(s.totalExpenses).toBe(130000);
    expect(s.netProfit).toBe(70000);
    expect(s.netMargin).toBe(14);
  });
  it("handles a loss and zero-revenue margins", () => {
    const s = buildPnl({ revenue: 0, cogs: 0, expenses: [{ category: "Rent", amount: 50000 }] });
    expect(s.netProfit).toBe(-50000);
    expect(s.grossMargin).toBeNull();
    expect(s.netMargin).toBeNull();
  });
});

describe("pctChange", () => {
  it("is null when the previous value is zero", () => {
    expect(pctChange(100, 0)).toBeNull();
  });
  it("computes a percentage change", () => {
    expect(pctChange(150, 100)).toBe(50);
  });
});
