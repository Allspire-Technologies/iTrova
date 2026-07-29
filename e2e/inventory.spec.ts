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

  test("shows cost total, profit and markup, with a click-to-open profit explainer", async ({ page }) => {
    // 8,500 sell − 6,000 cost = 2,500 × 20 in stock → cost total 120,000, profit 50,000, markup 41.7%.
    const row = page.locator("table tbody tr").first();
    await expect(page.getByRole("columnheader", { name: "Sale price" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Cost total" })).toBeVisible();
    await expect(row.getByText(/120[,]?000/)).toBeVisible();
    await expect(row.getByText(/50[,]?000/)).toBeVisible();
    await expect(row.getByText("41.7%")).toBeVisible();

    await page.getByRole("button", { name: "How profit is calculated" }).first().click();
    await expect(page.getByText("markup on cost", { exact: false })).toBeVisible();
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

  test("adjust stock: reasons follow the direction, and Other needs a required Specify field", async ({ page }) => {
    let body: Record<string, unknown> | null = null;
    await page.route("**/rest/v1/stock_adjustments**", (r) => {
      if (r.request().method() === "POST") { body = r.request().postDataJSON(); return r.fulfill({ status: 201, contentType: "application/json", body: "[]" }); }
      return r.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });

    await page.locator("table").getByRole("button", { name: "Adjust" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Remove (default) shows product-remove reasons; the add-only reason is absent.
    await dialog.getByRole("combobox").click();
    await expect(page.getByRole("option", { name: "Internal use / samples" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Customer return" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    // Switch to Add → the reason list changes (Customer return appears, remove-only reason gone).
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await dialog.getByRole("combobox").click();
    await expect(page.getByRole("option", { name: "Customer return" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Internal use / samples" })).toHaveCount(0);
    await page.getByRole("option", { name: "Other" }).click();

    // Other reveals a required Specify field — Save stays disabled until it's filled.
    await dialog.locator('input[type="number"]').fill("5");
    await expect(dialog.getByText("Specify reason")).toBeVisible();
    const save = dialog.getByRole("button", { name: "Save adjustment" });
    await expect(save).toBeDisabled();
    await dialog.getByPlaceholder("Type the reason for this adjustment").fill("Given to staff");
    await expect(save).toBeEnabled();
    await save.click();

    await expect(page.getByText(/Stock adjusted/)).toBeVisible();
    expect(body).not.toBeNull();
    expect(body!.reason).toBe("Given to staff"); // the typed text is stored as the reason, not "Other"
    expect(body!.delta).toBe(5);
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

test.describe("Inventory — delete & archive", () => {
  test("owner deletes a product; a used one is archived (via delete_product RPC)", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await stubRows(page, "products", [product]);
    // delete_product returns 'archived' for a product with history.
    await page.route("**/rest/v1/rpc/delete_product**", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify("archived") }));
    await page.goto("/inventory");
    const row = page.locator("table tbody tr").first();
    await row.getByRole("button", { name: "Delete" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/Delete Garri 50kg\?/)).toBeVisible();
    await dialog.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText(/Garri 50kg archived/i)).toBeVisible();
  });

  test("archived products appear under 'Show archived' and can be restored", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await stubRows(page, "products", [product, { ...product, id: "prod-2", name: "Old Rice", archived_at: "2026-07-01T00:00:00Z" }]);
    await page.route("**/rest/v1/rpc/restore_product**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "null" }));
    await page.goto("/inventory");
    // Active view hides the archived product.
    await expect(page.locator("table").getByText("Old Rice")).toHaveCount(0);
    await page.getByRole("button", { name: /Show archived/ }).click();
    await expect(page.locator("table").getByText("Old Rice")).toBeVisible();
    await page.locator("table tbody tr").first().getByRole("button", { name: "Restore" }).click();
    await expect(page.getByText(/restored/i)).toBeVisible();
  });

  test("a manager (no inventory-delete permission) sees no Delete action", async ({ page }) => {
    await authenticate(page, { role: "manager" });
    await stubRows(page, "products", [product]);
    await page.goto("/inventory");
    const row = page.locator("table tbody tr").first();
    await expect(row.getByRole("button", { name: "Edit" })).toBeVisible(); // manager can still edit
    await expect(row.getByRole("button", { name: "Delete" })).toHaveCount(0);
  });
});
