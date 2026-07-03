import { describe, it, expect, vi } from "vitest";

// The module imports the Supabase client (no env in CI) — stub it; these tests only touch pure helpers.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { outstanding, isOverdue, itemStatus, friendlyStoreError, parseStoreItemsCsv, parseStoreStaffCsv } from "./generalStore";

describe("outstanding", () => {
  it("is quantity minus returned, floored at zero", () => {
    expect(outstanding({ quantity: 5, returned_quantity: 2 })).toBe(3);
    expect(outstanding({ quantity: 5, returned_quantity: 5 })).toBe(0);
    expect(outstanding({ quantity: 5, returned_quantity: 7 })).toBe(0);
  });
});

describe("isOverdue", () => {
  const base = { kind: "borrow" as const, status: "out" as const, due_date: "2026-07-01" };
  it("flags a borrow still out past its due date", () => {
    expect(isOverdue(base, "2026-07-03")).toBe(true);
    expect(isOverdue({ ...base, status: "partially_returned" }, "2026-07-03")).toBe(true);
  });
  it("is false before the due date, when returned, or with no due date", () => {
    expect(isOverdue(base, "2026-06-30")).toBe(false);
    expect(isOverdue({ ...base, status: "returned" }, "2026-07-03")).toBe(false);
    expect(isOverdue({ ...base, due_date: null }, "2026-07-03")).toBe(false);
  });
  it("never flags a collect", () => {
    expect(isOverdue({ kind: "collect", status: "collected", due_date: "2026-01-01" }, "2026-07-03")).toBe(false);
  });
});

describe("itemStatus", () => {
  it("classifies out / low / ok against the reorder level", () => {
    expect(itemStatus({ stock_quantity: 0, reorder_level: 5 })).toBe("out");
    expect(itemStatus({ stock_quantity: 5, reorder_level: 5 })).toBe("low");
    expect(itemStatus({ stock_quantity: 6, reorder_level: 5 })).toBe("ok");
  });
});

describe("parseStoreItemsCsv", () => {
  it("maps case/spacing-varied headers, infers kind, and requires a name", () => {
    const { inserts, skipped } = parseStoreItemsCsv([
      { "Name": "Cordless Drill", "Category": "Tools", "Unit": "pcs", "Kind": "Borrowable", "Stock Quantity": "3", "Reorder Level": "1" },
      { "item name": "Wood Screws", "type": "material", "qty": "1,000" },
      { "Category": "no name" },
    ]);
    expect(skipped).toBe(1);
    expect(inserts).toHaveLength(2);
    expect(inserts[0]).toEqual({ name: "Cordless Drill", category: "Tools", unit: "pcs", kind: "borrowable", stock_quantity: 3, reorder_level: 1 });
    expect(inserts[1]).toMatchObject({ name: "Wood Screws", kind: "consumable", stock_quantity: 1000, unit: "pcs" });
  });
});

describe("parseStoreStaffCsv", () => {
  it("maps aliases, defaults active to true, and requires a name", () => {
    const { inserts, skipped } = parseStoreStaffCsv([
      { "Full Name": "Ayo Bello", "Title": "Operator", "Phone": "080", "Active": "no" },
      { "name": "Sade", "dept": "Packing" },
      { "phone": "0000" },
    ]);
    expect(skipped).toBe(1);
    expect(inserts[0]).toEqual({ name: "Ayo Bello", role: "Operator", phone: "080", active: false });
    expect(inserts[1]).toMatchObject({ name: "Sade", role: "Packing", active: true });
  });
});

describe("friendlyStoreError", () => {
  it("humanises the server's typed prefixes", () => {
    expect(friendlyStoreError("INSUFFICIENT_STOCK:Drill", "x")).toBe("Not enough stock for Drill");
    expect(friendlyStoreError("WRONG_KIND:Screws", "x")).toBe("Screws can't be used that way");
    expect(friendlyStoreError("RETURN_TOO_MUCH:3", "x")).toBe("You can only return up to 3");
    expect(friendlyStoreError("", "fallback")).toBe("fallback");
  });
});
