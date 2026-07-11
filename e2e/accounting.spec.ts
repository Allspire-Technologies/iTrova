import { test, expect, type Page } from "@playwright/test";
import { authenticate, stubRows } from "./support/auth";

const INVOICE = { id: "inv1", business_id: "biz-1", total: 107500, tax: 7500, status: "paid", issue_date: "2026-07-05" };
const SALE_ITEM = { product_id: "p1", quantity: 10, unit_cost: 6000, sales: { id: "s1" } };
const PRODUCT = { id: "p1", cost_price: 6000 };
const expense = (id: string, category: string, amount: number, tax = 0) => ({
  id, business_id: "biz-1", expense_date: "2026-07-06", category, amount, payment_method: "cash", payee: null,
  supplier_id: null, description: null, status: "paid", due_date: null, paid_date: "2026-07-06", receipt_ref: null,
  tax_amount: tax, created_by: null, created_at: "2026-07-06T00:00:00Z",
});

async function seed(page: Page, opts: { items?: object[]; products?: object[] } = {}) {
  await stubRows(page, "invoices", [INVOICE]);
  await stubRows(page, "sale_items", opts.items ?? [SALE_ITEM]);
  await stubRows(page, "products", opts.products ?? [PRODUCT]);
  await stubRows(page, "expenses", [expense("e1", "Rent", 15000), expense("e2", "Salaries", 20000)]);
}

test.describe("Accounting — Profit & Loss", () => {
  test("owner sees the statement with revenue, COGS, gross and net profit", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await expect(page.getByRole("link", { name: "Accounting" })).toBeVisible();
    await seed(page);
    await page.goto("/accounting");

    await expect(page.getByRole("heading", { name: "Accounting" })).toBeVisible();
    const table = page.locator("table");
    await expect(table.getByText("Revenue (net of VAT)")).toBeVisible();
    await expect(table.getByText(/100,?000/).first()).toBeVisible();        // revenue net of VAT (107,500 − 7,500)
    await expect(table.getByText("Cost of goods sold")).toBeVisible();
    await expect(table.getByText(/60,?000/).first()).toBeVisible();         // 10 × 6,000
    await expect(table.getByText("Gross profit")).toBeVisible();
    await expect(table.getByText(/40,?000/).first()).toBeVisible();         // 100,000 − 60,000
    await expect(table.getByText("Net profit")).toBeVisible();
    await expect(page.getByRole("row", { name: /Net profit/ }).getByText(/5,?000/).first()).toBeVisible(); // 40,000 − 35,000 expenses
    await expect(table.getByText("40% margin")).toBeVisible();

    // Export menu + explainer.
    await page.getByRole("button", { name: "Export" }).click();
    await expect(page.getByRole("menuitem", { name: "Download PDF" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Export CSV" })).toBeVisible();
    await expect(page.getByText("How this Profit & Loss is calculated")).toBeVisible();
  });

  test("warns when sold items have no recorded cost", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    // Item sold with no captured cost, and the product has no cost price → COGS understated.
    await seed(page, { items: [{ product_id: "p1", quantity: 8, unit_cost: null, sales: { id: "s1" } }], products: [{ id: "p1", cost_price: 0 }] });
    await page.goto("/accounting");
    await expect(page.getByText(/Cost of goods sold may be understated/)).toBeVisible();
    await expect(page.getByText(/8 sold units/)).toBeVisible();
  });

  test("Cash Flow tab shows money in vs out and net movement", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await stubRows(page, "sales", [{ total_amount: 500000 }]);
    await stubRows(page, "invoice_payments", [{ amount: 20000 }]);
    await stubRows(page, "expenses", [{ category: "Rent", amount: 15000, status: "paid", paid_date: "2026-07-06" }]);
    await stubRows(page, "material_purchases", [{ total_cost: 80000 }]);
    await page.goto("/accounting");
    await page.getByRole("button", { name: "Cash Flow", exact: true }).click();
    await expect(page.locator("table").getByText("Cash in", { exact: true })).toBeVisible();
    await expect(page.locator("table").getByText("Cash out", { exact: true })).toBeVisible();
    await expect(page.locator("table").getByText("Net cash movement")).toBeVisible();
    await expect(page.locator("table").getByText(/520,?000/).first()).toBeVisible(); // total cash in 500k + 20k
  });

  test("Balance Sheet tab shows the statement + opening-balances setup", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await stubRows(page, "products", [{ id: "p1", stock_quantity: 20, cost_price: 6000 }]); // inventory 120,000
    await page.goto("/accounting");
    await page.getByRole("button", { name: "Balance Sheet", exact: true }).click();
    await expect(page.getByText("Opening balances", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Set opening balances" })).toBeVisible();
    await expect(page.getByText("Total assets")).toBeVisible();
    await expect(page.getByText(/120,?000/).first()).toBeVisible(); // inventory at cost
    await expect(page.getByText("Total equity")).toBeVisible();
  });

  const ACCOUNTS = [
    { id: "a-cash", business_id: "biz-1", code: "1000", name: "Cash", type: "asset", is_system: true, active: true, created_at: "2026-07-01T00:00:00Z" },
    { id: "a-sales", business_id: "biz-1", code: "4000", name: "Sales", type: "income", is_system: true, active: true, created_at: "2026-07-01T00:00:00Z" },
    { id: "a-vat", business_id: "biz-1", code: "2100", name: "VAT Payable", type: "liability", is_system: true, active: true, created_at: "2026-07-01T00:00:00Z" },
  ];

  test("Trial Balance tab lists account balances that tie out", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await page.route("**/rest/v1/rpc/ensure_chart_of_accounts**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "null" }));
    await stubRows(page, "accounts", ACCOUNTS);
    await stubRows(page, "journal_lines", [
      { account_id: "a-cash", debit: 107500, credit: 0 },
      { account_id: "a-sales", debit: 0, credit: 100000 },
      { account_id: "a-vat", debit: 0, credit: 7500 },
    ]);
    await page.goto("/accounting");
    await page.getByRole("button", { name: "Trial Balance", exact: true }).click();

    const table = page.locator("table");
    await expect(table.getByText("Cash", { exact: true })).toBeVisible();
    await expect(table.getByText(/107,?500/).first()).toBeVisible();
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
