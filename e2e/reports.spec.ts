import { test, expect } from "@playwright/test";
import { authenticate } from "./support/auth";

test.describe("Reports", () => {
  test("renders metrics and the revenue trend", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await page.goto("/reports");
    await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
    await expect(page.getByText("Gross profit")).toBeVisible();
    await expect(page.getByText("Revenue trend")).toBeVisible();
  });

  test("a cashier gets an own-sales report — no business financials", async ({ page }) => {
    await authenticate(page, { role: "cashier" });
    await page.goto("/reports");
    await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
    await expect(page.getByText("My sales", { exact: true })).toBeVisible();
    await expect(page.getByText("My sales trend")).toBeVisible();
    // Business-wide money metrics and stock sections are hidden without view_financials/inventory.
    await expect(page.getByText("Gross profit")).toHaveCount(0);
    await expect(page.getByText("Revenue trend")).toHaveCount(0);
    await expect(page.getByText("Sales by staff")).toHaveCount(0);
    await expect(page.getByText("Inventory turnover")).toHaveCount(0);
    // Cashiers can download what they can see — their export is the scoped "My sales" report.
    await expect(page.getByRole("button", { name: "Export PDF" })).toBeVisible();
  });

  test("a manager still sees the full report including production activity", async ({ page }) => {
    await authenticate(page, { role: "manager" });
    await page.goto("/reports");
    await expect(page.getByText("Gross profit")).toBeVisible();
    await expect(page.getByText("Revenue trend")).toBeVisible();
    await expect(page.getByText("Production runs", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Export PDF" })).toBeVisible();
  });
});
