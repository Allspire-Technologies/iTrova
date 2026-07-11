import { describe, it, expect, vi } from "vitest";
// ledger.ts imports the supabase client at load; stub it so the pure helpers need no env.
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));
import { normalBalanceFor, validateEntryLines, buildTrialBalance, friendlyLedgerError, ledgerPnl, ledgerBalanceSheet, ledgerCashFlow, type Account, type AccountType } from "./ledger";

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

// A worked example used across the statement tests: a business with opening cash 200k + inventory 150k
// (Cr Opening Balance Equity 350k), one sale of 107,500 (net 100k, VAT 7.5k, COGS 60k), and rent 30k paid.
const stmtAccounts = [
  acc("cash", "1000", "asset"), acc("inv", "1200", "asset"),
  acc("vat", "2100", "liability"), acc("obe", "3900", "equity"),
  acc("sales", "4000", "income"), acc("cogs", "5000", "expense"), acc("opex", "6000", "expense"),
];
const stmtLines = [
  // opening
  { account_id: "cash", debit: 200000, credit: 0 }, { account_id: "inv", debit: 150000, credit: 0 }, { account_id: "obe", debit: 0, credit: 350000, source: "opening" },
  // sale 107,500
  { account_id: "cash", debit: 107500, credit: 0, source: "sale" }, { account_id: "sales", debit: 0, credit: 100000, source: "sale" },
  { account_id: "vat", debit: 0, credit: 7500, source: "sale" }, { account_id: "cogs", debit: 60000, credit: 0, source: "sale" }, { account_id: "inv", debit: 0, credit: 60000, source: "sale" },
  // rent 30,000 paid
  { account_id: "opex", debit: 30000, credit: 0, description: "Rent", source: "expense" }, { account_id: "cash", debit: 0, credit: 30000, source: "expense" },
];

describe("ledgerPnl", () => {
  it("derives revenue, COGS, gross/net profit and an expense breakdown", () => {
    const p = ledgerPnl(stmtAccounts, stmtLines);
    expect(p.revenue).toBe(100000);
    expect(p.cogs).toBe(60000);
    expect(p.grossProfit).toBe(40000);
    expect(p.expenses).toEqual([{ category: "Rent", amount: 30000 }]);
    expect(p.netProfit).toBe(10000);
    expect(p.netMargin).toBe(10);
  });
});

describe("ledgerBalanceSheet", () => {
  it("ties by construction (assets = liabilities + equity incl. current earnings)", () => {
    const bs = ledgerBalanceSheet(stmtAccounts, stmtLines);
    // Cash 277,500 + Inventory 90,000 = 367,500 assets
    expect(bs.totalAssets).toBe(367500);
    // VAT payable 7,500
    expect(bs.totalLiabilities).toBe(7500);
    // OBE 350,000 + current earnings 10,000 = 360,000
    expect(bs.currentEarnings).toBe(10000);
    expect(bs.totalEquity).toBe(360000);
    expect(bs.balanced).toBe(true);
    expect(bs.totalAssets).toBe(bs.totalLiabilities + bs.totalEquity);
  });
});

describe("ledgerCashFlow", () => {
  it("groups cash-account movements by source and nets them", () => {
    const cf = ledgerCashFlow(stmtAccounts, stmtLines);
    expect(cf.inflows).toEqual(expect.arrayContaining([{ label: "Sales receipts", amount: 107500 }]));
    expect(cf.outflows).toEqual(expect.arrayContaining([{ label: "Expenses paid", amount: 30000 }]));
    // opening cash inflow 200,000 + sale 107,500 − expense 30,000 = 277,500
    expect(cf.net).toBe(277500);
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
