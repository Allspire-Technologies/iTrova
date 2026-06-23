import { test, expect } from "@playwright/test";
import { stubDbReads } from "./support/supabase";

test.describe("Invite auth", () => {
  test("renders the signup and login for an invited teammate", async ({ page }) => {
    await stubDbReads(page);
    await page.goto("/invite-auth?token=abc123");
    await expect(page.getByRole("heading", { name: "Join the team" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Create account" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Sign in" })).toBeVisible();
  });
});
