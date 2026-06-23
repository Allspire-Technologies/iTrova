import { test, expect } from "@playwright/test";
import { authenticate } from "./support/auth";

test.describe("Dashboard", () => {
  test("renders the greeting, business name and metric cards", async ({ page }) => {
    await authenticate(page, { ownerName: "Ada Obi", businessName: "Sunrise Stores" });
    await expect(page).toHaveURL("/");
    await expect(page.getByText(/Good day, Ada/)).toBeVisible();
    await expect(page.getByText("Sunrise Stores")).toBeVisible();
    await expect(page.getByText("Today's Sales")).toBeVisible();
    await expect(page.getByText("Products in Stock")).toBeVisible();
    await expect(page.getByText("Open Invoices")).toBeVisible();
  });
});
