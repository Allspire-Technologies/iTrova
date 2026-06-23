import { test, expect } from "@playwright/test";
import { authenticate, stubRows } from "./support/auth";

const supplier = {
  id: "sup-1",
  business_id: "biz-1",
  name: "Olu Farms Ltd",
  contact_name: "Olu",
  phone: "+2348000000000",
  email: "olu@farms.test",
  address: "Lagos",
  notes: null,
  rating: 4,
  created_at: "2026-06-01T00:00:00Z",
};

test.describe("Suppliers", () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await stubRows(page, "suppliers", [supplier]);
    await page.goto("/suppliers");
  });

  test("lists suppliers", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Suppliers" })).toBeVisible();
    await expect(page.getByText("Olu Farms Ltd")).toBeVisible();
  });

  test("opens the add-supplier dialog", async ({ page }) => {
    await page.getByRole("button", { name: "Add supplier" }).first().click();
    await expect(page.getByText("Business name")).toBeVisible();
  });
});
