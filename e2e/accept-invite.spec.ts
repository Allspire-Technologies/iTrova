import { test, expect } from "@playwright/test";
import { stubDbReads } from "./support/supabase";

test.describe("Accept invite", () => {
  test("shows an error when no token is provided", async ({ page }) => {
    await stubDbReads(page);
    await page.goto("/accept-invite");
    await expect(page.getByText("Couldn't accept invitation")).toBeVisible();
    await expect(page.getByText("No invitation token provided.")).toBeVisible();
  });

  test("redirects an unauthenticated user to the invite signup", async ({ page }) => {
    await stubDbReads(page);
    await page.goto("/accept-invite?token=abc123");
    await page.waitForURL(/\/invite-auth/);
    await expect(page.getByRole("heading", { name: "Join the team" })).toBeVisible();
  });
});
