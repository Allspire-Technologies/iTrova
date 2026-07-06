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

  test("CSV import adds, updates by name, and summarises rejects with a re-download", async ({ page }) => {
    const csv = [
      "Name,Phone,Rating",
      "New Vendor,0801,5",   // new supplier -> insert
      "olu farms ltd,0802,", // matches the existing supplier (case-insensitive) -> update
      "Bad One,,9",          // rating out of range -> rejected with a reason
    ].join("\n");
    await page.locator('input[type="file"]').setInputFiles({ name: "suppliers.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });

    await expect(page.getByRole("heading", { name: "Import results" })).toBeVisible();
    await expect(page.getByText(/2 rows imported · 1 added · 1 updated/)).toBeVisible();
    await expect(page.getByText(/1 row not imported/)).toBeVisible();
    await expect(page.getByText(/Invalid Rating — use 1 to 5/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Download not-imported \(1\)/ })).toBeVisible();
  });
});
