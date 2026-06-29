import { test, expect, type Route } from "@playwright/test";
import { stubDbReads, stubSignup } from "./support/supabase";

const rpc = (route: Route, rows: unknown[]) =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });

test.describe("Invite auth", () => {
  test("renders the signup and login for a valid invite", async ({ page }) => {
    await stubDbReads(page);
    await page.route("**/rest/v1/rpc/get_invite_state**", (r) =>
      rpc(r, [{ status: "valid", business_name: "Sunrise Stores", email: "jane@biz.test", role: "cashier" }]));
    await page.goto("/invite-auth?token=abc123");
    await expect(page.getByRole("heading", { name: "Join the team" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Create account" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Sign in" })).toBeVisible();
  });

  test("flags an already-used invite and points to sign up / reset password", async ({ page }) => {
    await stubDbReads(page);
    await page.route("**/rest/v1/rpc/get_invite_state**", (r) =>
      rpc(r, [{ status: "used", business_name: null, email: null, role: null }]));
    await page.goto("/invite-auth?token=used-token");

    await expect(page.getByRole("heading", { name: "Invitation already used" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reset my password" })).toBeVisible();
    // The join form is not shown for a used invite.
    await expect(page.getByRole("tab", { name: "Create account" })).toHaveCount(0);

    await page.getByRole("button", { name: "Go to sign in / sign up" }).click();
    await page.waitForURL(/\/auth/);
  });

  test("shows an expired notice for an expired invite", async ({ page }) => {
    await stubDbReads(page);
    await page.route("**/rest/v1/rpc/get_invite_state**", (r) =>
      rpc(r, [{ status: "expired", business_name: null, email: null, role: null }]));
    await page.goto("/invite-auth?token=old-token");
    await expect(page.getByRole("heading", { name: "Invitation expired" })).toBeVisible();
  });

  test("create-account guides to confirm email when no session is returned", async ({ page }) => {
    await stubDbReads(page);
    await page.route("**/rest/v1/rpc/get_invite_state**", (r) =>
      rpc(r, [{ status: "valid", business_name: "Sunrise Stores", email: "jane@biz.test", role: "cashier" }]));
    // signUp succeeds but returns no session (email confirmation enabled).
    await stubSignup(page, { status: 200, body: { user: { id: "u1", email: "jane@biz.test" }, session: null } });

    await page.goto("/invite-auth?token=abc123");
    await page.getByLabel("Your name").fill("Jane Doe");
    await page.getByLabel("Password", { exact: true }).fill("password123");
    await page.getByLabel("Confirm password").fill("password123");
    await page.getByRole("button", { name: "Create account & join" }).click();

    await expect(page.getByRole("heading", { name: "Almost there!" })).toBeVisible();
    await expect(page.getByText(/Sunrise Stores/)).toBeVisible();
  });
});
