import { describe, it, expect } from "vitest";
import { buildCashFlow, inventoryValue, receivablesOutstanding, buildBalanceSheet } from "./financials";

describe("buildCashFlow", () => {
  it("nets inflows against outflows and drops zero lines", () => {
    const cf = buildCashFlow(
      [{ label: "Sales receipts", amount: 500000 }, { label: "Invoice payments", amount: 0 }],
      [{ label: "Expenses", amount: 120000 }, { label: "Purchases", amount: 80000 }],
    );
    expect(cf.inflows).toEqual([{ label: "Sales receipts", amount: 500000 }]); // zero line dropped
    expect(cf.totalIn).toBe(500000);
    expect(cf.totalOut).toBe(200000);
    expect(cf.net).toBe(300000);
  });
  it("can be negative (more cash out than in)", () => {
    const cf = buildCashFlow([{ label: "Sales", amount: 50000 }], [{ label: "Rent", amount: 80000 }]);
    expect(cf.net).toBe(-30000);
  });
});

describe("inventoryValue", () => {
  it("values products and raw materials at cost", () => {
    expect(inventoryValue(
      [{ stock_quantity: 20, cost_price: 6000 }, { stock_quantity: 5, cost_price: 1000 }],
      [{ stock_quantity: 100, cost_per_unit: 250 }],
    )).toBe(150000); // 120000 + 5000 + 25000
  });
  it("treats missing costs/stock as zero", () => {
    expect(inventoryValue([{ stock_quantity: 10, cost_price: null }], [])).toBe(0);
  });
});

describe("receivablesOutstanding", () => {
  it("sums the unpaid balance of issued/partial invoices only", () => {
    expect(receivablesOutstanding([
      { total: 100000, amount_paid: 0, status: "issued" },     // 100000
      { total: 50000, amount_paid: 20000, status: "partial" }, // 30000
      { total: 80000, amount_paid: 80000, status: "paid" },    // ignored (paid)
      { total: 40000, amount_paid: 0, status: "draft" },       // ignored (draft)
    ])).toBe(130000);
  });
  it("never goes negative on overpayment", () => {
    expect(receivablesOutstanding([{ total: 10000, amount_paid: 12000, status: "partial" }])).toBe(0);
  });
});

describe("buildBalanceSheet", () => {
  it("totals assets, liabilities and equity and surfaces any difference", () => {
    const bs = buildBalanceSheet({
      cash: 200000, inventory: 150000, receivables: 130000,
      payables: 40000, vatPayable: 15000,
      capital: 300000, retainedEarnings: 100000,
    });
    expect(bs.totalAssets).toBe(480000);
    expect(bs.totalLiabilities).toBe(55000);
    expect(bs.totalEquity).toBe(400000);
    expect(bs.difference).toBe(480000 - (55000 + 400000)); // 25000 unreconciled
  });
  it("clamps a negative VAT position to zero (nothing payable)", () => {
    const bs = buildBalanceSheet({ cash: 0, inventory: 0, receivables: 0, payables: 0, vatPayable: -5000, capital: 0, retainedEarnings: 0 });
    expect(bs.vatPayable).toBe(0);
  });
});
