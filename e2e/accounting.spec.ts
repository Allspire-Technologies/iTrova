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

  test("cashier cannot access accounting", async ({ page }) => {
    await authenticate(page, { role: "cashier" });
    await expect(page.getByRole("link", { name: "Accounting" })).toHaveCount(0);
    await page.goto("/accounting");
    await expect(page.getByRole("heading", { name: "No access" })).toBeVisible();
  });
});
