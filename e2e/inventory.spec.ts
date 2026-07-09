import { test, expect } from "@playwright/test";
import { authenticate, stubRows } from "./support/auth";

const product = {
  id: "prod-1",
  business_id: "biz-1",
  name: "Garri 50kg",
  category: "Foodstuff",
  sku: "GAR-50",
  unit: "bag",
  selling_price: 8500,
  cost_price: 6000,
  stock_quantity: 20,
  reorder_level: 5,
  created_at: "2026-06-01T00:00:00Z",
};

test.describe("Inventory", () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await stubRows(page, "products", [product]);
    await page.goto("/inventory");
  });

  test("lists products", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Inventory" })).toBeVisible();
    // Scope to the desktop table — the responsive layout also renders a (hidden) mobile card.
    await expect(page.locator("table").getByText("Garri 50kg")).toBeVisible();
    await expect(page.locator("table").getByText("GAR-50")).toBeVisible();
  });

  test("opens the add-product dialog with required fields asterisked and an optional expiry date", async ({ page }) => {
    await page.getByRole("button", { name: "Add product" }).click();
    await expect(page.getByText("Add a new product")).toBeVisible();
    await expect(page.getByText("Product name *")).toBeVisible();
    await expect(page.getByText("SKU / barcode *")).toBeVisible();
    await expect(page.getByText("Stock quantity *")).toBeVisible();
    await expect(page.getByText("Reorder level *")).toBeVisible();
    await expect(page.getByText("Expiry date")).toBeVisible();
  });

  test("adds a product with tax off — sends tax_id null, not an empty string (uuid guard)", async ({ page }) => {
    let body: Record<string, unknown> | null = null;
    await page.route("**/rest/v1/products**", (r) => {
      if (r.request().method() === "POST") {
        body = r.request().postDataJSON();
        return r.fulfill({ status: 201, contentType: "application/json", body: "[]" });
      }
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([product]) });
    });
    await page.getByRole("button", { name: "Add product" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByPlaceholder("Garri (50kg)").fill("Rice 25kg");
    await dialog.getByPlaceholder("GAR-50").fill("RICE-25");
    const nums = dialog.locator('input[type="number"]');
    await nums.nth(0).fill("8000"); // selling
    await nums.nth(1).fill("6000"); // cost
    await nums.nth(2).fill("10");   // stock
    await nums.nth(3).fill("3");    // reorder
    await dialog.getByRole("button", { name: "Add product" }).click();
    await expect(page.getByText("Product added")).toBeVisible();
    expect(body).not.toBeNull();
    expect(body!.tax_id).toBeNull(); // must be null, never "" (invalid uuid)
  });

  test("shows expiry in its own column and badges a product expiring within 90 days", async ({ page }) => {
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    await stubRows(page, "products", [{ ...product, expiry_date: soon }]);
    await page.reload();
    await expect(page.locator("table").getByText("Garri 50kg")).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Expiry" })).toBeVisible();
    await expect(page.locator("table").getByText(/Expires in \d+d/)).toBeVisible();
  });

  test("CSV import summarises what imported vs missed and offers a re-download", async ({ page }) => {
    const csv = [
      "Name,SKU,Cost Price,Selling Price,Stock Quantity,Reorder Level",
      'New Rice,NR-1,"6,000","8,500",20,5', // valid — commas stripped, friendly headers
      "Bad Beans,BB-1,,1200,10,5",           // invalid — missing cost price
    ].join("\n");
    await page.locator('input[type="file"]').setInputFiles({ name: "products.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });

    await expect(page.getByRole("heading", { name: "Import results" })).toBeVisible();
    await expect(page.getByText(/1 row imported/)).toBeVisible();
    await expect(page.getByText(/1 row not imported/)).toBeVisible();
    await expect(page.getByText(/Missing Cost Price/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Download not-imported \(1\)/ })).toBeVisible();
  });

  test("flags duplicate SKUs within the file as failed", async ({ page }) => {
    const csv = [
      "Name,SKU,Cost Price,Selling Price,Stock Quantity,Reorder Level",
      "First,DUP-1,1,2,3,4",
      "Second,dup-1,1,2,3,4", // same SKU (case-insensitive) -> both flagged
      "Unique,UNQ-1,1,2,3,4",
    ].join("\n");
    await page.locator('input[type="file"]').setInputFiles({ name: "products.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });

    await expect(page.getByRole("heading", { name: "Import results" })).toBeVisible();
    await expect(page.getByText(/1 row imported/)).toBeVisible();
    await expect(page.getByText(/2 rows not imported/)).toBeVisible();
    await expect(page.getByText(/Duplicate SKU/i)).toBeVisible();
  });

  test("shows a progress bar while the import is writing rows", async ({ page }) => {
    // Hold the insert open so the progress dialog is observable, then let it complete.
    await page.route("**/rest/v1/products**", async (route) => {
      if (route.request().method() === "POST") {
        await new Promise((r) => setTimeout(r, 800));
        return route.fulfill({ status: 201, contentType: "application/json", body: "[]" });
      }
      return route.fallback();
    });
    const csv = ["Name,SKU,Cost Price,Selling Price,Stock Quantity,Reorder Level", "A,A-1,1,2,3,4", "B,B-1,1,2,3,4", "C,C-1,1,2,3,4"].join("\n");
    await page.locator('input[type="file"]').setInputFiles({ name: "products.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });

    await expect(page.getByRole("heading", { name: "Importing products…" })).toBeVisible();
    await expect(page.getByRole("progressbar")).toBeVisible();
    // …then it finishes and hands off to the results summary.
    await expect(page.getByText(/3 rows imported/)).toBeVisible();
  });
});
