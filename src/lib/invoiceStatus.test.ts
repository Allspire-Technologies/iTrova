import { describe, it, expect } from "vitest";
import { statusOptionsFor, isOverdue, overdueDays, INVOICE_STATUSES } from "./invoiceStatus";

describe("statusOptionsFor", () => {
  it("limits POS invoices to paid/void", () => {
    expect(statusOptionsFor({ sale_id: "s1", status: "paid" })).toEqual(["paid", "void"]);
    expect(statusOptionsFor({ sale_id: "s1", status: "issued" })).toEqual(["paid", "void"]);
  });
  it("limits already-paid invoices to paid/void", () => {
    expect(statusOptionsFor({ sale_id: null, status: "paid" })).toEqual(["paid", "void"]);
  });
  it("gives the full set to manual draft/issued invoices", () => {
    expect(statusOptionsFor({ sale_id: null, status: "issued" })).toEqual([...INVOICE_STATUSES]);
  });
});

describe("isOverdue", () => {
  const today = "2026-06-22";
  it("is true for an issued invoice past its due date", () => {
    expect(isOverdue({ status: "issued", due_date: "2026-06-01" }, today)).toBe(true);
  });
  it("is false on the due date itself (only strictly before)", () => {
    expect(isOverdue({ status: "issued", due_date: today }, today)).toBe(false);
  });
  it("is false for paid/void or future/missing due dates", () => {
    expect(isOverdue({ status: "paid", due_date: "2026-06-01" }, today)).toBe(false);
    expect(isOverdue({ status: "issued", due_date: "2026-07-01" }, today)).toBe(false);
    expect(isOverdue({ status: "issued", due_date: null }, today)).toBe(false);
  });
});

describe("overdueDays", () => {
  it("counts whole days overdue", () => {
    expect(overdueDays("2026-06-01", "2026-06-22")).toBe(21);
    expect(overdueDays("2026-06-21", "2026-06-22")).toBe(1);
  });
  it("never returns less than 1", () => {
    expect(overdueDays("2026-06-22", "2026-06-22")).toBe(1);
  });
});
