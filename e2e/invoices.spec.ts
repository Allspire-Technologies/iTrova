import { test, expect } from "@playwright/test";
import { authenticate } from "./support/auth";

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
});
