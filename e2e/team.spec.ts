import { test, expect } from "@playwright/test";
import { authenticate } from "./support/auth";

test.describe("Team", () => {
  test("owner can manage the team", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await page.goto("/team");
    await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Invite teammate/ })).toBeVisible();
  });

  test("non-owners are blocked", async ({ page }) => {
    await authenticate(page, { role: "cashier" });
    await page.goto("/team");
    await expect(page.getByRole("heading", { name: "No access" })).toBeVisible();
  });
});
