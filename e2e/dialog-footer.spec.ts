import { test, expect, type Page } from "@playwright/test";
import { authenticate, stubRows } from "./support/auth";

// Regression guard for dialog footers clipping content.
//
// A sticky footer inside the scrolling dialog (with a negative bottom margin) shrank the
// container's scrollHeight, so the last line of content stayed permanently hidden behind the
// action row — e.g. the "Payment: Cash … · Transfer …" line on a paid invoice was cut in half.
// The invariant below holds regardless of HOW the footer is implemented: after scrolling a
// dialog to the very bottom, no content may sit underneath the footer.

const paidInvoice = {
  id: "inv-1", business_id: "biz-1", invoice_number: "260718-1", customer_name: "Walk-in Customer",
  customer_phone: null, customer_email: null, status: "paid", subtotal: 586046.51, tax: 43953.49,
  discount_amount: 20000, total: 630000, amount_paid: 630000, issue_date: "2026-07-18",
  due_date: null, notes: null, sale_id: "sale-1", created_by: null,
};

/** The bottom of the last content must clear the top of the footer once fully scrolled. */
async function expectNothingHiddenBehindFooter(page: Page, footerButton: string) {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // Scroll every scrollable element in the dialog to the bottom.
  await dialog.evaluate((d) => {
    for (const el of [d, ...Array.from(d.querySelectorAll("*"))] as HTMLElement[]) {
      if (el.scrollHeight > el.clientHeight) el.scrollTop = el.scrollHeight;
    }
  });
  await page.waitForTimeout(250);

  const overlap = await dialog.evaluate((d, btnName: string) => {
    const btn = Array.from(d.querySelectorAll("button")).find((b) => (b.textContent ?? "").trim().includes(btnName));
    if (!btn) return { error: `footer button "${btnName}" not found` } as const;
    // The footer row is the button's ancestor that sits directly inside the dialog.
    let footer: HTMLElement = btn;
    while (footer.parentElement && footer.parentElement !== d) footer = footer.parentElement;
    const f = btn.getBoundingClientRect();
    const footerTop = Math.min(f.top, footer.getBoundingClientRect().top);

    // Any visible text-bearing element that is painted underneath the footer row.
    let worst = 0; let culprit = "";
    for (const el of Array.from(d.querySelectorAll("*")) as HTMLElement[]) {
      if (footer.contains(el) || el.contains(footer)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const text = (el.textContent ?? "").trim();
      if (!text || el.children.length > 0) continue; // leaf text nodes only
      const hidden = r.bottom - footerTop;
      if (hidden > worst && r.top < footerTop + r.height) { worst = hidden; culprit = text.slice(0, 60); }
    }
    return { worst, culprit } as const;
  }, footerButton);

  expect(overlap).not.toHaveProperty("error");
  const { worst, culprit } = overlap as { worst: number; culprit: string };
  expect(worst, `content hidden behind the dialog footer by ${Math.round(worst)}px: "${culprit}"`).toBeLessThanOrEqual(1);
}

test.describe("Dialog footers never clip content", () => {
  // A short viewport forces the dialog to overflow, which is when the bug appeared.
  test.use({ viewport: { width: 1100, height: 520 } });

  test("paid invoice view — the payment line stays fully visible", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await stubRows(page, "invoices", [paidInvoice]);
    await stubRows(page, "invoice_items", [
      { id: "it1", invoice_id: "inv-1", description: "Acer Laptop", quantity: 1, unit_price: 650000, line_total: 650000 },
    ]);
    await page.route("**/rest/v1/sale_payments**", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ method: "cash", amount: 200000 }, { method: "transfer", amount: 430000 }]) }));

    await page.goto("/invoices");
    await page.getByRole("button", { name: "View" }).click();
    await expect(page.getByText(/Payment: Cash/)).toBeVisible();
    await expectNothingHiddenBehindFooter(page, "Download");
  });

  test("new purchase order — the form's last field clears the actions", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await stubRows(page, "purchase_orders", []);
    await page.goto("/purchase-orders");
    await page.getByRole("button", { name: "New PO" }).first().click();
    await expectNothingHiddenBehindFooter(page, "Create PO");
  });

  test("new invoice — the totals row clears the actions", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await stubRows(page, "invoices", []);
    await page.goto("/invoices");
    await page.getByRole("button", { name: "New invoice" }).first().click();
    await expectNothingHiddenBehindFooter(page, "Create invoice");
  });
});
