import { test, expect, type Route } from "@playwright/test";
import { stubDbReads } from "./support/supabase";
import { authenticate } from "./support/auth";

const rpc = (route: Route, rows: unknown[]) =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });

test.describe("Accept invite", () => {
  test("shows an error when no token is provided", async ({ page }) => {
    await stubDbReads(page);
    await page.goto("/accept-invite");
    await expect(page.getByText("Couldn't accept invitation")).toBeVisible();
    await expect(page.getByText("No invitation token provided.")).toBeVisible();
  });

  test("redirects an unauthenticated user to the invite signup", async ({ page }) => {
    await stubDbReads(page);
    await page.route("**/rest/v1/rpc/get_invite_state**", (r) =>
      rpc(r, [{ status: "valid", business_name: "Sunrise Stores", email: "jane@biz.test", role: "cashier" }]));
    await page.goto("/accept-invite?token=abc123");
    await page.waitForURL(/\/invite-auth/);
    await expect(page.getByRole("heading", { name: "Join the team" })).toBeVisible();
  });

  test("lands on a success page after accepting", async ({ page }) => {
    // FAKE_USER.email is owner@biz.test — the invite email must match for the accept to proceed.
    await authenticate(page, {
      onRoutes: async (p) => {
        await p.route("**/rest/v1/rpc/get_invite_state**", (r) =>
          rpc(r, [{ status: "valid", business_name: "Sunrise Stores", email: "owner@biz.test", role: "cashier" }]));
        await p.route("**/rest/v1/rpc/accept_invitation**", (r) =>
          r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify("biz-1") }));
      },
    });
    await page.goto("/accept-invite?token=good-token");

    await expect(page.getByRole("heading", { name: /You're in/ })).toBeVisible();
    await expect(page.getByText(/Sunrise Stores/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Go to your dashboard" })).toBeVisible();
  });

  test("flags an already-used invite on the accept page", async ({ page }) => {
    await authenticate(page, {
      onRoutes: async (p) => {
        await p.route("**/rest/v1/rpc/get_invite_state**", (r) =>
          rpc(r, [{ status: "used", business_name: null, email: null, role: null }]));
      },
    });
    await page.goto("/accept-invite?token=used-token");
    await expect(page.getByRole("heading", { name: "Invitation already used" })).toBeVisible();
  });

  test("blocks accepting on an account already in another business", async ({ page }) => {
    await authenticate(page, {
      onRoutes: async (p) => {
        await p.route("**/rest/v1/rpc/get_invite_state**", (r) =>
          rpc(r, [{ status: "valid", business_name: "Sunrise Stores", email: "owner@biz.test", role: "cashier" }]));
        await p.route("**/rest/v1/rpc/accept_invitation**", (r) =>
          r.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ message: "This account already belongs to another business. Use a different email to accept this invite." }) }));
      },
    });
    await page.goto("/accept-invite?token=other-biz");
    await expect(page.getByRole("heading", { name: "Account already in another business" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Sign out & use a different email/ })).toBeVisible();
  });
});
