import { test, expect, Page } from "@playwright/test";
import { authenticate, stubRows } from "../e2e/support/auth";
import { stubDbReads, FAKE_USER } from "../e2e/support/supabase";

const DIR = "docs/user-guide/screenshots";
const DESKTOP = { width: 1366, height: 900 };
const MOBILE = { width: 375, height: 812 };

const created = (d: string) => new Date(d).toISOString();

const products = [
  { id: "p1", business_id: "biz-1", name: "Garri (50kg bag)", sku: "GAR-50", category: "Foodstuff", unit: "bag", selling_price: 32000, cost_price: 27000, stock_quantity: 18, reorder_level: 5, created_at: created("2026-06-01") },
  { id: "p2", business_id: "biz-1", name: "Rice (50kg bag)", sku: "RIC-50", category: "Foodstuff", unit: "bag", selling_price: 78000, cost_price: 70000, stock_quantity: 4, reorder_level: 6, created_at: created("2026-06-02") },
  { id: "p3", business_id: "biz-1", name: "Vegetable Oil (25L)", sku: "OIL-25", category: "Foodstuff", unit: "keg", selling_price: 41000, cost_price: 36000, stock_quantity: 12, reorder_level: 4, created_at: created("2026-06-03") },
  { id: "p4", business_id: "biz-1", name: "Sugar (50kg)", sku: "SUG-50", category: "Foodstuff", unit: "bag", selling_price: 56000, cost_price: 50000, stock_quantity: 9, reorder_level: 3, created_at: created("2026-06-04") },
  { id: "p5", business_id: "biz-1", name: "Indomie Noodles (carton)", sku: "IND-CTN", category: "Snacks", unit: "carton", selling_price: 9500, cost_price: 8200, stock_quantity: 40, reorder_level: 10, created_at: created("2026-06-05") },
  { id: "p6", business_id: "biz-1", name: "Peak Milk (carton)", sku: "PEAK-CTN", category: "Beverages", unit: "carton", selling_price: 28000, cost_price: 25000, stock_quantity: 2, reorder_level: 5, created_at: created("2026-06-06") },
  { id: "p7", business_id: "biz-1", name: "Bottled Water (pack)", sku: "WTR-PK", category: "Beverages", unit: "pack", selling_price: 1800, cost_price: 1200, stock_quantity: 60, reorder_level: 15, created_at: created("2026-06-07") },
  { id: "p8", business_id: "biz-1", name: "Detergent (5kg tub)", sku: "DET-5", category: "Household", unit: "tub", selling_price: 12000, cost_price: 9800, stock_quantity: 15, reorder_level: 5, created_at: created("2026-06-08") },
];

const invoices = [
  { id: "i1", business_id: "biz-1", invoice_number: "INV-0007", customer_name: "Blessing Stores", customer_phone: "+2348012345678", customer_email: "blessing@stores.ng", status: "paid", subtotal: 110000, discount_amount: 0, tax: 0, total: 110000, issue_date: "2026-06-20", due_date: null, sale_id: "s1", created_by: FAKE_USER.id, notes: null, created_at: created("2026-06-20") },
  { id: "i2", business_id: "biz-1", invoice_number: "INV-0006", customer_name: "Chidi Ventures", customer_phone: "+2348098765432", customer_email: "chidi@ventures.ng", status: "issued", subtotal: 78000, discount_amount: 0, tax: 0, total: 78000, issue_date: "2026-06-18", due_date: "2026-06-25", sale_id: null, created_by: FAKE_USER.id, notes: null, created_at: created("2026-06-18") },
  { id: "i3", business_id: "biz-1", invoice_number: "INV-0005", customer_name: "Walk-in Customer", customer_phone: null, customer_email: null, status: "paid", subtotal: 41000, discount_amount: 1000, tax: 0, total: 40000, issue_date: "2026-06-17", due_date: null, sale_id: "s2", created_by: FAKE_USER.id, notes: null, created_at: created("2026-06-17") },
];

const suppliers = [
  { id: "sup1", business_id: "biz-1", name: "Olu Farms Ltd", contact_name: "Olu Adewale", phone: "+2348012345678", email: "olu@farms.ng", address: "Ikeja, Lagos", rating: 5, notes: null, created_at: created("2026-06-01") },
  { id: "sup2", business_id: "biz-1", name: "Kano Grains Co", contact_name: "Amina Bello", phone: "+2348098765432", email: "sales@kanograins.ng", address: "Kano", rating: 4, notes: null, created_at: created("2026-06-02") },
  { id: "sup3", business_id: "biz-1", name: "Delta Oil Mills", contact_name: "Emeka Obi", phone: "+2348022223333", email: "info@deltaoil.ng", address: "Warri", rating: 4, notes: null, created_at: created("2026-06-03") },
];

const rawMaterials = [
  { id: "rm1", business_id: "biz-1", name: "Cassava flour", sku: "CAS-1", unit: "kg", stock_quantity: 320, reorder_level: 50, cost_per_unit: 500, supplier_id: "sup1", notes: null, created_at: created("2026-06-01") },
  { id: "rm2", business_id: "biz-1", name: "Palm oil (drum)", sku: "PALM-1", unit: "drum", stock_quantity: 6, reorder_level: 3, cost_per_unit: 85000, supplier_id: "sup3", notes: null, created_at: created("2026-06-02") },
  { id: "rm3", business_id: "biz-1", name: "Raw sugar", sku: "SUGR-1", unit: "kg", stock_quantity: 40, reorder_level: 60, cost_per_unit: 1200, supplier_id: "sup2", notes: null, created_at: created("2026-06-03") },
];

const materialPurchases = [
  { id: "mp1", business_id: "biz-1", raw_material_id: "rm1", supplier_id: "sup1", quantity: 200, unit_cost: 500, total_cost: 100000, created_at: created("2026-06-18") },
  { id: "mp2", business_id: "biz-1", raw_material_id: "rm2", supplier_id: "sup3", quantity: 2, unit_cost: 85000, total_cost: 170000, created_at: created("2026-06-15") },
];

const purchaseOrders = [
  { id: "po1", business_id: "biz-1", po_number: "PO-0002", supplier_id: "sup1", status: "received", expected_date: "2026-06-21", total_amount: 100000, notes: null, created_at: created("2026-06-18") },
  { id: "po2", business_id: "biz-1", po_number: "PO-0003", supplier_id: "sup3", status: "sent", expected_date: "2026-06-28", total_amount: 170000, notes: null, created_at: created("2026-06-20") },
];

const reportSales = [
  { id: "rs1", total_amount: 110000, created_at: created("2026-06-22"), staff_id: FAKE_USER.id },
  { id: "rs2", total_amount: 41000, created_at: created("2026-06-21"), staff_id: FAKE_USER.id },
  { id: "rs3", total_amount: 78000, created_at: created("2026-06-20"), staff_id: FAKE_USER.id },
  { id: "rs4", total_amount: 28000, created_at: created("2026-06-19"), staff_id: FAKE_USER.id },
];

const reportSaleItems = [
  { sale_id: "rs1", product_id: "p1", quantity: 2, unit_price: 32000 },
  { sale_id: "rs1", product_id: "p3", quantity: 1, unit_price: 41000 },
  { sale_id: "rs2", product_id: "p3", quantity: 1, unit_price: 41000 },
  { sale_id: "rs3", product_id: "p2", quantity: 1, unit_price: 78000 },
  { sale_id: "rs4", product_id: "p6", quantity: 1, unit_price: 28000 },
];

const invitations = [
  { id: "inv1", business_id: "biz-1", email: "tunde@sunrise.ng", role: "cashier", status: "pending", token: "tok-1", created_at: created("2026-06-21") },
];

async function shoot(page: Page, name: string, fullPage = true) {
  await page.screenshot({ path: `${DIR}/${name}.png`, fullPage });
}

test.describe("user guide screenshots", () => {
  test("getting started — login & signup", async ({ page }) => {
    await stubDbReads(page);
    await page.setViewportSize(DESKTOP);
    await page.goto("/auth");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await shoot(page, "01-getting-started-login", false);

    const signupTab = page.getByRole("tab", { name: /create account|sign up/i });
    if (await signupTab.count()) {
      await signupTab.first().click();
      await page.waitForTimeout(300);
      await shoot(page, "01-getting-started-signup", false);
    }
  });

  test("dashboard", async ({ page }) => {
    await authenticate(page, { ownerName: "Ada Obi", businessName: "Sunrise Stores" });
    await stubRows(page, "products", products);
    await page.setViewportSize(DESKTOP);
    await page.goto("/");
    await expect(page.getByText("Products in Stock")).toBeVisible();
    await shoot(page, "02-dashboard");

    await page.setViewportSize(MOBILE);
    await page.reload();
    await expect(page.getByText("Products in Stock")).toBeVisible();
    await shoot(page, "02-dashboard-mobile");
  });

  test("inventory — list & add product", async ({ page }) => {
    await authenticate(page, { ownerName: "Ada Obi", businessName: "Sunrise Stores" });
    await stubRows(page, "products", products);
    await page.setViewportSize(DESKTOP);
    await page.goto("/inventory");
    await expect(page.getByText("Garri (50kg bag)")).toBeVisible();
    await shoot(page, "03-inventory");

    await page.getByRole("button", { name: "Add product" }).first().click();
    await expect(page.getByText("Add a new product")).toBeVisible();
    await shoot(page, "03-inventory-add-product", false);
  });

  test("point of sale — cart, hold & held sales", async ({ page }) => {
    await authenticate(page, { role: "cashier", ownerName: "Tunde Balogun", businessName: "Sunrise Stores" });
    await stubRows(page, "products", products);
    await page.setViewportSize(DESKTOP);
    await page.goto("/pos");
    await expect(page.getByRole("heading", { name: "Point of Sale" })).toBeVisible();
    await shoot(page, "04-pos");

    await page.getByRole("button", { name: /Garri \(50kg bag\)/ }).click();
    await page.getByRole("button", { name: /Indomie Noodles/ }).click();
    await expect(page.getByText("2 items", { exact: true })).toBeVisible();
    await shoot(page, "04-pos-cart");

    await page.getByRole("button", { name: "Hold sale", exact: true }).click();
    await page.getByRole("button", { name: /Vegetable Oil/ }).click();
    await page.getByRole("button", { name: /Held sales \(1\)/ }).click();
    await expect(page.getByRole("heading", { name: "Held sales" })).toBeVisible();
    await shoot(page, "04-pos-held-sales", false);
    await page.keyboard.press("Escape");

    await page.setViewportSize(MOBILE);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Point of Sale" })).toBeVisible();
    await shoot(page, "04-pos-mobile");
  });

  test("invoices — list", async ({ page }) => {
    await authenticate(page, { ownerName: "Ada Obi", businessName: "Sunrise Stores" });
    await stubRows(page, "invoices", invoices);
    await page.setViewportSize(DESKTOP);
    await page.goto("/invoices");
    await expect(page.getByText("INV-0007")).toBeVisible();
    await shoot(page, "05-invoices");
  });

  test("suppliers — list & add", async ({ page }) => {
    await authenticate(page, { ownerName: "Ada Obi", businessName: "Sunrise Stores" });
    await stubRows(page, "suppliers", suppliers);
    await stubRows(page, "material_purchases", materialPurchases);
    await page.setViewportSize(DESKTOP);
    await page.goto("/suppliers");
    await expect(page.getByText("Olu Farms Ltd")).toBeVisible();
    await shoot(page, "06-suppliers");

    await page.getByRole("button", { name: "Add supplier" }).first().click();
    await expect(page.getByText("Business name")).toBeVisible();
    await shoot(page, "06-suppliers-add", false);
  });

  test("raw materials — list & deliveries", async ({ page }) => {
    await authenticate(page, { ownerName: "Ada Obi", businessName: "Sunrise Stores" });
    await stubRows(page, "raw_materials", rawMaterials);
    await stubRows(page, "suppliers", suppliers);
    await stubRows(page, "material_purchases", materialPurchases);
    await page.setViewportSize(DESKTOP);
    await page.goto("/raw-materials");
    await expect(page.getByText("Cassava flour")).toBeVisible();
    await shoot(page, "07-raw-materials");

    await page.getByRole("tab", { name: /Deliveries/ }).click();
    await page.waitForTimeout(400);
    await shoot(page, "07-raw-materials-deliveries");
  });

  test("purchase orders — list & new PO", async ({ page }) => {
    await authenticate(page, { ownerName: "Ada Obi", businessName: "Sunrise Stores" });
    await stubRows(page, "purchase_orders", purchaseOrders);
    await stubRows(page, "suppliers", suppliers);
    await stubRows(page, "raw_materials", rawMaterials);
    await stubRows(page, "products", products);
    await page.setViewportSize(DESKTOP);
    await page.goto("/purchase-orders");
    await expect(page.getByText("PO-0002")).toBeVisible();
    await shoot(page, "08-purchase-orders");

    await page.getByRole("button", { name: /New PO/ }).click();
    await expect(page.getByText("New purchase order")).toBeVisible();
    await shoot(page, "08-purchase-orders-new", false);
  });

  test("reports", async ({ page }) => {
    await authenticate(page, { ownerName: "Ada Obi", businessName: "Sunrise Stores" });
    await stubRows(page, "sales", reportSales);
    await stubRows(page, "sale_items", reportSaleItems);
    await stubRows(page, "products", products);
    await stubRows(page, "suppliers", suppliers);
    await stubRows(page, "material_purchases", materialPurchases);
    await page.setViewportSize(DESKTOP);
    await page.goto("/reports");
    await expect(page.getByText("Gross profit")).toBeVisible();
    await page.waitForTimeout(600);
    await shoot(page, "09-reports");
  });

  test("team — members & invite", async ({ page }) => {
    await authenticate(page, { ownerName: "Ada Obi", businessName: "Sunrise Stores" });
    await stubRows(page, "invitations", invitations);
    await page.setViewportSize(DESKTOP);
    await page.goto("/team");
    await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();
    await shoot(page, "10-team");

    await page.getByRole("button", { name: /Invite teammate/ }).click();
    await expect(page.getByText("Invite a teammate")).toBeVisible();
    await shoot(page, "10-team-invite", false);
  });

  test("settings", async ({ page }) => {
    await authenticate(page, { ownerName: "Ada Obi", businessName: "Sunrise Stores" });
    await page.setViewportSize(DESKTOP);
    await page.goto("/settings");
    await expect(page.getByText("Business Profile")).toBeVisible();
    await page.waitForTimeout(400);
    await shoot(page, "11-settings");
  });
});
