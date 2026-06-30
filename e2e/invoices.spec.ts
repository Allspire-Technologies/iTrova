import { test, expect } from "@playwright/test";
import { authenticate, stubRows } from "./support/auth";

const paidInvoice = {
  id: "inv-1",
  business_id: "biz-1",
  invoice_number: "INV-001",
  customer_name: "Ada",
  customer_phone: null,
  customer_email: null,
  status: "paid",
  subtotal: 25000,
  tax: 0,
  discount_amount: 0,
  total: 25000,
  issue_date: "2026-06-23",
  due_date: null,
  notes: null,
  sale_id: "sale-1",
  created_by: null,
  created_at: "2026-06-23T00:00:00Z",
};

test.describe("Invoices", () => {
  test("owner sees the list with create and export actions", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await page.goto("/invoices");
    await expect(page.getByRole("heading", { name: "Invoices" })).toBeVisible();
    await expect(page.getByRole("button", { name: "New invoice" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Export CSV" })).toBeVisible();
  });

  test("cashier can create but cannot export CSV", async ({ page }) => {
    await authenticate(page, { role: "cashier" });
    await page.goto("/invoices");
    await expect(page.getByRole("heading", { name: "Invoices" })).toBeVisible();
    await expect(page.getByRole("button", { name: "New invoice" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Export CSV" })).toHaveCount(0);
  });

  test("any user can print a paid invoice receipt", async ({ page }) => {
    await authenticate(page, { role: "cashier" });
    await stubRows(page, "invoices", [paidInvoice]);
    await page.goto("/invoices");
    // Scope to the desktop table — the responsive layout also renders a (hidden) mobile card.
    await expect(page.locator("table").getByText("INV-001")).toBeVisible();
    await expect(page.getByRole("button", { name: "Print", exact: true })).toBeVisible();
  });

  test("download and delete live in the actions menu", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await stubRows(page, "invoices", [paidInvoice]);
    await page.goto("/invoices");
    await page.getByRole("button", { name: "More actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Download", exact: true })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Delete" })).toBeVisible();
  });
});
