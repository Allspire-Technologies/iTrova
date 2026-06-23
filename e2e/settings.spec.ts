import { test, expect } from "@playwright/test";
import { authenticate } from "./support/auth";

test.describe("Settings", () => {
  test("owner sees business profile and subscription", async ({ page }) => {
    await authenticate(page, { role: "owner", businessName: "Sunrise Stores" });
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByText("Business name", { exact: true })).toBeVisible();
    await expect(page.getByText("Subscription Plan", { exact: true })).toBeVisible();
  });
});
