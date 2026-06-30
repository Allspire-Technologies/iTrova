import { test, expect, type Page, type Route } from "@playwright/test";
import { authenticate, stubRows } from "./support/auth";

// A manual invoice owing 10,000 — eligible for an offline deposit.
const INVOICE = {
  id: "inv-1", business_id: "biz-1", invoice_number: "260629-1",
  customer_name: "Mrs. Bola", customer_phone: null, customer_email: null,
  status: "issued", subtotal: 10000, tax: 0, total: 10000, discount_amount: 0,
  amount_paid: 0, issue_date: "2026-06-29", due_date: null, notes: null,
  sale_id: null, created_by: null,
};

// Force the connectivity probe to fail so the app treats the device as offline.
async function goOffline(page: Page) {
  await page.route("**/auth/v1/health**", (r) => r.abort());
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
}

// Restore connectivity and route the offline-commit RPCs (invoice + deposit).
async function goOnline(page: Page, commit: (route: Route) => unknown) {
  await page.route("**/auth/v1/health**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await page.route("**/rest/v1/rpc/commit_offline_invoice**", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "committed", invoice_number: "off-1" }) }));
  await page.route("**/rest/v1/rpc/record_invoice_payment**", commit);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
}

const committedDeposit = (r: Route) =>
  r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "committed", invoice_status: "partial", amount_paid: 4000 }) });

test.describe("Offline deposits", () => {
  test("captures a deposit offline and syncs it when back online", async ({ page }) => {
    await authenticate(page);
    await stubRows(page, "invoices", [INVOICE]);
    await page.goto("/invoices"); // online — caches the eligible invoice for offline
    // Scope to the desktop table — the responsive layout also renders a (hidden) mobile card.
    await expect(page.locator("table").getByText("260629-1")).toBeVisible();

    await goOffline(page);
    await page.goto("/invoices"); // offline — OfflineInvoices, with the cached invoice
    await expect(page.getByRole("heading", { name: /Invoices \(offline\)/ })).toBeVisible();
    await expect(page.getByText("Awaiting payment")).toBeVisible();
    await expect(page.getByText("260629-1")).toBeVisible();

    // Record a 4,000 deposit on-device.
    await page.getByRole("button", { name: "Record payment for 260629-1" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("spinbutton").fill("4000");
    await dialog.getByRole("button", { name: "Save deposit" }).click();
    await expect(page.getByText(/1 deposit saved on this device/)).toBeVisible();

    // Back online: the Invoices banner offers to sync; the RPC commits it and the banner clears.
    await goOnline(page, (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "committed", invoice_status: "partial", amount_paid: 4000 }) }),
    );
    await page.goto("/invoices");
    await page.getByRole("button", { name: "Sync now (1)" }).click();
    await expect(page.getByText(/waiting to sync/)).toHaveCount(0);
  });

  test("blocks sign-out while an offline deposit is unsynced", async ({ page }) => {
    await authenticate(page);
    await stubRows(page, "invoices", [INVOICE]);
    await page.goto("/invoices");
    // Scope to the desktop table — the responsive layout also renders a (hidden) mobile card.
    await expect(page.locator("table").getByText("260629-1")).toBeVisible();

    await goOffline(page);
    await page.goto("/invoices");
    await page.getByRole("button", { name: "Record payment for 260629-1" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("spinbutton").fill("4000");
    await dialog.getByRole("button", { name: "Save deposit" }).click();
    await expect(page.getByText(/1 deposit saved on this device/)).toBeVisible();

    // The sign-out gate counts the unsynced deposit and blocks leaving.
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByText("Sync before signing out")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sync now" })).toBeDisabled(); // offline — can't upload
  });

  test("creates a manual invoice offline, deposits on it, and syncs both", async ({ page }) => {
    await authenticate(page);
    await stubRows(page, "invoices", []); // nothing pre-cached
    await page.goto("/invoices"); // online once so the session hydrates for offline
    await goOffline(page);
    await page.goto("/invoices");
    await expect(page.getByRole("heading", { name: /Invoices \(offline\)/ })).toBeVisible();

    // Create a manual invoice entirely offline.
    await page.getByRole("button", { name: "New invoice" }).click();
    const create = page.getByRole("dialog");
    await create.getByPlaceholder("Walk-in Customer").fill("Mr. Femi");
    await create.getByPlaceholder("Description").fill("Consulting");
    await create.getByPlaceholder("Unit price").fill("10000");
    await create.getByRole("button", { name: "Save invoice" }).click();
    await expect(page.getByText("Mr. Femi")).toBeVisible();
    await expect(page.getByText(/1 invoice .*waiting to sync/)).toBeVisible();

    // Record a deposit on the offline invoice.
    await page.getByRole("button", { name: /Record payment for/ }).click();
    const pay = page.getByRole("dialog");
    await pay.getByRole("spinbutton").fill("4000");
    await pay.getByRole("button", { name: "Save deposit" }).click();
    await expect(page.getByText(/1 invoice and 1 deposit saved/)).toBeVisible();

    // Back online: sync the invoice and its deposit together; the banner clears.
    await goOnline(page, committedDeposit);
    await page.goto("/invoices");
    await page.getByRole("button", { name: "Sync now (2)" }).click();
    await expect(page.getByText(/waiting to sync/)).toHaveCount(0);
  });
});
