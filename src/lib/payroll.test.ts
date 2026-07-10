import { describe, it, expect, vi } from "vitest";
// payroll.ts imports the supabase client at module load; stub it so unit tests don't need env vars
// (same pattern as expenditure.test.ts). Only the pure helpers are exercised here.
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));
import { deductionTotal, lineNet, grossFor, summarisePayroll, friendlyPayrollError } from "./payroll";

describe("deductionTotal", () => {
  it("sums amounts and rounds to 2dp", () => {
    expect(deductionTotal([{ label: "Tax", amount: 1000 }, { label: "Pension", amount: 2500.5 }])).toBe(3500.5);
  });
  it("is zero for no deductions", () => {
    expect(deductionTotal([])).toBe(0);
  });
  it("ignores non-numeric amounts", () => {
    expect(deductionTotal([{ label: "x", amount: NaN as unknown as number }, { label: "y", amount: 500 }])).toBe(500);
  });
});

describe("lineNet", () => {
  it("is gross minus deductions", () => {
    expect(lineNet(50000, [{ label: "Tax", amount: 5000 }, { label: "Loan", amount: 2000 }])).toBe(43000);
  });
  it("equals gross when there are no deductions", () => {
    expect(lineNet(50000, [])).toBe(50000);
  });
  it("can go below zero when deductions exceed gross (e.g. loan recovery)", () => {
    expect(lineNet(10000, [{ label: "Advance", amount: 12000 }])).toBe(-2000);
  });
});

describe("grossFor", () => {
  it("returns the flat rate for monthly", () => {
    expect(grossFor("monthly", 120000)).toBe(120000);
  });
  it("multiplies by days worked for daily", () => {
    expect(grossFor("daily", 5000, { days: 22 })).toBe(110000);
  });
  it("multiplies by hours for hourly", () => {
    expect(grossFor("hourly", 1500, { hours: 40 })).toBe(60000);
  });
  it("treats missing effort as zero for daily/hourly", () => {
    expect(grossFor("daily", 5000)).toBe(0);
    expect(grossFor("hourly", 1500)).toBe(0);
  });
});

describe("summarisePayroll", () => {
  it("totals gross, deductions and net across lines", () => {
    const lines = [
      { gross_pay: 100000, deductions: [{ label: "Tax", amount: 7500 }] },
      { gross_pay: 50000, deductions: [{ label: "Pension", amount: 4000 }, { label: "Loan", amount: 1000 }] },
      { gross_pay: 30000, deductions: [] },
    ];
    expect(summarisePayroll(lines)).toEqual({ grossTotal: 180000, deductionTotal: 12500, netTotal: 167500 });
  });
  it("is all zeroes for an empty run", () => {
    expect(summarisePayroll([])).toEqual({ grossTotal: 0, deductionTotal: 0, netTotal: 0 });
  });
});

describe("friendlyPayrollError", () => {
  it("maps the already-posted guard", () => {
    expect(friendlyPayrollError("ALREADY_POSTED", "x")).toMatch(/already been posted/i);
  });
  it("maps the empty-run guard", () => {
    expect(friendlyPayrollError("NO_LINES", "x")).toMatch(/at least one employee/i);
  });
  it("maps permission errors", () => {
    expect(friendlyPayrollError("new row violates row-level security policy", "x")).toMatch(/permission/i);
  });
  it("falls back to the message", () => {
    expect(friendlyPayrollError("boom", "fallback")).toBe("boom");
  });
});
