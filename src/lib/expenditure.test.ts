import { describe, it, expect, vi } from "vitest";
import { periodTotal, byCategory, isOverdue, displayStatus, netProfit, EXPENSE_CATEGORIES } from "./expenditure";

// expenditure.ts imports the Supabase client transitively; stub it so importing needs no env.
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn() } }));

const e = (over: Partial<{ category: string; amount: number; status: "paid" | "pending"; due_date: string | null }> = {}) => ({
  category: "Rent", amount: 100, status: "paid" as const, due_date: null, ...over,
});

describe("periodTotal", () => {
  it("sums amounts, tolerating strings/blanks", () => {
    expect(periodTotal([e({ amount: 100 }), e({ amount: 250 }), { amount: 0 }])).toBe(350);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(periodTotal([{ amount: "1,000" as any }, { amount: NaN as any }])).toBe(0); // non-numeric → 0
  });
});

describe("byCategory", () => {
  it("groups and sorts by total desc, folding blanks into Uncategorised", () => {
    const rows = byCategory([
      e({ category: "Rent", amount: 100 }),
      e({ category: "Transport", amount: 300 }),
      e({ category: "Rent", amount: 50 }),
      e({ category: "", amount: 20 }),
    ]);
    expect(rows).toEqual([
      { category: "Transport", total: 300 },
      { category: "Rent", total: 150 },
      { category: "Uncategorised", total: 20 },
    ]);
  });
});

describe("isOverdue / displayStatus", () => {
  const today = "2026-07-08";
  it("paid is never overdue", () => {
    expect(isOverdue(e({ status: "paid", due_date: "2026-01-01" }), today)).toBe(false);
    expect(displayStatus(e({ status: "paid" }), today)).toBe("paid");
  });
  it("pending past due is overdue; pending future is just pending", () => {
    expect(isOverdue(e({ status: "pending", due_date: "2026-07-01" }), today)).toBe(true);
    expect(displayStatus(e({ status: "pending", due_date: "2026-07-01" }), today)).toBe("overdue");
    expect(displayStatus(e({ status: "pending", due_date: "2026-07-20" }), today)).toBe("pending");
    expect(displayStatus(e({ status: "pending", due_date: null }), today)).toBe("pending");
  });
});

describe("netProfit", () => {
  it("subtracts expenses from gross profit", () => {
    expect(netProfit(420000, 130000)).toBe(290000);
    expect(netProfit(0, 0)).toBe(0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(netProfit("x" as any, 100)).toBe(-100); // non-numeric gross → 0
  });
});

describe("categories", () => {
  it("ships a curated default list including Other", () => {
    expect(EXPENSE_CATEGORIES).toContain("Rent");
    expect(EXPENSE_CATEGORIES.at(-1)).toBe("Other");
  });
});
