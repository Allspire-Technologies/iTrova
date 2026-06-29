import { test, expect } from "@playwright/test";
import { FAKE_USER, SESSION_BODY, stubDbReads, stubSignup, stubPasswordLogin } from "./support/supabase";

// The Auth page disables its buttons when offline; make the connectivity probe succeed so the
// suite runs "online".
test.beforeEach(async ({ page }) => {
  await page.route("**/auth/v1/health**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
});

test.describe("Auth — login", () => {
  test("shows the login form by default", async ({ page }) => {
    await page.goto("/auth");
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await expect(page.locator("#le")).toBeVisible();
    await expect(page.locator("#lp")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });

  test("toggles password visibility", async ({ page }) => {
    await page.goto("/auth");
    await page.locator("#lp").fill("secret123");
    await expect(page.locator("#lp")).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "Show password" }).click();
    await expect(page.locator("#lp")).toHaveAttribute("type", "text");
  });

  test("shows an error toast on invalid credentials", async ({ page }) => {
    await stubPasswordLogin(page, {
      status: 400,
      body: { error: "invalid_grant", error_description: "Invalid login credentials" },
    });
    await page.goto("/auth");
    await page.locator("#le").fill("owner@biz.test");
    await page.locator("#lp").fill("wrongpass");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Invalid login credentials")).toBeVisible();
    await expect(page).toHaveURL(/\/auth$/);
  });

  test("redirects to the dashboard on successful login", async ({ page }) => {
    await stubDbReads(page);
    await stubPasswordLogin(page, { status: 200, body: SESSION_BODY });
    await page.goto("/auth");
    await page.locator("#le").fill("owner@biz.test");
    await page.locator("#lp").fill("correct-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL("/");
    // We left the auth screen and landed in the authenticated app shell.
    await expect(page.getByRole("link", { name: "Point of Sale" }).first()).toBeVisible();
  });
});

test.describe("Auth — signup", () => {
  test("switches to the create-account tab", async ({ page }) => {
    await page.goto("/auth");
    await page.getByRole("tab", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "Start in minutes" })).toBeVisible();
    await expect(page.locator("#bn")).toBeVisible();
  });

  test("blocks mismatched passwords (client-side)", async ({ page }) => {
    await page.goto("/auth");
    await page.getByRole("tab", { name: "Create account" }).click();
    await page.locator("#bn").fill("Sunrise Stores");
    await page.locator("#on").fill("Ada Obi");
    await page.locator("#se").fill("ada@sunrise.test");
    await page.locator("#sp").fill("password1");
    await page.locator("#cp").fill("password2");
    await page.getByRole("button", { name: "Create my business" }).click();
    await expect(page.getByText("Passwords do not match")).toBeVisible();
  });

  test("shows 'check your inbox' when confirmation is required", async ({ page }) => {
    await stubSignup(page, { status: 200, body: { ...FAKE_USER, confirmation_sent_at: "2026-06-22T00:00:00Z" } });
    await page.goto("/auth");
    await page.getByRole("tab", { name: "Create account" }).click();
    await page.locator("#bn").fill("Sunrise Stores");
    await page.locator("#on").fill("Ada Obi");
    await page.locator("#se").fill("ada@sunrise.test");
    await page.locator("#sp").fill("password123");
    await page.locator("#cp").fill("password123");
    await page.getByRole("button", { name: "Create my business" }).click();
    await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
  });

  test("shows an error toast when the email is already registered", async ({ page }) => {
    await stubSignup(page, { status: 400, body: { message: "User already registered" } });
    await page.goto("/auth");
    await page.getByRole("tab", { name: "Create account" }).click();
    await page.locator("#bn").fill("Sunrise Stores");
    await page.locator("#on").fill("Ada Obi");
    await page.locator("#se").fill("ada@sunrise.test");
    await page.locator("#sp").fill("password123");
    await page.locator("#cp").fill("password123");
    await page.getByRole("button", { name: "Create my business" }).click();
    await expect(page.getByText("User already registered")).toBeVisible();
  });
});
