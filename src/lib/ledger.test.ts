import { describe, it, expect, vi } from "vitest";
// ledger.ts imports the supabase client at load; stub it so the pure helpers need no env.
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));
import { normalBalanceFor, validateEntryLines, buildTrialBalance, friendlyLedgerError, type Account, type AccountType } from "./ledger";

const acc = (id: string, code: string, type: AccountType): Account => ({
  id, business_id: "biz-1", code, name: code, type, is_system: true, active: true, created_at: "2026-07-01T00:00:00Z",
});

describe("normalBalanceFor", () => {
  it("assets and expenses are debit-normal", () => {
    expect(normalBalanceFor("asset")).toBe("debit");
    expect(normalBalanceFor("expense")).toBe("debit");
  });
  it("liabilities, equity and income are credit-normal", () => {
    expect(normalBalanceFor("liability")).toBe("credit");
    expect(normalBalanceFor("equity")).toBe("credit");
    expect(normalBalanceFor("income")).toBe("credit");
  });
});

describe("validateEntryLines", () => {
  it("accepts a balanced entry", () => {
    expect(validateEntryLines([{ debit: 1000, credit: 0 }, { debit: 0, credit: 1000 }])).toEqual({ ok: true });
  });
  it("rejects when debits ≠ credits", () => {
    const r = validateEntryLines([{ debit: 1000, credit: 0 }, { debit: 0, credit: 800 }]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/must equal/i);
  });
  it("rejects an empty entry", () => {
    expect(validateEntryLines([{ debit: 0, credit: 0 }]).ok).toBe(false);
  });
  it("rejects a line that is both a debit and a credit", () => {
    expect(validateEntryLines([{ debit: 500, credit: 500 }]).ok).toBe(false);
  });
  it("rejects negatives", () => {
    expect(validateEntryLines([{ debit: -100, credit: 0 }]).ok).toBe(false);
  });
});

describe("buildTrialBalance", () => {
  const accounts = [acc("cash", "1000", "asset"), acc("sales", "4000", "income"), acc("vat", "2100", "liability"), acc("unused", "9999", "expense")];
  it("nets each account to one side, drops zero accounts, and totals both columns", () => {
    // A 107,500 sale: Dr Cash 107,500 / Cr Sales 100,000 / Cr VAT 7,500
    const tb = buildTrialBalance(accounts, [
      { account_id: "cash", debit: 107500, credit: 0 },
      { account_id: "sales", debit: 0, credit: 100000 },
      { account_id: "vat", debit: 0, credit: 7500 },
    ]);
    expect(tb.rows).toHaveLength(3); // unused account dropped
    expect(tb.rows.find(r => r.account.id === "cash")).toMatchObject({ debit: 107500, credit: 0 });
    expect(tb.rows.find(r => r.account.id === "sales")).toMatchObject({ debit: 0, credit: 100000 });
    expect(tb.totalDebit).toBe(107500);
    expect(tb.totalCredit).toBe(107500);
    expect(tb.balanced).toBe(true);
  });
  it("nets debits and credits within one account", () => {
    const tb = buildTrialBalance([acc("cash", "1000", "asset")], [
      { account_id: "cash", debit: 5000, credit: 0 },
      { account_id: "cash", debit: 0, credit: 2000 },
    ]);
    expect(tb.rows[0]).toMatchObject({ debit: 3000, credit: 0 });
  });
  it("is balanced even when only opening equity is posted", () => {
    const tb = buildTrialBalance([acc("cash", "1000", "asset"), acc("obe", "3900", "equity")], [
      { account_id: "cash", debit: 50000, credit: 0 },
      { account_id: "obe", debit: 0, credit: 50000 },
    ]);
    expect(tb.balanced).toBe(true);
  });
});

describe("friendlyLedgerError", () => {
  it("maps the unbalanced guard", () => {
    expect(friendlyLedgerError("UNBALANCED: debits 100 <> credits 90", "x")).toMatch(/equal/i);
  });
  it("maps permission errors", () => {
    expect(friendlyLedgerError("new row violates row-level security policy", "x")).toMatch(/permission/i);
  });
});
