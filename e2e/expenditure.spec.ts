import { test, expect, type Page } from "@playwright/test";
import { authenticate, stubRows } from "./support/auth";

const PAID = {
  id: "ex1", business_id: "biz-1", expense_date: "2026-07-05", category: "Rent", amount: 150000,
  payment_method: "transfer", payee: "Landlord", supplier_id: null, description: "July shop rent",
  status: "paid", due_date: null, paid_date: "2026-07-05", receipt_ref: null, created_by: "user-1", created_at: "2026-07-05T00:00:00Z",
};
const OVERDUE = {
  id: "ex2", business_id: "biz-1", expense_date: "2026-07-01", category: "Utilities", amount: 22000,
  payment_method: "cash", payee: "PowerCo", supplier_id: null, description: null,
  status: "pending", due_date: "2020-01-01", paid_date: null, receipt_ref: null, created_by: "user-1", created_at: "2026-07-01T00:00:00Z",
};

async function seed(page: Page, rows: object[] = [PAID, OVERDUE]) {
  await stubRows(page, "expenses", rows);
  await stubRows(page, "suppliers", []);
}

test.describe("Expenditure", () => {
  test("owner sees the module and its expenses, with a bills-due strip", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await expect(page.getByRole("link", { name: "Expenditure" })).toBeVisible();
    await seed(page);
    await page.goto("/expenditure");
    await expect(page.getByRole("heading", { name: "Expenditure" })).toBeVisible();
    await expect(page.getByRole("table").getByText("Rent")).toBeVisible();
    await expect(page.getByRole("table").getByText("Overdue")).toBeVisible(); // pending + past due
    await expect(page.getByText("Bills to pay", { exact: true })).toBeVisible();
  });

  test("add expense posts the expected payload", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await seed(page, []);
    let posted: any = null;
    await page.route("**/rest/v1/expenses**", (r) => {
      if (r.request().method() === "POST") {
        posted = r.request().postDataJSON();
        return r.fulfill({ status: 201, contentType: "application/json", body: "[]" });
      }
      return r.fallback();
    });
    await page.goto("/expenditure");
    await page.getByRole("button", { name: "Add expense" }).first().click(); // header (empty state also has one)
    const dialog = page.getByRole("dialog");
    await dialog.getByPlaceholder("0").fill("45000");        // Amount
    await dialog.getByPlaceholder("Rent").fill("Transport"); // Category
    await dialog.getByPlaceholder("Who you paid").fill("Musa");
    await dialog.getByRole("button", { name: "Add expense" }).click();
    await expect(page.getByText("Expense added")).toBeVisible();
    const row = Array.isArray(posted) ? posted[0] : posted;
    expect(row).toMatchObject({ category: "Transport", amount: 45000, status: "paid", payee: "Musa", business_id: "biz-1" });
  });

  test("mark a pending bill as paid sends status=paid", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await seed(page, [OVERDUE]);
    let patched: any = null;
    await page.route("**/rest/v1/expenses**", (r) => {
      if (r.request().method() === "PATCH") {
        patched = r.request().postDataJSON();
        return r.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      }
      return r.fallback();
    });
    await page.goto("/expenditure");
    await page.getByRole("button", { name: /More actions for Utilities/ }).first().click();
    await page.getByRole("menuitem", { name: "Mark as paid" }).click();
    await expect(page.getByText("Marked as paid")).toBeVisible();
    expect(patched).toMatchObject({ status: "paid", due_date: null });
  });

  test("export menu offers CSV and PDF", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await seed(page);
    await page.goto("/expenditure");
    await page.getByRole("button", { name: "Export" }).click();
    await expect(page.getByRole("menuitem", { name: "Export CSV" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Download PDF" })).toBeVisible();
  });

  test("cashier has no nav link and hits No access on the direct URL", async ({ page }) => {
    await authenticate(page, { role: "cashier" });
    await expect(page.getByRole("link", { name: "Expenditure" })).toHaveCount(0);
    await page.goto("/expenditure");
    await expect(page.getByRole("heading", { name: "No access" })).toBeVisible();
  });
});
