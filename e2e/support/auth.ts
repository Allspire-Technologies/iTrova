import type { Page, Route } from "@playwright/test";
import { FAKE_USER, SESSION_BODY } from "./supabase";

const BUSINESS_ID = "biz-1";

export type AuthOptions = { role?: "owner" | "manager" | "cashier"; ownerName?: string; businessName?: string };

function fulfillJson(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

// PostgREST returns a single object for .single()/.maybeSingle() (object Accept header),
// otherwise an array. Honour that so both query styles get a valid shape.
function singleOrArray(route: Route, row: unknown) {
  const accept = route.request().headers()["accept"] || "";
  return fulfillJson(route, accept.includes("vnd.pgrst.object") ? row : [row]);
}

/** Log in as a stubbed user and load a profile/business/role, ending on the dashboard. */
export async function authenticate(page: Page, opts: AuthOptions = {}) {
  const role = opts.role ?? "owner";
  const profile = {
    id: FAKE_USER.id,
    owner_name: opts.ownerName ?? "Ada Obi",
    business_id: BUSINESS_ID,
    onboarded: true,
    phone: null,
    notification_prefs: null,
    last_seen: null,
    created_at: "2026-06-01T00:00:00Z",
  };
  const business = {
    id: BUSINESS_ID,
    name: opts.businessName ?? "Sunrise Stores",
    owner_id: FAKE_USER.id,
    currency: "NGN",
    timezone: "Africa/Lagos",
    subscription_tier: "free",
    whatsapp_number: null,
    created_at: "2026-06-01T00:00:00Z",
  };

  await page.route("**/auth/v1/token**", (r) => fulfillJson(r, SESSION_BODY));
  await page.route("**/auth/v1/user**", (r) => fulfillJson(r, FAKE_USER));
  await page.route("**/auth/v1/health**", (r) => fulfillJson(r, {})); // connectivity probe -> online
  await page.route("**/rest/v1/**", (r) => fulfillJson(r, []));
  await page.route("**/rest/v1/profiles**", (r) => singleOrArray(r, profile));
  await page.route("**/rest/v1/businesses**", (r) => singleOrArray(r, business));
  await page.route("**/rest/v1/user_roles**", (r) => fulfillJson(r, [{ user_id: FAKE_USER.id, role }]));

  await page.goto("/auth");
  await page.locator("#le").fill("owner@biz.test");
  await page.locator("#lp").fill("password123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("/");
}

/** Stub a table's rows (handles both single-object and array query shapes). */
export async function stubRows(page: Page, table: string, rows: Record<string, unknown>[]) {
  await page.route(`**/rest/v1/${table}**`, (r) => {
    const accept = r.request().headers()["accept"] || "";
    return fulfillJson(r, accept.includes("vnd.pgrst.object") ? (rows[0] ?? null) : rows);
  });
}
