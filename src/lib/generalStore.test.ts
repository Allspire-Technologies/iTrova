import { describe, it, expect, vi } from "vitest";

// The module imports the Supabase client (no env in CI) — stub it; these tests only touch pure helpers.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { outstanding, isOverdue, itemStatus, friendlyStoreError } from "./generalStore";

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

describe("friendlyStoreError", () => {
  it("humanises the server's typed prefixes", () => {
    expect(friendlyStoreError("INSUFFICIENT_STOCK:Drill", "x")).toBe("Not enough stock for Drill");
    expect(friendlyStoreError("WRONG_KIND:Screws", "x")).toBe("Screws can't be used that way");
    expect(friendlyStoreError("RETURN_TOO_MUCH:3", "x")).toBe("You can only return up to 3");
    expect(friendlyStoreError("", "fallback")).toBe("fallback");
  });
});
