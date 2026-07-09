import { test, expect } from "@playwright/test";
import { authenticate } from "./support/auth";

// Form/content modals take 75% of the desktop viewport; confirmations stay compact.
test.describe("Modal width", () => {
  test("a form/content modal spans ~75% of the desktop viewport", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await authenticate(page, { role: "owner" });
    await page.goto("/purchase-orders");
    await page.getByRole("button", { name: "New PO" }).click();
    const box = await page.getByRole("dialog").boundingBox();
    const vw = page.viewportSize()!.width;
    expect(box!.width).toBeGreaterThan(vw * 0.70); // ~75vw (0.75 ± tolerance)
    expect(box!.width).toBeLessThan(vw * 0.80);
  });

  test("clicking outside does not close a modal; the close icon does", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await authenticate(page, { role: "owner" });
    await page.goto("/purchase-orders");
    await page.getByRole("button", { name: "New PO" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.mouse.click(5, 5); // click on the overlay, outside the dialog
    await expect(dialog).toBeVisible(); // still open — outside click is ignored
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toHaveCount(0); // the X closes it
  });

  test("a confirmation dialog stays compact (not 75vw)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await authenticate(page, { role: "owner" });
    // The sign-out confirm is a compact dialog with no data dependencies.
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const box = await page.getByRole("dialog").boundingBox();
    expect(box!.width).toBeLessThan(560); // compact (~max-w-sm), nowhere near 960
  });
});
