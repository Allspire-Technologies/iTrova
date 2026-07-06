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

test.describe("Point of Sale", () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page, { role: "cashier" });
    await stubRows(page, "products", [product]);
    await page.goto("/pos");
  });

  test("shows the product grid and an empty cart", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Point of Sale" })).toBeVisible();
    await expect(page.getByText("Garri 50kg")).toBeVisible();
    await expect(page.getByText("Cart is empty")).toBeVisible();
  });

  test("adds a product to the cart", async ({ page }) => {
    await page.getByRole("button", { name: /Garri 50kg/ }).click();
    await expect(page.getByText("Cart is empty")).toBeHidden();
    await expect(page.getByText("1 item", { exact: true }).filter({ visible: true })).toBeVisible();
  });

  test("shows an Added badge on the product card, clearing on hold/clear and returning on resume", async ({ page }) => {
    const second = { ...product, id: "prod-2", name: "Beans 25kg", sku: "BEA-25" };
    await stubRows(page, "products", [product, second]);
    await page.reload();

    // Once in the cart, the qty/remove buttons also match /Garri 50kg/ — pin to the grid card via its price line.
    const garriCard = page.getByRole("button", { name: /Garri 50kg/ }).filter({ hasText: /8,?500/ });
    await garriCard.click();
    await expect(garriCard.getByText("Added", { exact: false })).toBeVisible();
    await garriCard.click();
    await expect(garriCard.getByText("Added ×2")).toBeVisible();

    // Clear all (needs 2 distinct lines) → badges disappear.
    await page.getByRole("button", { name: /Beans 25kg/ }).click();
    await page.getByRole("button", { name: "Clear all" }).first().click();
    await page.getByRole("button", { name: "Clear all", exact: true }).last().click(); // confirm dialog
    await expect(garriCard.getByText("Added", { exact: false })).toHaveCount(0);

    // Hold → badge gone; resume → badge back (cart-derived).
    await garriCard.click();
    await page.getByRole("button", { name: "Hold sale", exact: true }).click();
    await expect(garriCard.getByText("Added", { exact: false })).toHaveCount(0);
    await page.getByRole("button", { name: /Held sales \(1\)/ }).click();
    await page.getByRole("button", { name: "Resume" }).click();
    await expect(garriCard.getByText("Added", { exact: false })).toBeVisible();
  });

  test("holds a sale and resumes it from the held-sales modal", async ({ page }) => {
    await page.getByRole("button", { name: /Garri 50kg/ }).click();
    await expect(page.getByText("1 item", { exact: true }).filter({ visible: true })).toBeVisible();

    await page.getByRole("button", { name: "Hold sale", exact: true }).click();
    await expect(page.getByText("Cart is empty")).toBeVisible();

    await page.getByRole("button", { name: /Held sales \(1\)/ }).click();
    await page.getByRole("button", { name: "Resume" }).click();

    await expect(page.getByText("Cart is empty")).toBeHidden();
    await expect(page.getByText("1 item", { exact: true }).filter({ visible: true })).toBeVisible();
  });

  test("search matches SKU, case-insensitively", async ({ page }) => {
    const search = page.getByPlaceholder("Search products...");
    // "gar-50" is the lowercase SKU (GAR-50) and is NOT a substring of the name, so a match proves
    // the list search now looks at SKU (and isn't case-sensitive).
    await search.fill("gar-50");
    await expect(page.getByRole("button", { name: /Garri 50kg/ })).toBeVisible();
    await search.fill("zzz-none");
    await expect(page.getByRole("button", { name: /Garri 50kg/ })).toBeHidden();
  });

  test("scan by SKU adds the product to the cart (case-insensitive)", async ({ page }) => {
    const scan = page.getByPlaceholder("Scan or type SKU + Enter");
    await scan.fill("gar-50"); // lowercase of GAR-50
    await scan.press("Enter");
    await expect(page.getByText("1 item", { exact: true }).filter({ visible: true })).toBeVisible();
  });

  test("online checkout is a single atomic RPC call (no table-by-table writes)", async ({ page }) => {
    const rpcPayloads: any[] = [];
    const tableWrites: string[] = [];
    await page.route("**/rest/v1/rpc/commit_pos_sale**", (r) => {
      rpcPayloads.push(r.request().postDataJSON());
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "committed", sale_id: "s-1", invoice_number: "INV-0042" }) });
    });
    // Record any write the old 6-round-trip path would have made.
    for (const table of ["sales", "sale_items", "invoices", "invoice_items"]) {
      await page.route(`**/rest/v1/${table}**`, (r) => {
        if (!["GET", "HEAD"].includes(r.request().method())) tableWrites.push(`${r.request().method()} ${table}`);
        return r.fallback();
      });
    }

    await page.getByRole("button", { name: /Garri 50kg/ }).click();
    await page.getByRole("button", { name: "Complete sale" }).click();

    await expect(page.getByText("Sale Complete")).toBeVisible();
    expect(rpcPayloads).toHaveLength(1);
    const sale = rpcPayloads[0]._sale;
    expect(sale.items).toEqual([{ product_id: "prod-1", name: "Garri 50kg", quantity: 1, unit_price: 8500 }]);
    expect(sale.total).toBe(8500);
    expect(sale.invoice_number).toBeUndefined(); // sequential number is assigned server-side
    expect(tableWrites).toEqual([]);

    await page.keyboard.press("Escape"); // close the receipt
    await expect(page.getByText("Cart is empty")).toBeVisible();
  });

  test("oversell rejection from the RPC surfaces the friendly stock toast", async ({ page }) => {
    await page.route("**/rest/v1/rpc/commit_pos_sale**", (r) =>
      r.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: "23514", message: "NEEDS_REVIEW:Garri 50kg", details: null, hint: null }) }));

    await page.getByRole("button", { name: /Garri 50kg/ }).click();
    await page.getByRole("button", { name: "Complete sale" }).click();

    await expect(page.getByText(/Not enough stock for Garri 50kg/)).toBeVisible();
  });

  test.describe("on a mobile viewport", () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test("lays out the title/tabs/held row without horizontal overflow", async ({ page }) => {
      await page.getByRole("button", { name: /Garri 50kg/ }).click();
      // On mobile the cart lives in a bottom sheet — open it from the sticky bar to hold the sale.
      await page.getByRole("button", { name: /Review/ }).click();
      await page.getByRole("button", { name: "Hold sale", exact: true }).click();
      await expect(page.getByRole("button", { name: /Held sales \(1\)/ })).toBeVisible();
      await page.getByRole("button", { name: /Garri 50kg/ }).click();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    });
  });
});
