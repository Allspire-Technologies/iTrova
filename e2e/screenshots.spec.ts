import { test, expect, type Page } from "@playwright/test";
import { authenticate } from "./support/auth";
import { seedDemo, DEMO_OWNER, DEMO_BUSINESS } from "./support/demo";

// Captures PII-free guide screenshots (seeded demo data) into the website's assets.
// Run serially against a warm server:
//   npx vite preview --port 8080 --strictPort   (in another shell, after npm run build)
//   npx playwright test e2e/screenshots.spec.ts --workers=1
const OUT = "C:/Users/Dell/Documents/GitHub/allspire-website/src/assets/guide";
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

// Entry animations make Playwright capture mid-fade (blank) and treat elements as unstable
// (clicks time out). Kill animations after every navigation, and disable them at capture time.
const NO_ANIM = "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;}";
async function go(page: Page, path: string) {
  await page.goto(path);
  await page.addStyleTag({ content: NO_ANIM }).catch(() => {});
}
async function settle(page: Page, ms = 500) {
  await page.waitForTimeout(ms);
}
async function snapPath(page: Page, fullPath: string) {
  await page.evaluate(() => {
    document.querySelectorAll("[data-sonner-toaster], [data-sonner-toast], [role='progressbar']").forEach((n) => n.remove());
  }).catch(() => {});
  await page.screenshot({ path: fullPath, animations: "disabled" });
}
const snap = (page: Page, name: string) => snapPath(page, `${OUT}/${name}.png`);
async function openDialog(page: Page, name: string) {
  await page.getByRole("button", { name }).first().click();
  await page.getByRole("dialog").waitFor({ state: "visible", timeout: 8000 });
}

// Capture-only: writes PNGs to a local path. Skipped unless CAPTURE=1 so CI never runs it.
// Re-capture guide screenshots with: CAPTURE=1 npx playwright test e2e/screenshots.spec.ts --workers=1
test.describe("Guide auth", () => {
  test.skip(!process.env.CAPTURE, "screenshot capture — run with CAPTURE=1");
  test("auth", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.route("**/auth/v1/health**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
    await page.route("**/rest/v1/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
    await go(page, "/auth");
    await page.getByRole("tab", { name: "Sign in" }).click();
    await settle(page);
    await snap(page, "01-getting-started-login");
    await page.getByRole("tab", { name: "Create account" }).click();
    await settle(page);
    await snap(page, "01-getting-started-signup");
  });
});

test.describe("Guide desktop", () => {
  test.skip(!process.env.CAPTURE, "screenshot capture — run with CAPTURE=1");
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await authenticate(page, { ownerName: DEMO_OWNER, businessName: DEMO_BUSINESS, onRoutes: seedDemo });
  });

  test("dashboard", async ({ page }) => {
    await go(page, "/");
    await expect(page.getByRole("heading", { name: /Good day/ })).toBeVisible({ timeout: 20000 });
    await settle(page, 1000);
    await snap(page, "02-dashboard");
  });

  test("inventory", async ({ page }) => {
    await go(page,"/inventory");
    await expect(page.locator("table").getByText("Garri (white) 50kg")).toBeVisible({ timeout: 20000 });
    await settle(page);
    await snap(page, "03-inventory");
    await openDialog(page, "Add product");
    await settle(page);
    await snap(page, "03-inventory-add-product");
  });

  test("pos", async ({ page }) => {
    await go(page,"/pos");
    await expect(page.getByRole("button", { name: /Garri \(white\) 50kg/ })).toBeVisible({ timeout: 20000 });
    await settle(page);
    await snap(page, "04-pos");
    await page.getByRole("button", { name: /Parboiled Rice 25kg/ }).click();
    await page.getByRole("button", { name: /Groundnut Oil 5L/ }).click();
    await page.getByRole("button", { name: /Indomie \(carton\)/ }).click();
    await settle(page);
    await snap(page, "04-pos-cart");
    // Split payment: cart total 43,500 = Cash 25,000 + Transfer 18,500 (Remaining ₦0 ✓).
    await page.getByRole("button", { name: "Split payment" }).click();
    await page.getByLabel("Cash amount").fill("25000");
    await page.getByLabel("Transfer amount").fill("18500");
    await settle(page);
    await snap(page, "04-pos-split");
  });

  test("invoices", async ({ page }) => {
    await go(page,"/invoices");
    await expect(page.locator("table").getByText("260630-3")).toBeVisible({ timeout: 20000 });
    await settle(page);
    await snap(page, "05-invoices");
  });

  test("suppliers", async ({ page }) => {
    await go(page,"/suppliers");
    await expect(page.getByText("Lagos Wholesale Ltd")).toBeVisible({ timeout: 20000 });
    await settle(page);
    await snap(page, "06-suppliers");
    await openDialog(page, "Add supplier");
    await settle(page);
    await snap(page, "06-suppliers-add");
  });

  test("raw materials", async ({ page }) => {
    await go(page,"/raw-materials");
    await expect(page.locator("table").getByText("Wheat Flour 50kg")).toBeVisible({ timeout: 20000 });
    await settle(page);
    await snap(page, "07-raw-materials");
    await page.getByRole("tab", { name: "Deliveries" }).click();
    await settle(page);
    await snap(page, "07-raw-materials-deliveries");
    await page.getByRole("tab", { name: /Requests/ }).click();
    await expect(page.getByRole("button", { name: "Approve" }).first()).toBeVisible({ timeout: 20000 });
    await settle(page);
    await snap(page, "07-raw-materials-requests");
  });

  test("production", async ({ page }) => {
    await go(page, "/production");
    await expect(page.getByRole("heading", { name: "Production" })).toBeVisible({ timeout: 20000 });
    await settle(page);
    await snap(page, "13-production-requests");
    await page.getByRole("button", { name: "Runs", exact: true }).click();
    await expect(page.locator("table").getByText(/Garri \(white\) 50kg/)).toBeVisible({ timeout: 20000 });
    await settle(page);
    await snap(page, "13-production-runs");
  });

  test("general store", async ({ page }) => {
    await go(page, "/general-store");
    await expect(page.getByRole("heading", { name: "General Store" })).toBeVisible({ timeout: 20000 });
    await expect(page.locator("table").getByText("Wheelbarrow")).toBeVisible({ timeout: 20000 });
    await settle(page);
    await snap(page, "15-general-store");
    await page.getByRole("button", { name: "Records", exact: true }).click();
    await expect(page.locator("table").getByText("Emeka Nwosu").first()).toBeVisible({ timeout: 20000 });
    await settle(page);
    await snap(page, "15-general-store-records");
  });

  test("export invoices", async ({ page }) => {
    await go(page, "/export-invoice");
    await expect(page.getByRole("heading", { name: "Export Invoices" })).toBeVisible({ timeout: 20000 });
    await expect(page.getByText("Atlantic Foods LLC")).toBeVisible({ timeout: 20000 });
    await settle(page);
    await snap(page, "16-export-invoices");
  });

  test("expenditure", async ({ page }) => {
    await go(page, "/expenditure");
    await expect(page.getByRole("heading", { name: "Expenditure" })).toBeVisible({ timeout: 20000 });
    await expect(page.locator("table").getByText("Rent").first()).toBeVisible({ timeout: 20000 });
    await settle(page);
    await snap(page, "17-expenditure");
    await go(page, "/expenditure?tab=payroll");
    await expect(page.getByRole("button", { name: /Pay runs/ })).toBeVisible({ timeout: 20000 });
    await expect(page.locator("table").getByText("June 2026").first()).toBeVisible({ timeout: 20000 });
    await settle(page);
    await snap(page, "17-expenditure-payroll");
  });

  test("accounting", async ({ page }) => {
    await go(page, "/accounting");
    await expect(page.getByRole("heading", { name: "Accounting" })).toBeVisible({ timeout: 20000 });
    await expect(page.locator("table").getByText("Gross profit")).toBeVisible({ timeout: 20000 });
    await settle(page);
    await snap(page, "18-accounting-pnl");
    await page.getByRole("button", { name: "Balance Sheet" }).click();
    await expect(page.locator("table").getByText("Total assets")).toBeVisible({ timeout: 20000 });
    await settle(page);
    await snap(page, "18-accounting-balance-sheet");
    await page.getByRole("button", { name: "Journal", exact: true }).click();
    await expect(page.getByText("POS sales")).toBeVisible({ timeout: 20000 });
    await settle(page);
    await snap(page, "18-accounting-journal");
  });

  test("assets", async ({ page }) => {
    await go(page, "/assets");
    await expect(page.getByRole("heading", { name: "Assets", exact: true })).toBeVisible({ timeout: 20000 });
    await expect(page.locator("table").getByText("Delivery Van")).toBeVisible({ timeout: 20000 });
    await settle(page);
    await snap(page, "19-assets");
  });

  test("purchase orders", async ({ page }) => {
    await go(page,"/purchase-orders");
    await expect(page.locator("table").getByText(/PO-260629-2/)).toBeVisible({ timeout: 20000 });
    await settle(page);
    await snap(page, "08-purchase-orders");
    await openDialog(page, "New PO");
    await settle(page);
    await snap(page, "08-purchase-orders-new");
  });

  test("reports", async ({ page }) => {
    await go(page,"/reports");
    await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible({ timeout: 20000 });
    await expect(page.getByText("Revenue trend")).toBeVisible({ timeout: 20000 }); // wait for data, not skeletons
    await settle(page, 800);
    await snap(page, "09-reports");
    // Payment-methods breakdown card (donut + amount/share list) lives further down the page.
    const payCard = page.getByText("Payment methods", { exact: true });
    await payCard.scrollIntoViewIfNeeded();
    await settle(page, 500);
    await snap(page, "09-reports-payments");
  });

  test("team", async ({ page }) => {
    await go(page,"/team");
    await expect(page.getByText("David Eze")).toBeVisible({ timeout: 20000 });
    await settle(page);
    await snap(page, "10-team");
    await openDialog(page, "Invite teammate");
    await settle(page);
    await snap(page, "10-team-invite");
  });

  test("settings", async ({ page }) => {
    await go(page,"/settings");
    await expect(page.getByText("Business Profile")).toBeVisible({ timeout: 20000 });
    await settle(page);
    await snap(page, "11-settings");
  });

  test("permissions", async ({ page }) => {
    await go(page, "/settings");
    await page.getByRole("button", { name: "Permissions & Access" }).click();
    await expect(page.getByText("Storekeeper").first()).toBeVisible({ timeout: 20000 });
    await settle(page);
    await snap(page, "14-permissions");
  });
});

test.describe("Guide mobile", () => {
  test.skip(!process.env.CAPTURE, "screenshot capture — run with CAPTURE=1");
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await authenticate(page, { ownerName: DEMO_OWNER, businessName: DEMO_BUSINESS, onRoutes: seedDemo });
  });

  test("dashboard mobile", async ({ page }) => {
    await go(page,"/");
    await expect(page.getByRole("heading", { name: /Good day/ })).toBeVisible({ timeout: 20000 });
    await settle(page, 1000);
    await snap(page, "02-dashboard-mobile");
  });

  test("pos mobile", async ({ page }) => {
    await go(page,"/pos");
    await expect(page.getByRole("button", { name: /Garri \(white\) 50kg/ })).toBeVisible({ timeout: 20000 });
    await settle(page);
    await snap(page, "04-pos-mobile");
  });
});

test.describe("Guide offline", () => {
  test.skip(!process.env.CAPTURE, "screenshot capture — run with CAPTURE=1");
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await authenticate(page, { ownerName: DEMO_OWNER, businessName: DEMO_BUSINESS, onRoutes: seedDemo });
  });

  test("offline pos", async ({ page }) => {
    await go(page,"/pos");
    await expect(page.getByRole("button", { name: /Garri \(white\) 50kg/ })).toBeVisible({ timeout: 20000 });
    await page.getByRole("button", { name: /Parboiled Rice 25kg/ }).click();
    await page.route("**/auth/v1/health**", (r) => r.abort());
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await page.getByRole("button", { name: "Complete sale" }).click();
    await page.getByRole("button", { name: "New sale" }).click();
    await expect(page.getByText(/Pending sync/)).toBeVisible({ timeout: 12000 });
    await settle(page);
    await snap(page, "12-offline-pos");
  });

  test("offline invoices", async ({ page }) => {
    await go(page,"/pos");
    await expect(page.getByRole("button", { name: /Garri \(white\) 50kg/ })).toBeVisible({ timeout: 20000 });
    await page.getByRole("button", { name: /Parboiled Rice 25kg/ }).click();
    await page.route("**/auth/v1/health**", (r) => r.abort());
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await page.getByRole("button", { name: "Complete sale" }).click();
    await page.getByRole("button", { name: "New sale" }).click();
    await go(page,"/invoices");
    await expect(page.getByRole("heading", { name: /Invoices \(offline\)/ })).toBeVisible({ timeout: 12000 });
    await settle(page);
    await snap(page, "12-offline-invoices");
  });
});

// Marketing showcase images on the Projects page (2x / retina). Re-captured PII-free.
test.describe("Guide showcase", () => {
  test.skip(!process.env.CAPTURE, "screenshot capture — run with CAPTURE=1");
  test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const SHOW = "C:/Users/Dell/Documents/GitHub/allspire-website/src/assets";
  test.beforeEach(async ({ page }) => {
    await authenticate(page, { ownerName: DEMO_OWNER, businessName: DEMO_BUSINESS, onRoutes: seedDemo });
  });

  test("showcase", async ({ page }) => {
    await go(page, "/");
    await expect(page.getByRole("heading", { name: /Good day/ })).toBeVisible({ timeout: 20000 });
    await settle(page, 1000);
    await snapPath(page, `${SHOW}/itrova-dashboard.png`);

    await go(page, "/pos");
    await expect(page.getByRole("button", { name: /Garri \(white\) 50kg/ })).toBeVisible({ timeout: 20000 });
    await settle(page);
    await snapPath(page, `${SHOW}/itrova-pos.png`);

    await go(page, "/inventory");
    await expect(page.locator("table").getByText("Garri (white) 50kg")).toBeVisible({ timeout: 20000 });
    await settle(page);
    await snapPath(page, `${SHOW}/itrova-inventory.png`);

    await go(page, "/reports");
    await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible({ timeout: 20000 });
    await expect(page.getByText("Revenue trend")).toBeVisible({ timeout: 20000 });
    await settle(page, 800);
    await snapPath(page, `${SHOW}/itrova-reports.png`);
  });
});
