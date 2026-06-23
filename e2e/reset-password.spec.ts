import { test, expect } from "@playwright/test";
import { authenticate } from "./support/auth";
import { stubDbReads } from "./support/supabase";

test.describe("Reset password", () => {
  test("shows the verifying state without a recovery session", async ({ page }) => {
    await stubDbReads(page);
    await page.goto("/reset-password");
    await expect(page.getByRole("heading", { name: "Set a new password" })).toBeVisible();
    await expect(page.getByText("Verifying your reset link")).toBeVisible();
    await expect(page.getByLabel("New password")).toHaveCount(0);
  });

  test("shows the new-password form when a session is present", async ({ page }) => {
    await authenticate(page);
    await page.goto("/reset-password");
    await expect(page.getByRole("heading", { name: "Set a new password" })).toBeVisible();
    await expect(page.getByLabel("New password")).toBeVisible();
    await expect(page.getByLabel("Confirm password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Update password" })).toBeVisible();
  });
});
