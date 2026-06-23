import { test, expect } from "@playwright/test";
import { authenticate } from "./support/auth";

test.describe("Reports", () => {
  test("renders metrics and the revenue trend", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await page.goto("/reports");
    await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
    await expect(page.getByText("Gross profit")).toBeVisible();
    await expect(page.getByText("Revenue trend")).toBeVisible();
  });
});
