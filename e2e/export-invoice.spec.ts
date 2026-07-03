import { test, expect } from "@playwright/test";
import { authenticate } from "./support/auth";

test.describe("Export Invoice", () => {
  test("owner sees the module in the nav", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await expect(page.getByRole("link", { name: "Export Invoice" })).toBeVisible();
  });

  test("prefills the seller, reserves a number, and computes line + grand totals", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    // Reserve-number RPC returns a JSON string.
    await page.route("**/rest/v1/rpc/next_export_invoice_number**", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify("ACME/EXP/2026/001") }),
    );
    await page.goto("/export-invoice");

    await expect(page.getByRole("heading", { name: "Export Invoice" })).toBeVisible();
    // Seller prefilled from the business; invoice number reserved from the RPC.
    await expect(page.getByPlaceholder("Exporter company name")).toHaveValue("Sunrise Stores");
    await expect(page.getByLabel("Invoice number")).toHaveValue("ACME/EXP/2026/001");

    // A line total and the grand total compute from boxes x unit price.
    await page.getByLabel("Boxes 1").fill("6");
    await page.getByLabel("Unit price 1").fill("128000");
    await expect(page.getByLabel("Line total 1")).toHaveValue("NGN 768,000.00");
    await expect(page.getByText("NGN 768,000.00").last()).toBeVisible();
  });

  test("a cashier cannot reach the module", async ({ page }) => {
    await authenticate(page, { role: "cashier" });
    await expect(page.getByRole("link", { name: "Export Invoice" })).toHaveCount(0);
  });
});
