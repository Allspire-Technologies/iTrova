import { test, expect } from "@playwright/test";
import { authenticate } from "./support/auth";

test.describe("Purchase Orders", () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await page.goto("/purchase-orders");
  });

  test("renders the page with an empty state", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Purchase Orders" })).toBeVisible();
    await expect(page.getByText("No purchase orders yet.")).toBeVisible();
  });

  test("disables the CSV template and import buttons", async ({ page }) => {
    await expect(page.getByRole("button", { name: /CSV Template/ })).toBeDisabled();
    await expect(page.getByRole("button", { name: /Import CSV/ })).toBeDisabled();
  });
});
