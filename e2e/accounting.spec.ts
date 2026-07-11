import { test, expect, type Page } from "@playwright/test";
import { authenticate, stubRows } from "./support/auth";

const account = (id: string, code: string, name: string, type: string) => ({
  id, business_id: "biz-1", code, name, type, is_system: true, active: true, created_at: "2026-07-01T00:00:00Z",
});
const ACCOUNTS = [
  account("a-cash", "1000", "Cash", "asset"),
  account("a-inv", "1200", "Inventory", "asset"),
  account("a-vat", "2100", "VAT Payable", "liability"),
  account("a-obe", "3900", "Opening Balance Equity", "equity"),
  account("a-sales", "4000", "Sales", "income"),
  account("a-cogs", "5000", "Cost of Goods Sold", "expense"),
  account("a-opex", "6000", "Operating Expenses", "expense"),
];
// Worked example: opening cash 200k + inventory 150k (Cr OBE 350k), a 107,500 sale (net 100k, VAT 7.5k,
// COGS 60k), and rent 30k paid. Every tab derives from these journal lines.
const line = (account_id: string, debit: number, credit: number, source: string, description = "") =>
  ({ account_id, debit, credit, description, journal_entries: { entry_date: "2026-07-05", source } });
const LEDGER_LINES = [
  line("a-cash", 200000, 0, "opening"), line("a-inv", 150000, 0, "opening"), line("a-obe", 0, 350000, "opening"),
  line("a-cash", 107500, 0, "sale"), line("a-sales", 0, 100000, "sale"), line("a-vat", 0, 7500, "sale"),
  line("a-cogs", 60000, 0, "sale"), line("a-inv", 0, 60000, "sale"),
  line("a-opex", 30000, 0, "expense", "Rent"), line("a-cash", 0, 30000, "expense"),
];

async function seedLedger(page: Page) {
  await page.route("**/rest/v1/rpc/ensure_chart_of_accounts**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "null" }));
  await stubRows(page, "accounts", ACCOUNTS);
  await stubRows(page, "journal_lines", LEDGER_LINES);
}

test.describe("Accounting", () => {
  test("Profit & Loss derives from the ledger (revenue, COGS, gross, net)", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await expect(page.getByRole("link", { name: "Accounting" })).toBeVisible();
    await seedLedger(page);
    await page.goto("/accounting");

    await expect(page.getByRole("heading", { name: "Accounting" })).toBeVisible();
    const table = page.locator("table");
    await expect(table.getByText("Revenue (net of VAT)")).toBeVisible();
    await expect(table.getByText(/100,?000/).first()).toBeVisible();
    await expect(table.getByText("Cost of goods sold")).toBeVisible();
    await expect(table.getByText(/60,?000/).first()).toBeVisible();
    await expect(table.getByText("Gross profit")).toBeVisible();
    await expect(table.getByText("Rent")).toBeVisible();          // expense breakdown from ledger line description
    await expect(page.getByRole("row", { name: /Net profit/ }).getByText(/10,?000/).first()).toBeVisible();
    await expect(table.getByText("40% margin")).toBeVisible();
    await expect(page.getByText("How this Profit & Loss is calculated")).toBeVisible();
  });

  test("Cash Flow tab groups ledger cash movements", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await seedLedger(page);
    await page.goto("/accounting");
    await page.getByRole("button", { name: "Cash Flow", exact: true }).click();
    await expect(page.locator("table").getByText("Sales receipts")).toBeVisible();
    await expect(page.locator("table").getByText("Expenses paid")).toBeVisible();
    await expect(page.locator("table").getByText("Net cash movement")).toBeVisible();
    await expect(page.locator("table").getByText(/277,?500/).first()).toBeVisible(); // 200k open + 107.5k sale − 30k
  });

  test("Balance Sheet derives from the ledger and ties", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await seedLedger(page);
    await page.goto("/accounting");
    await page.getByRole("button", { name: "Balance Sheet", exact: true }).click();
    const table = page.locator("table");
    await expect(table.getByText("Total assets")).toBeVisible();
    await expect(table.getByText(/367,?500/).first()).toBeVisible(); // cash 277.5k + inventory 90k
    await expect(table.getByText("Current-period earnings")).toBeVisible();
    await expect(table.getByText("Total equity")).toBeVisible();
    await expect(page.getByText("Balanced — Assets = Liabilities + Equity")).toBeVisible();
  });

  test("Trial Balance tab lists account balances that tie out", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await seedLedger(page);
    await page.goto("/accounting");
    await page.getByRole("button", { name: "Trial Balance", exact: true }).click();
    const table = page.locator("table");
    await expect(table.getByText("Cash", { exact: true })).toBeVisible();
    await expect(page.getByText("Balanced — debits = credits")).toBeVisible();
  });

  test("Journal tab posts a balanced manual entry via the RPC", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await page.route("**/rest/v1/rpc/ensure_chart_of_accounts**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "null" }));
    await stubRows(page, "accounts", ACCOUNTS);
    await stubRows(page, "journal_entries", []);
    let rpcBody: any = null;
    await page.route("**/rest/v1/rpc/post_journal**", (r) => { rpcBody = r.request().postDataJSON(); return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify("je-1") }); });
    await page.goto("/accounting");
    await page.getByRole("button", { name: "Journal", exact: true }).click();
    await page.getByRole("button", { name: /New journal entry/ }).first().click();
    const dialog = page.getByRole("dialog");

    await dialog.getByRole("combobox").filter({ hasText: "Select account" }).first().click();
    await page.getByRole("option", { name: "1000 · Cash" }).click();
    await dialog.getByLabel("Debit").first().fill("5000");
    await dialog.getByRole("combobox").filter({ hasText: "Select account" }).first().click();
    await page.getByRole("option", { name: "4000 · Sales" }).click();
    await dialog.getByLabel("Credit").nth(1).fill("5000");
    await expect(dialog.getByText("Balanced")).toBeVisible();
    await dialog.getByRole("button", { name: "Post entry" }).click();

    await expect(page.getByText("Journal entry posted")).toBeVisible();
    expect(rpcBody._lines).toHaveLength(2);
    expect(rpcBody._lines.find((l: any) => l.account_id === "a-cash")).toMatchObject({ debit: 5000, credit: 0 });
    expect(rpcBody._lines.find((l: any) => l.account_id === "a-sales")).toMatchObject({ debit: 0, credit: 5000 });
  });

  test("cashier cannot access accounting", async ({ page }) => {
    await authenticate(page, { role: "cashier" });
    await expect(page.getByRole("link", { name: "Accounting" })).toHaveCount(0);
    await page.goto("/accounting");
    await expect(page.getByRole("heading", { name: "No access" })).toBeVisible();
  });
});
