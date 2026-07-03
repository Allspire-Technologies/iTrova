import { test, expect } from "@playwright/test";
import { authenticate, stubRows } from "./support/auth";

test.describe("Export Invoice", () => {
  test("owner: the list has a New button that opens the form", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await expect(page.getByRole("link", { name: "Export Invoice" })).toBeVisible();
    await page.goto("/export-invoice");
    await expect(page.getByRole("heading", { name: "Export Invoices" })).toBeVisible();
    await page.getByRole("button", { name: "New export invoice" }).first().click();
    await expect(page).toHaveURL(/\/export-invoice\/new$/);
    await expect(page.getByRole("heading", { name: "New Export Invoice" })).toBeVisible();
  });

  test("form prefills the seller and computes line, grand and carton totals", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await page.goto("/export-invoice/new");
    await expect(page.getByPlaceholder("Exporter company name")).toHaveValue("Sunrise Stores");

    // A custom line (no product) still computes: 10 boxes x 168,000 = 1,680,000.
    await page.getByLabel("Description 1").fill("Mixed Spices");
    await page.getByLabel("Units per box 1").fill("48");
    await page.getByLabel("Boxes 1").fill("10");
    await page.getByLabel("Unit price 1").fill("168000");
    await expect(page.getByLabel("Line total 1")).toHaveValue("NGN 1,680,000.00");
    await expect(page.getByText(/Total cartons/)).toContainText("10");
    await expect(page.getByText("NGN 1,680,000.00")).toBeVisible();
  });

  test("selecting a product fills its inventory price; a manager can't change it", async ({ page }) => {
    await authenticate(page, { role: "manager" });
    await stubRows(page, "products", [{ id: "p1", name: "Mixed Spices", stock_quantity: 500, unit: "pcs", selling_price: 168000 }]);
    await page.goto("/export-invoice/new");
    await page.getByLabel("Product 1").selectOption({ label: "Mixed Spices" });
    await expect(page.getByLabel("Unit price 1")).toHaveValue("168000");
    await expect(page.getByLabel("Unit price 1")).toBeDisabled();
  });

  test("a cashier cannot reach the module", async ({ page }) => {
    await authenticate(page, { role: "cashier" });
    await expect(page.getByRole("link", { name: "Export Invoice" })).toHaveCount(0);
  });
});
