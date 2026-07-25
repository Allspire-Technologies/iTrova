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

  test("shows the consent line with links to the public Terms and Privacy docs", async ({ page }) => {
    await page.goto("/auth");
    const terms = page.getByRole("link", { name: "Terms of Service" });
    const privacy = page.getByRole("link", { name: "Privacy Policy" });
    await expect(terms).toBeVisible();
    await expect(privacy).toBeVisible();
    await expect(terms).toHaveAttribute("href", /^https:\/\/allspire\.tech\/terms/);
    await expect(privacy).toHaveAttribute("href", /^https:\/\/allspire\.tech\/privacy/);
    // And it's present on the create-account tab too.
    await page.getByRole("tab", { name: "Create account" }).click();
    await expect(page.getByRole("link", { name: "Terms of Service" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Privacy Policy" })).toBeVisible();
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
    // We left the auth screen and landed in the authenticated app shell. (Dashboard is role-free;
    // module nav items now need a resolved role under RBAC, and this stub returns no role rows.)
    await expect(page.getByRole("link", { name: "Dashboard" }).first()).toBeVisible();
  });

  test("a deleted account (no profile row) is signed out, not stranded in an empty shell", async ({ page }) => {
    // Credentials still authenticate (a stale token), but the profile is gone — the business was
    // deleted in the CRM, which now purges its users. maybeSingle() then returns null.
    await stubPasswordLogin(page, { status: 200, body: SESSION_BODY });
    await page.route("**/auth/v1/logout**", (r) => r.fulfill({ status: 204, contentType: "application/json", body: "" }));
    await page.route("**/rest/v1/profiles**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "null" }));
    await page.route("**/rest/v1/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
    await page.goto("/auth");
    await page.locator("#le").fill("owner@biz.test");
    await page.locator("#lp").fill("correct-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    // Bounced back to the auth screen rather than landing on the empty dashboard.
    await expect(page).toHaveURL(/\/auth$/);
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });
});

test.describe("Auth — signup", () => {
  test("switches to the create-account tab", async ({ page }) => {
    await page.goto("/auth");
    await page.getByRole("tab", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "Start in minutes" })).toBeVisible();
    await expect(page.locator("#bn")).toBeVisible();
  });

  test("collects City/State and, for 'Other' industry, a required industry name", async ({ page }) => {
    await page.goto("/auth");
    await page.getByRole("tab", { name: "Create account" }).click();
    // Location fields are present.
    await expect(page.locator("#city")).toBeVisible();
    await expect(page.locator("#state")).toBeVisible();
    // The industry-name field only appears once "Other" is chosen.
    await expect(page.locator("#io")).toHaveCount(0);
    await page.getByText("Select your industry").click();
    await page.getByRole("option", { name: "Other" }).click();
    await expect(page.locator("#io")).toBeVisible();
    // Submitting "Other" with no industry name is blocked client-side.
    await page.locator("#bn").fill("Sunrise Stores");
    await page.locator("#on").fill("Ada Obi");
    await page.locator("#se").fill("ada@sunrise.test");
    await page.locator("#sp").fill("password123");
    await page.locator("#cp").fill("password123");
    await page.getByRole("button", { name: "Create my business" }).click();
    await expect(page.getByText("Tell us your industry")).toBeVisible();
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

  test("referral code: typed freely, sent in the signup metadata", async ({ page }) => {
    let payload = "";
    await page.route("**/auth/v1/signup**", (route) => {
      payload = route.request().postData() ?? "";
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...FAKE_USER, confirmation_sent_at: "2026-07-18T00:00:00Z" }) });
    });
    await page.goto("/auth");
    await page.getByRole("tab", { name: "Create account" }).click();
    // Field is optional and editable without ?ref=; input upper-cases as you type.
    const ref = page.locator("#refcode");
    await expect(ref).toBeVisible();
    await expect(ref).not.toHaveAttribute("readonly", "");
    await ref.fill("adaobi0305");
    await expect(ref).toHaveValue("ADAOBI0305");
    await page.locator("#bn").fill("Sunrise Stores");
    await page.locator("#on").fill("Ada Obi");
    await page.locator("#se").fill("ada@sunrise.test");
    await page.locator("#sp").fill("password123");
    await page.locator("#cp").fill("password123");
    await page.getByRole("button", { name: "Create my business" }).click();
    await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
    expect(payload).toContain('"referral_code":"ADAOBI0305"');

    // Completing signup returns the user to Sign in with the create-account form cleared.
    await page.getByRole("button", { name: "Back to sign in" }).click();
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await page.getByRole("tab", { name: "Create account" }).click();
    await expect(page.locator("#bn")).toHaveValue("");
    await expect(page.locator("#refcode")).toHaveValue("");
  });

  test("referral code from a ?ref= share link is pre-filled and locked", async ({ page }) => {
    await page.goto("/auth?ref=mamaput7811");
    // The share link must land on Create account directly (not Sign in) — no tab click needed.
    await expect(page.getByRole("heading", { name: "Start in minutes" })).toBeVisible();
    const ref = page.locator("#refcode");
    await expect(ref).toHaveValue("MAMAPUT7811");
    await expect(ref).toHaveAttribute("readonly", "");
    await expect(page.getByText(/Referral applied/)).toBeVisible();
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

  test("blocks an invalid email (client-side)", async ({ page }) => {
    await page.goto("/auth");
    await page.getByRole("tab", { name: "Create account" }).click();
    await page.locator("#bn").fill("Sunrise Stores");
    await page.locator("#on").fill("Ada Obi");
    await page.locator("#se").fill("ada@sunrise"); // passes type=email but has no TLD
    await page.locator("#sp").fill("password123");
    await page.locator("#cp").fill("password123");
    await page.getByRole("button", { name: "Create my business" }).click();
    await expect(page.getByText("Enter a valid email address")).toBeVisible();
  });

  test("phone field accepts only digits (and +)", async ({ page }) => {
    await page.goto("/auth");
    await page.getByRole("tab", { name: "Create account" }).click();
    await page.locator("#ph").fill("ab 080-123c");
    await expect(page.locator("#ph")).toHaveValue("080123");
  });

  test("blocks an invalid phone number (client-side)", async ({ page }) => {
    await page.goto("/auth");
    await page.getByRole("tab", { name: "Create account" }).click();
    await page.locator("#bn").fill("Sunrise Stores");
    await page.locator("#on").fill("Ada Obi");
    await page.locator("#se").fill("ada@sunrise.test");
    await page.locator("#ph").fill("123"); // too short
    await page.locator("#sp").fill("password123");
    await page.locator("#cp").fill("password123");
    await page.getByRole("button", { name: "Create my business" }).click();
    await expect(page.getByText(/Enter a valid phone number/)).toBeVisible();
  });
});
