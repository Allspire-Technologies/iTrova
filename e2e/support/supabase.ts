import type { Page } from "@playwright/test";

// A syntactically valid (unsigned) JWT — enough for supabase-js to store a session.
export const FAKE_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
  "eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwMDEiLCJyb2xlIjoiYXV0aGVudGljYXRlZCIsImV4cCI6OTk5OTk5OTk5OX0." +
  "c2lnbmF0dXJl";

export const FAKE_USER = {
  id: "00000000-0000-0000-0000-000000000001",
  aud: "authenticated",
  role: "authenticated",
  email: "owner@biz.test",
  email_confirmed_at: "2026-06-22T00:00:00.000Z",
  phone: "",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  identities: [],
  created_at: "2026-06-22T00:00:00.000Z",
  updated_at: "2026-06-22T00:00:00.000Z",
};

export const SESSION_BODY = {
  access_token: FAKE_JWT,
  token_type: "bearer",
  expires_in: 3600,
  expires_at: 9_999_999_999,
  refresh_token: "fake-refresh-token",
  user: FAKE_USER,
};

type Stub = { status: number; body: unknown };
const json = (s: Stub) => ({ status: s.status, contentType: "application/json", body: JSON.stringify(s.body) });

/** Make all post-auth DB reads return empty so the app renders without a real backend. */
export async function stubDbReads(page: Page) {
  await page.route("**/rest/v1/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
}

export async function stubSignup(page: Page, stub: Stub) {
  await page.route("**/auth/v1/signup**", (route) => route.fulfill(json(stub)));
}

export async function stubPasswordLogin(page: Page, stub: Stub) {
  await page.route("**/auth/v1/token**", (route) => route.fulfill(json(stub)));
}
