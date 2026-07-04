import { test, expect, type Page, type Route } from "@playwright/test";
import { authenticate } from "./support/auth";

// A manual invoice (no sale_id) owing 10,000. The stubs below mutate this in place so the
// page sees the balance shrink across reloads, exactly as the real RPC would persist it.
function makeInvoice() {
  return {
    id: "inv-1", business_id: "biz-1", invoice_number: "260629-1",
    customer_name: "Mrs. Bola", customer_phone: null, customer_email: null,
    status: "issued", subtotal: 10000, tax: 0, total: 10000, discount_amount: 0,
    amount_paid: 0, issue_date: "2026-06-29", due_date: null, notes: null,
    sale_id: null, created_by: null,
  };
}

function fulfill(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}
function singleOrArray(route: Route, rows: unknown[]) {
  const accept = route.request().headers()["accept"] || "";
  return fulfill(route, accept.includes("vnd.pgrst.object") ? (rows[0] ?? null) : rows);
}

// Wire the invoice / payments / RPC routes around a shared mutable state object.
async function setupInvoice(page: Page) {
  const state = { invoice: makeInvoice(), payments: [] as Record<string, unknown>[] };

  await page.route("**/rest/v1/invoices**", (r) => singleOrArray(r, [state.invoice]));
  await page.route("**/rest/v1/invoice_items**", (r) => fulfill(r, []));
  await page.route("**/rest/v1/invoice_payments**", (r) => fulfill(r, state.payments));

  await page.route("**/rest/v1/rpc/record_invoice_payment**", (r) => {
    const b = r.request().postDataJSON() as { _payment_id: string; _amount: number; _method: string };
    state.payments.push({ id: b._payment_id, amount: b._amount, method: b._method, note: null, created_at: "2026-06-29", created_by: null });
    state.invoice.amount_paid += Number(b._amount);
    state.invoice.status = state.invoice.amount_paid >= state.invoice.total ? "paid" : "partial";
    return fulfill(r, { status: "committed", amount_paid: state.invoice.amount_paid, invoice_status: state.invoice.status });
  });

  await page.route("**/rest/v1/rpc/delete_invoice_payment**", (r) => {
    const b = r.request().postDataJSON() as { _payment_id: string };
    state.payments = state.payments.filter((p) => p.id !== b._payment_id);
    state.invoice.amount_paid = state.payments.reduce((s, p) => s + Number(p.amount), 0);
    state.invoice.status = state.invoice.amount_paid >= state.invoice.total ? "paid" : state.invoice.amount_paid > 0 ? "partial" : "issued";
    return fulfill(r, { status: "deleted", amount_paid: state.invoice.amount_paid, invoice_status: state.invoice.status });
  });

  await page.route("**/rest/v1/rpc/log_invoice_edit**", (r) => fulfill(r, null));
  return state;
}

test.describe("Invoice deposits", () => {
  test("takes a deposit (partial), then completes it to paid", async ({ page }) => {
    await authenticate(page);
    await setupInvoice(page);
    await page.goto("/invoices");
    // Scope row text to the desktop table — the responsive layout also renders a (hidden) mobile card.
    await expect(page.locator("table").getByText("260629-1")).toBeVisible();

    // First deposit of 4,000 -> partial, 6,000 left.
    await page.getByRole("button", { name: "Payment", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("spinbutton").fill("4000");
    await dialog.getByRole("button", { name: "Record payment" }).click();
    await expect(page.locator("table").getByText(/6,000.*left/)).toBeVisible();

    // Pay the remaining balance -> auto-flips to paid (Print action appears, no balance left).
    await page.getByRole("button", { name: "Payment", exact: true }).click();
    await dialog.getByRole("button", { name: "Record payment" }).click();
    await expect(page.getByText(/left/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Print" })).toBeVisible();

    // Paid invoices are closed: the payment history shows but can't be removed.
    await page.getByRole("button", { name: "View" }).click();
    await expect(page.getByText("Payments")).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove payment" })).toHaveCount(0);
  });

  test("rejects a deposit larger than the balance", async ({ page }) => {
    await authenticate(page);
    await setupInvoice(page);
    await page.goto("/invoices");

    await page.getByRole("button", { name: "Payment", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("spinbutton").fill("15000"); // > 10,000 balance
    await dialog.getByRole("button", { name: "Record payment" }).click();
    await expect(page.getByText(/exceeds the balance/i)).toBeVisible();
    await expect(dialog).toBeVisible(); // dialog stays open, nothing recorded
  });
});
