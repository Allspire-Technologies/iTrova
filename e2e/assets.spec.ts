import { test, expect } from "@playwright/test";
import { authenticate, stubRows } from "./support/auth";

const YEAR = new Date().getFullYear();
const ASSET = {
  id: "fa1", business_id: "biz-1", name: "Delivery Van", category: "Vehicles", cost: 500000,
  year_purchased: YEAR - 2, depreciation_rate: 0.2, active: true, created_at: "2026-07-01T00:00:00Z",
};

test.describe("Assets", () => {
  test("owner adds an asset and sees its current value", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await expect(page.getByRole("link", { name: "Assets" })).toBeVisible();
    await stubRows(page, "fixed_assets", []);
    let posted: any = null;
    await page.route("**/rest/v1/fixed_assets**", (r) => {
      if (r.request().method() === "POST") { posted = r.request().postDataJSON(); return r.fulfill({ status: 201, contentType: "application/json", body: "[]" }); }
      return r.fallback();
    });
    await page.goto("/assets");
    await expect(page.getByRole("heading", { name: "Assets", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Add asset" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByPlaceholder("e.g. Generator").fill("Generator");
    await dialog.getByPlaceholder("0", { exact: true }).fill("500000"); // cost; year defaults to this year, rate to 20%
    // Bought this year → 0 years depreciated → current value equals cost.
    await expect(dialog.getByText(/Current value:/)).toBeVisible();
    await expect(dialog.getByText(/500,?000/)).toBeVisible();

    await dialog.getByRole("button", { name: "Add asset" }).click();
    await expect(page.getByText("Asset added")).toBeVisible();
    expect(posted).toMatchObject({ name: "Generator", cost: 500000, depreciation_rate: 0.2, year_purchased: YEAR, business_id: "biz-1" });
  });

  test("lists an asset at net book value and runs depreciation via the RPC", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await stubRows(page, "fixed_assets", [ASSET]);
    let rpcCalled = false;
    await page.route("**/rest/v1/rpc/run_depreciation**", (r) => { rpcCalled = true; return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ posted: 1 }) }); });
    await page.goto("/assets");

    // 500,000 at 20%/yr, 2 years → depreciated 200,000 → current value 300,000.
    await expect(page.locator("table").getByText("Delivery Van")).toBeVisible();
    await expect(page.locator("table").getByText(/300,?000/)).toBeVisible();

    await page.getByRole("button", { name: /Run depreciation/ }).click();
    await expect(page.getByText(/Depreciation posted for 1 asset/)).toBeVisible();
    expect(rpcCalled).toBe(true);
  });

  test("cashier cannot access assets", async ({ page }) => {
    await authenticate(page, { role: "cashier" });
    await expect(page.getByRole("link", { name: "Assets" })).toHaveCount(0);
    await page.goto("/assets");
    await expect(page.getByRole("heading", { name: "No access" })).toBeVisible();
  });
});
