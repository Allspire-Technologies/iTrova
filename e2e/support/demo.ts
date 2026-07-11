import type { Page, Route } from "@playwright/test";
import { FAKE_USER } from "./supabase";

// Seeded demo data for capturing guide screenshots. All names/emails/phones are invented
// (no real PII). Shared by e2e/screenshots.spec.ts.

const BIZ = "biz-1";
const STAFF_2 = "staff-2";
const STAFF_3 = "staff-3";

export const DEMO_OWNER = "Sarah Bello";
export const DEMO_BUSINESS = "Bloom Provisions";

const today = "2026-06-30";
const iso = (d: string, h = 10) => `2026-06-${d}T${String(h).padStart(2, "0")}:15:00Z`;

const PRODUCTS = [
  { id: "p1", business_id: BIZ, name: "Garri (white) 50kg", category: "Foodstuff", sku: "GAR-50", unit: "bag", selling_price: 18500, cost_price: 15000, stock_quantity: 24, reorder_level: 5, created_at: iso("01") },
  { id: "p2", business_id: BIZ, name: "Parboiled Rice 25kg", category: "Foodstuff", sku: "RIC-25", unit: "bag", selling_price: 26500, cost_price: 22000, stock_quantity: 12, reorder_level: 4, created_at: iso("02") },
  { id: "p3", business_id: BIZ, name: "Groundnut Oil 5L", category: "Foodstuff", sku: "OIL-5", unit: "keg", selling_price: 9800, cost_price: 8200, stock_quantity: 6, reorder_level: 6, created_at: iso("03") },
  { id: "p4", business_id: BIZ, name: "Tomato Paste (carton)", category: "Foodstuff", sku: "TOM-CT", unit: "carton", selling_price: 14500, cost_price: 11800, stock_quantity: 40, reorder_level: 8, created_at: iso("04") },
  { id: "p5", business_id: BIZ, name: "Sugar 50kg", category: "Foodstuff", sku: "SUG-50", unit: "bag", selling_price: 41000, cost_price: 36000, stock_quantity: 9, reorder_level: 4, created_at: iso("05") },
  { id: "p6", business_id: BIZ, name: "Indomie (carton)", category: "Foodstuff", sku: "IND-CT", unit: "carton", selling_price: 7200, cost_price: 6100, stock_quantity: 30, reorder_level: 10, created_at: iso("06") },
  { id: "p7", business_id: BIZ, name: "Bar Soap (carton)", category: "Household", sku: "SOP-CT", unit: "carton", selling_price: 6500, cost_price: 5200, stock_quantity: 18, reorder_level: 6, created_at: iso("07") },
  { id: "p8", business_id: BIZ, name: "Detergent 1kg", category: "Household", sku: "DET-1", unit: "pack", selling_price: 2200, cost_price: 1650, stock_quantity: 15, reorder_level: 8, created_at: iso("08") },
];

const SALES = [
  { id: "s1", business_id: BIZ, staff_id: FAKE_USER.id, total_amount: 45000, discount_amount: 0, payment_method: "cash", voided: false, created_at: iso("30", 9) },
  { id: "s2", business_id: BIZ, staff_id: STAFF_3, total_amount: 26500, discount_amount: 0, payment_method: "transfer", voided: false, created_at: iso("30", 11) },
  { id: "s3", business_id: BIZ, staff_id: FAKE_USER.id, total_amount: 18500, discount_amount: 500, payment_method: "cash", voided: false, created_at: iso("30", 13) },
  { id: "s4", business_id: BIZ, staff_id: STAFF_3, total_amount: 14400, discount_amount: 0, payment_method: "pos", voided: false, created_at: iso("29", 12) },
  { id: "s5", business_id: BIZ, staff_id: FAKE_USER.id, total_amount: 41000, discount_amount: 0, payment_method: "transfer", voided: false, created_at: iso("28", 10) },
  { id: "s6", business_id: BIZ, staff_id: STAFF_2, total_amount: 9800, discount_amount: 0, payment_method: "cash", voided: false, created_at: iso("27", 15) },
  { id: "s7", business_id: BIZ, staff_id: STAFF_3, total_amount: 21600, discount_amount: 0, payment_method: "cash", voided: false, created_at: iso("26", 14) },
  { id: "s8", business_id: BIZ, staff_id: FAKE_USER.id, total_amount: 33000, discount_amount: 0, payment_method: "transfer", voided: false, created_at: iso("25", 11) },
];

const SALE_ITEMS = [
  { sale_id: "s1", product_id: "p2", quantity: 1, unit_price: 26500, products: { name: "Parboiled Rice 25kg" } },
  { sale_id: "s1", product_id: "p3", quantity: 1, unit_price: 9800, products: { name: "Groundnut Oil 5L" } },
  { sale_id: "s1", product_id: "p8", quantity: 4, unit_price: 2200, products: { name: "Detergent 1kg" } },
  { sale_id: "s2", product_id: "p2", quantity: 1, unit_price: 26500, products: { name: "Parboiled Rice 25kg" } },
  { sale_id: "s3", product_id: "p1", quantity: 1, unit_price: 18500, products: { name: "Garri (white) 50kg" } },
  { sale_id: "s4", product_id: "p6", quantity: 2, unit_price: 7200, products: { name: "Indomie (carton)" } },
];

const INVOICES = [
  { id: "i1", business_id: BIZ, invoice_number: "260630-3", customer_name: "Mrs. Okafor", customer_phone: null, customer_email: null, status: "paid", subtotal: 45000, tax: 0, total: 45000, discount_amount: 0, amount_paid: 45000, issue_date: today, due_date: null, notes: null, sale_id: "s1", created_by: FAKE_USER.id },
  { id: "i2", business_id: BIZ, invoice_number: "260630-2", customer_name: "Bright Stores", customer_phone: null, customer_email: null, status: "paid", subtotal: 26500, tax: 0, total: 26500, discount_amount: 0, amount_paid: 26500, issue_date: today, due_date: null, notes: null, sale_id: "s2", created_by: STAFF_3 },
  { id: "i3", business_id: BIZ, invoice_number: "260628-7", customer_name: "Grace Catering", customer_phone: null, customer_email: null, status: "partial", subtotal: 82000, tax: 0, total: 82000, discount_amount: 0, amount_paid: 40000, issue_date: "2026-06-28", due_date: "2026-07-12", notes: null, sale_id: null, created_by: FAKE_USER.id },
  { id: "i4", business_id: BIZ, invoice_number: "260627-5", customer_name: "Daniel Umeh", customer_phone: null, customer_email: null, status: "issued", subtotal: 14500, tax: 0, total: 14500, discount_amount: 0, amount_paid: 0, issue_date: "2026-06-27", due_date: "2026-07-04", notes: null, sale_id: null, created_by: FAKE_USER.id },
  { id: "i5", business_id: BIZ, invoice_number: "260626-2", customer_name: "Walk-in Customer", customer_phone: null, customer_email: null, status: "paid", subtotal: 21600, tax: 0, total: 21600, discount_amount: 0, amount_paid: 21600, issue_date: "2026-06-26", due_date: null, notes: null, sale_id: "s7", created_by: STAFF_3 },
];

const INVOICE_ITEMS = [
  { invoice_id: "i3", description: "Sugar 50kg", quantity: 2, unit_price: 41000, line_total: 82000 },
];

const SUPPLIERS = [
  { id: "sup1", business_id: BIZ, name: "Lagos Wholesale Ltd", contact_name: "Tunde Bakare", phone: "+234 803 555 0142", email: "sales@lagoswholesale.example", address: "12 Balogun Market, Lagos Island", rating: 5, created_at: iso("01") },
  { id: "sup2", business_id: BIZ, name: "Kano Grains Depot", contact_name: "Amina Sule", phone: "+234 805 555 0177", email: "orders@kanograins.example", address: "Dawanau Market, Kano", rating: 4, created_at: iso("02") },
  { id: "sup3", business_id: BIZ, name: "Sunrise Distributors", contact_name: "Chidi Eze", phone: "+234 802 555 0199", email: "hello@sunrisedist.example", address: "Trade Fair Complex, Lagos", rating: 4, created_at: iso("03") },
];

const RAW_MATERIALS = [
  { id: "rm1", business_id: BIZ, name: "Wheat Flour 50kg", sku: "FLR-50", unit: "bag", stock_quantity: 14, reorder_level: 5, cost_per_unit: 38000, created_at: iso("01") },
  { id: "rm2", business_id: BIZ, name: "Granulated Sugar 50kg", sku: "RSU-50", unit: "bag", stock_quantity: 4, reorder_level: 5, cost_per_unit: 36000, created_at: iso("02") },
  { id: "rm3", business_id: BIZ, name: "Vegetable Oil 25L", sku: "RVO-25", unit: "keg", stock_quantity: 9, reorder_level: 3, cost_per_unit: 41000, created_at: iso("03") },
];

const MATERIAL_PURCHASES = [
  { id: "mp1", business_id: BIZ, raw_material_id: "rm1", supplier_id: "sup2", quantity: 10, unit_cost: 38000, total_cost: 380000, notes: null, created_at: iso("24"), raw_materials: { name: "Wheat Flour 50kg" }, suppliers: { name: "Kano Grains Depot" } },
  { id: "mp2", business_id: BIZ, raw_material_id: "rm3", supplier_id: "sup1", quantity: 6, unit_cost: 41000, total_cost: 246000, notes: null, created_at: iso("22"), raw_materials: { name: "Vegetable Oil 25L" }, suppliers: { name: "Lagos Wholesale Ltd" } },
];

const PRODUCTION_REQUISITIONS = [
  { id: "req1", business_id: BIZ, requested_by: STAFF_2, status: "pending", notes: "For Friday's bread batch", decision_note: null, approved_by: null, approved_at: null, created_at: iso("30", 8),
    production_requisition_items: [
      { id: "rqi1", raw_material_id: "rm1", quantity_requested: 4, quantity_issued: null, raw_materials: { name: "Wheat Flour 50kg", unit: "bag" } },
      { id: "rqi2", raw_material_id: "rm2", quantity_requested: 2, quantity_issued: null, raw_materials: { name: "Granulated Sugar 50kg", unit: "bag" } },
    ] },
  { id: "req3", business_id: BIZ, requested_by: STAFF_2, status: "approved", notes: null, decision_note: null, approved_by: FAKE_USER.id, approved_at: iso("30", 9), created_at: iso("30", 8),
    production_requisition_items: [
      { id: "rqi4", raw_material_id: "rm3", quantity_requested: 2, quantity_issued: 2, raw_materials: { name: "Vegetable Oil 25L", unit: "keg" } },
    ] },
  { id: "req2", business_id: BIZ, requested_by: STAFF_2, status: "completed", notes: null, decision_note: null, approved_by: FAKE_USER.id, approved_at: iso("28", 10), created_at: iso("28", 9),
    production_requisition_items: [
      { id: "rqi3", raw_material_id: "rm1", quantity_requested: 3, quantity_issued: 3, raw_materials: { name: "Wheat Flour 50kg", unit: "bag" } },
    ] },
];

const PRODUCTION_RUNS = [
  { id: "run1", business_id: BIZ, requisition_id: "req2", produced_by: STAFF_2, notes: null, created_at: iso("28", 12),
    production_run_outputs: [{ product_id: "p1", quantity: 40, products: { name: "Garri (white) 50kg", unit: "bag" } }],
    production_run_materials: [{ raw_material_id: "rm1", quantity_used: 3, raw_materials: { name: "Wheat Flour 50kg", unit: "bag" } }] },
];

// One custom role alongside the built-in Owner/Manager/Cashier defaults, for the Permissions screen.
const TEAM_ROLES = [
  { id: "tr1", business_id: BIZ, name: "Storekeeper", system_key: null,
    permissions: { raw_materials: ["view", "create", "edit", "adjust_stock", "approve_requests", "reject_requests"], inventory: ["view"], purchase_orders: ["view", "receive"] }, created_at: iso("10") },
];

const STORE_STAFF = [
  { id: "ss1", business_id: BIZ, name: "Emeka Nwosu", phone: "+234 806 555 0110", role: "Line supervisor", active: true, created_at: iso("06") },
  { id: "ss2", business_id: BIZ, name: "Fatima Yusuf", phone: "+234 807 555 0121", role: "Packer", active: true, created_at: iso("07") },
];

const STORE_ITEMS = [
  { id: "si1", business_id: BIZ, name: "Wheelbarrow", category: "Equipment", unit: "unit", kind: "borrowable", stock_quantity: 3, reorder_level: 1, created_at: iso("05") },
  { id: "si2", business_id: BIZ, name: "Safety gloves", category: "PPE", unit: "pair", kind: "consumable", stock_quantity: 8, reorder_level: 10, created_at: iso("06") },
  { id: "si3", business_id: BIZ, name: "Cleaning bucket", category: "Equipment", unit: "unit", kind: "borrowable", stock_quantity: 5, reorder_level: 2, created_at: iso("07") },
];

const STORE_TRANSACTIONS = [
  { id: "st1", business_id: BIZ, item_id: "si1", staff_id: "ss1", kind: "borrow", quantity: 1, returned_quantity: 0, status: "out", due_date: "2026-07-02", returned_at: null, notes: null, created_at: iso("29", 9), item: { name: "Wheelbarrow", unit: "unit", kind: "borrowable" }, staff: { name: "Emeka Nwosu" } },
  { id: "st2", business_id: BIZ, item_id: "si2", staff_id: "ss2", kind: "collect", quantity: 2, returned_quantity: 0, status: "collected", due_date: null, returned_at: null, notes: null, created_at: iso("28", 14), item: { name: "Safety gloves", unit: "pair", kind: "consumable" }, staff: { name: "Fatima Yusuf" } },
  { id: "st3", business_id: BIZ, item_id: "si3", staff_id: "ss1", kind: "borrow", quantity: 1, returned_quantity: 1, status: "returned", due_date: "2026-06-27", returned_at: iso("27", 16), notes: null, created_at: iso("26", 10), item: { name: "Cleaning bucket", unit: "unit", kind: "borrowable" }, staff: { name: "Emeka Nwosu" } },
];

const EXPORT_INVOICES = [
  { id: "ei1", business_id: BIZ, invoice_number: "BLM-EXP-0007", invoice_date: "2026-06-29", currency: "USD", country_of_origin: "Nigeria",
    seller_name: DEMO_BUSINESS, buyer_name: "Atlantic Foods LLC", buyer_country: "United States",
    subtotal: 24500, total: 24500, total_cartons: 350, amount_in_words: "", items: [{ product_id: null, description: "Dried Hibiscus", size: "50kg", units_per_box: 1, boxes: 350, unit_price: 70, total: 24500 }], created_at: iso("29", 11) },
  { id: "ei2", business_id: BIZ, invoice_number: "BLM-EXP-0006", invoice_date: "2026-06-21", currency: "GBP", country_of_origin: "Nigeria",
    seller_name: DEMO_BUSINESS, buyer_name: "Savannah Imports Ltd", buyer_country: "United Kingdom",
    subtotal: 18000, total: 18000, total_cartons: 200, amount_in_words: "", items: [{ product_id: null, description: "Shea Butter", size: "20kg", units_per_box: 1, boxes: 200, unit_price: 90, total: 18000 }], created_at: iso("21", 10) },
];

const PURCHASE_ORDERS = [
  { id: "po1", business_id: BIZ, po_number: "PO-260629-2", supplier_id: "sup1", status: "sent", expected_date: "2026-07-03", total_amount: 370000, notes: null, created_at: iso("29"), received_at: null, suppliers: { name: "Lagos Wholesale Ltd" } },
  { id: "po2", business_id: BIZ, po_number: "PO-260626-1", supplier_id: "sup2", status: "received", expected_date: "2026-06-28", total_amount: 530000, notes: null, created_at: iso("26"), received_at: iso("28"), suppliers: { name: "Kano Grains Depot" } },
];

const PO_ITEMS = [
  { id: "poi1", purchase_order_id: "po1", product_id: "p2", raw_material_id: null, description: "Parboiled Rice 25kg", quantity: 10, unit_cost: 22000, line_total: 220000 },
  { id: "poi2", purchase_order_id: "po1", product_id: "p1", raw_material_id: null, description: "Garri (white) 50kg", quantity: 10, unit_cost: 15000, line_total: 150000 },
];

const STOCK_ADJUSTMENTS = [
  { id: "adj1", created_at: iso("30", 8), delta: 10, reason: "Purchase order received", notes: null, user_id: FAKE_USER.id, product_id: "p4", raw_material_id: null, products: { name: "Tomato Paste (carton)" }, raw_materials: null },
  { id: "adj2", created_at: iso("29", 16), delta: -2, reason: "Damaged stock", notes: null, user_id: STAFF_2, product_id: "p3", raw_material_id: null, products: { name: "Groundnut Oil 5L" }, raw_materials: null },
];

const ACTIVITY_LOG = [
  { id: "al1", created_at: iso("30", 13), summary: "Invoice 260628-7 marked partial · balance 42000", actor_name: DEMO_OWNER },
  { id: "al2", created_at: iso("30", 10), summary: "Invoice 260630-2 created", actor_name: "Joy Adeyemi" },
];

const PROFILES = [
  { id: FAKE_USER.id, owner_name: DEMO_OWNER, business_id: BIZ, onboarded: true, last_seen: iso("30", 9), phone: null, notification_prefs: null, created_at: iso("01") },
  { id: STAFF_2, owner_name: "David Eze", business_id: BIZ, onboarded: true, last_seen: iso("29", 17), phone: null, notification_prefs: null, created_at: iso("05") },
  { id: STAFF_3, owner_name: "Joy Adeyemi", business_id: BIZ, onboarded: true, last_seen: iso("30", 12), phone: null, notification_prefs: null, created_at: iso("08") },
];

const USER_ROLES = [
  { user_id: FAKE_USER.id, role: "owner" },
  { user_id: STAFF_2, role: "manager" },
  { user_id: STAFF_3, role: "cashier" },
];

const MEMBER_EMAILS = [
  { user_id: FAKE_USER.id, email: "sarah@bloomprovisions.example" },
  { user_id: STAFF_2, email: "david@bloomprovisions.example" },
  { user_id: STAFF_3, email: "joy@bloomprovisions.example" },
];

const INVITATIONS = [
  { id: "inv1", business_id: BIZ, email: "samuel@bloomprovisions.example", role: "cashier", token: "demo-token", invited_by: FAKE_USER.id, expires_at: "2026-07-13T00:00:00Z", accepted_at: null, accepted_by: null, created_at: iso("28") },
];

// ---- Expenditure module: expenses + payroll ------------------------------------------------
const EXPENSES = [
  { id: "ex1", business_id: BIZ, expense_date: "2026-06-30", category: "Salaries", amount: 210000, payment_method: "transfer", payee: "June payroll", supplier_id: null, description: "Posted from payroll", status: "paid", due_date: null, paid_date: "2026-06-30", receipt_ref: null, tax_amount: 0, created_by: FAKE_USER.id, created_at: iso("30") },
  { id: "ex2", business_id: BIZ, expense_date: "2026-06-05", category: "Rent", amount: 90000, payment_method: "transfer", payee: "Shop landlord", supplier_id: null, description: "Monthly shop rent", status: "paid", due_date: null, paid_date: "2026-06-05", receipt_ref: null, tax_amount: 0, created_by: FAKE_USER.id, created_at: iso("05") },
  { id: "ex3", business_id: BIZ, expense_date: "2026-06-12", category: "Utilities", amount: 26500, payment_method: "cash", payee: "PHCN & water board", supplier_id: null, description: null, status: "paid", due_date: null, paid_date: "2026-06-12", receipt_ref: null, tax_amount: 0, created_by: STAFF_2, created_at: iso("12") },
  { id: "ex4", business_id: BIZ, expense_date: "2026-06-18", category: "Transport", amount: 18000, payment_method: "cash", payee: "Dispatch rider", supplier_id: null, description: "Customer deliveries", status: "pending", due_date: "2026-07-05", paid_date: null, receipt_ref: null, tax_amount: 0, created_by: STAFF_2, created_at: iso("18") },
  { id: "ex5", business_id: BIZ, expense_date: "2026-06-22", category: "Supplies", amount: 14500, payment_method: "transfer", payee: "Packaging Co", supplier_id: "sup3", description: "Nylon bags & cartons", status: "paid", due_date: null, paid_date: "2026-06-22", receipt_ref: null, tax_amount: 0, created_by: FAKE_USER.id, created_at: iso("22") },
];

const PAYROLL_EMPLOYEES = [
  { id: "pe1", business_id: BIZ, name: "Emeka Nwosu", store_staff_id: "ss1", user_id: null, pay_type: "monthly", base_rate: 85000, bank_name: "GTBank", account_number: "0123456789", account_name: "Emeka Nwosu", notes: null, active: true, created_at: iso("06") },
  { id: "pe2", business_id: BIZ, name: "Fatima Yusuf", store_staff_id: "ss2", user_id: null, pay_type: "monthly", base_rate: 70000, bank_name: "Access Bank", account_number: "0987654321", account_name: "Fatima Yusuf", notes: null, active: true, created_at: iso("07") },
  { id: "pe3", business_id: BIZ, name: "David Eze", store_staff_id: null, user_id: STAFF_2, pay_type: "monthly", base_rate: 55000, bank_name: "Zenith Bank", account_number: "1122334455", account_name: "David Eze", notes: null, active: true, created_at: iso("08") },
];

const PAYROLL_RUNS = [
  { id: "pr1", business_id: BIZ, period_label: "June 2026", period_start: "2026-06-01", period_end: "2026-06-30", pay_date: "2026-06-30", status: "posted", expense_id: "ex1", gross_total: 210000, deduction_total: 12500, net_total: 197500, notes: null, created_at: iso("30") },
  { id: "pr2", business_id: BIZ, period_label: "May 2026", period_start: "2026-05-01", period_end: "2026-05-31", pay_date: "2026-05-31", status: "posted", expense_id: null, gross_total: 210000, deduction_total: 12500, net_total: 197500, notes: null, created_at: "2026-05-31T10:15:00Z" },
];

const PAYROLL_RUN_LINES = [
  { id: "prl1", run_id: "pr1", employee_id: "pe1", employee_name: "Emeka Nwosu", gross_pay: 85000, deductions: [{ label: "PAYE", amount: 6500 }], deduction_total: 6500, net_pay: 78500, notes: null },
  { id: "prl2", run_id: "pr1", employee_id: "pe2", employee_name: "Fatima Yusuf", gross_pay: 70000, deductions: [{ label: "PAYE", amount: 4000 }], deduction_total: 4000, net_pay: 66000, notes: null },
  { id: "prl3", run_id: "pr1", employee_id: "pe3", employee_name: "David Eze", gross_pay: 55000, deductions: [{ label: "Pension", amount: 2000 }], deduction_total: 2000, net_pay: 53000, notes: null },
];

// ---- Assets module -------------------------------------------------------------------------
const FIXED_ASSETS = [
  { id: "fa1", business_id: BIZ, name: "Delivery Van", category: "Vehicle", cost: 4500000, year_purchased: 2024, depreciation_rate: 0.2, active: true, created_at: iso("01") },
  { id: "fa2", business_id: BIZ, name: "Chest Freezer", category: "Equipment", cost: 850000, year_purchased: 2025, depreciation_rate: 0.2, active: true, created_at: iso("02") },
  { id: "fa3", business_id: BIZ, name: "Shop Shelving", category: "Fixtures & fittings", cost: 320000, year_purchased: 2023, depreciation_rate: 0.2, active: true, created_at: iso("03") },
  { id: "fa4", business_id: BIZ, name: "POS Laptop", category: "Equipment", cost: 480000, year_purchased: 2026, depreciation_rate: 0.25, active: true, created_at: iso("04") },
];

// ---- Accounting module: chart of accounts + a small balanced general ledger ----------------
const ACCOUNTS = ([
  ["ac-1000", "1000", "Cash", "asset"], ["ac-1010", "1010", "Bank", "asset"],
  ["ac-1100", "1100", "Accounts Receivable", "asset"], ["ac-1200", "1200", "Inventory", "asset"],
  ["ac-1500", "1500", "Fixed Assets", "asset"], ["ac-1590", "1590", "Accumulated Depreciation", "asset"],
  ["ac-2000", "2000", "Accounts Payable", "liability"], ["ac-2100", "2100", "VAT Payable", "liability"],
  ["ac-3000", "3000", "Owner's Capital", "equity"], ["ac-3100", "3100", "Retained Earnings", "equity"],
  ["ac-3900", "3900", "Opening Balance Equity", "equity"], ["ac-4000", "4000", "Sales", "income"],
  ["ac-5000", "5000", "Cost of Goods Sold", "expense"], ["ac-6000", "6000", "Operating Expenses", "expense"],
  ["ac-6100", "6100", "Depreciation Expense", "expense"],
] as const).map(([id, code, name, type], i) => ({ id, business_id: BIZ, code, name, type, is_system: true, active: true, created_at: iso("01", 8 + i) }));

const ACCT_META: Record<string, { code: string; name: string; type: string }> =
  Object.fromEntries(ACCOUNTS.map((a) => [a.id, { code: a.code, name: a.name, type: a.type }]));

// Each entry balances (debits = credits). Line tuple = [account_id, debit, credit, description].
const JOURNAL: { date: string; source: string; memo: string; lines: [string, number, number, string][] }[] = [
  { date: "2026-06-01", source: "opening", memo: "Opening balances", lines: [
    ["ac-1000", 150000, 0, "Opening cash"], ["ac-1010", 250000, 0, "Opening bank"],
    ["ac-1200", 900000, 0, "Opening inventory"], ["ac-1500", 300000, 0, "Opening fixed assets"],
    ["ac-3000", 0, 1600000, "Opening capital"]] },
  { date: "2026-06-20", source: "sale", memo: "POS sales", lines: [
    ["ac-1000", 1168000, 0, "Cash received"], ["ac-4000", 0, 1168000, "Sales"]] },
  { date: "2026-06-20", source: "sale", memo: "Cost of goods sold", lines: [
    ["ac-5000", 812000, 0, "Cost of goods sold"], ["ac-1200", 0, 812000, "Inventory sold"]] },
  { date: "2026-06-24", source: "invoice", memo: "Invoice 260628-7 · Grace Catering", lines: [
    ["ac-1100", 82000, 0, "Grace Catering"], ["ac-4000", 0, 82000, "Sales"]] },
  { date: "2026-06-28", source: "payment", memo: "Payment · Grace Catering", lines: [
    ["ac-1000", 40000, 0, "Part-payment received"], ["ac-1100", 0, 40000, "Grace Catering"]] },
  { date: "2026-06-22", source: "purchase", memo: "Stock purchase", lines: [
    ["ac-1200", 150000, 0, "Stock purchased"], ["ac-1000", 0, 150000, "Cash paid"]] },
  { date: "2026-06-05", source: "expense", memo: "Rent", lines: [
    ["ac-6000", 90000, 0, "Rent"], ["ac-1010", 0, 90000, "Bank"]] },
  { date: "2026-06-12", source: "expense", memo: "Utilities", lines: [
    ["ac-6000", 26500, 0, "Utilities"], ["ac-1000", 0, 26500, "Cash"]] },
  { date: "2026-06-18", source: "expense", memo: "Transport", lines: [
    ["ac-6000", 18000, 0, "Transport"], ["ac-1000", 0, 18000, "Cash"]] },
  { date: "2026-06-30", source: "payroll", memo: "Salaries · June 2026", lines: [
    ["ac-6000", 210000, 0, "Salaries"], ["ac-1000", 0, 210000, "Cash"]] },
  { date: "2026-06-30", source: "manual", memo: "Depreciation to date", lines: [
    ["ac-6100", 12000, 0, "Depreciation"], ["ac-1590", 0, 12000, "Accumulated depreciation"]] },
];

const JOURNAL_ENTRIES = JOURNAL.map((e, i) => ({
  id: `je-${i + 1}`, business_id: BIZ, entry_date: e.date, memo: e.memo, source: e.source, source_id: null,
  created_at: `${e.date}T${String(8 + i).padStart(2, "0")}:00:00Z`,
  journal_lines: e.lines.map(([account_id, debit, credit, description], j) => ({
    id: `je-${i + 1}-l${j}`, account_id, debit, credit, description, accounts: ACCT_META[account_id],
  })),
}));

// Flat journal lines (P&L / Balance Sheet / Cash Flow / Trial Balance), each carrying its entry.
const JOURNAL_LINES = JOURNAL.flatMap((e) => e.lines.map(([account_id, debit, credit, description]) => ({
  account_id, debit, credit, description, journal_entries: { entry_date: e.date, source: e.source },
})));

function fulfill(route: Route, body: unknown, headers: Record<string, string> = {}) {
  return route.fulfill({ status: 200, contentType: "application/json", headers, body: JSON.stringify(body) });
}
function arrayOrObject(route: Route, rows: unknown[]) {
  const accept = route.request().headers()["accept"] || "";
  return fulfill(route, accept.includes("vnd.pgrst.object") ? (rows[0] ?? null) : rows);
}
const range = (n: number) => ({ "content-range": `0-${Math.max(0, n - 1)}/${n}` });

/** Stub every table a guide page reads with demo data. Call AFTER authenticate(). */
export async function seedDemo(page: Page) {
  await page.route("**/rest/v1/products**", (r) => fulfill(r, PRODUCTS, range(PRODUCTS.length)));
  await page.route("**/rest/v1/sales**", (r) => fulfill(r, SALES, range(SALES.length)));
  await page.route("**/rest/v1/sale_items**", (r) => fulfill(r, SALE_ITEMS));
  await page.route("**/rest/v1/invoices**", (r) => arrayOrObjectWithCount(r, INVOICES));
  await page.route("**/rest/v1/invoice_items**", (r) => fulfill(r, INVOICE_ITEMS));
  await page.route("**/rest/v1/invoice_payments**", (r) => fulfill(r, []));
  await page.route("**/rest/v1/suppliers**", (r) => arrayOrObject(r, SUPPLIERS));
  await page.route("**/rest/v1/raw_materials**", (r) => arrayOrObject(r, RAW_MATERIALS));
  await page.route("**/rest/v1/material_purchases**", (r) => fulfill(r, MATERIAL_PURCHASES));
  // Production module: the pending count header drives the Raw Materials "Requests" badge.
  await page.route("**/rest/v1/production_requisitions**", (r) => {
    if (r.request().method() === "HEAD") return fulfill(r, [], range(1)); // 1 pending
    return fulfill(r, PRODUCTION_REQUISITIONS);
  });
  await page.route("**/rest/v1/production_runs**", (r) => fulfill(r, PRODUCTION_RUNS));
  await page.route("**/rest/v1/product_materials**", (r) => fulfill(r, []));
  await page.route("**/rest/v1/team_roles**", (r) => fulfill(r, TEAM_ROLES));
  await page.route("**/rest/v1/member_access**", (r) => fulfill(r, []));
  // General Store + Export Invoices modules.
  await page.route("**/rest/v1/store_items**", (r) => fulfill(r, STORE_ITEMS));
  await page.route("**/rest/v1/store_staff**", (r) => fulfill(r, STORE_STAFF));
  await page.route("**/rest/v1/store_transactions**", (r) => fulfill(r, STORE_TRANSACTIONS));
  await page.route("**/rest/v1/export_invoices**", (r) => fulfill(r, EXPORT_INVOICES));
  await page.route("**/rest/v1/purchase_orders**", (r) => arrayOrObject(r, PURCHASE_ORDERS));
  await page.route("**/rest/v1/purchase_order_items**", (r) => fulfill(r, PO_ITEMS));
  await page.route("**/rest/v1/stock_adjustments**", (r) => fulfill(r, STOCK_ADJUSTMENTS));
  await page.route("**/rest/v1/activity_log**", (r) => fulfill(r, ACTIVITY_LOG));
  await page.route("**/rest/v1/invitations**", (r) => fulfill(r, INVITATIONS));
  await page.route("**/rest/v1/user_roles**", (r) =>
    fulfill(r, r.request().url().includes("user_id=") ? [{ user_id: FAKE_USER.id, role: "owner" }] : USER_ROLES));
  await page.route("**/rest/v1/profiles**", (r) => {
    // AuthContext reads its own profile via .eq("id", …).maybeSingle(); list views use .in(...) or
    // .eq("business_id", …). Match the `id` column precisely — "business_id=eq." also contains "id=eq.".
    const owner = PROFILES[0];
    if (/[?&]id=eq\./.test(r.request().url())) return fulfill(r, owner);
    return arrayOrObject(r, PROFILES);
  });
  await page.route("**/rest/v1/rpc/get_member_emails**", (r) => fulfill(r, MEMBER_EMAILS));
  // Expenditure + Payroll modules.
  await page.route("**/rest/v1/expenses**", (r) => fulfill(r, EXPENSES));
  await page.route("**/rest/v1/payroll_employees**", (r) => fulfill(r, PAYROLL_EMPLOYEES));
  await page.route("**/rest/v1/payroll_runs**", (r) => fulfill(r, PAYROLL_RUNS));
  await page.route("**/rest/v1/payroll_run_lines**", (r) => fulfill(r, PAYROLL_RUN_LINES));
  // Assets module.
  await page.route("**/rest/v1/fixed_assets**", (r) => fulfill(r, FIXED_ASSETS));
  // Accounting module: chart of accounts + general ledger. The statements all read journal_lines;
  // the P&L's "previous period" call (an older lte with a description select) gets a scaled-down copy
  // so the comparison column shows realistic growth rather than a flat 0%.
  await page.route("**/rest/v1/rpc/ensure_chart_of_accounts**", (r) => fulfill(r, {}));
  await page.route("**/rest/v1/accounts**", (r) => fulfill(r, ACCOUNTS));
  await page.route("**/rest/v1/journal_entries**", (r) => fulfill(r, JOURNAL_ENTRIES));
  await page.route("**/rest/v1/journal_lines**", (r) => {
    const url = r.request().url();
    const lte = url.match(/entry_date=lte\.(\d{4}-\d{2}-\d{2})/);
    const isPrevPeriod = url.includes("description") && lte && Date.parse(lte[1]) < Date.now() - 20 * 86_400_000;
    const lines = isPrevPeriod
      ? JOURNAL_LINES.map((l) => ({ ...l, debit: Math.round(l.debit * 0.85), credit: Math.round(l.credit * 0.85) }))
      : JOURNAL_LINES;
    return fulfill(r, lines);
  });
  // Generous (unlimited) limits + all modules so no buttons are disabled / hidden in screenshots.
  await page.route("**/rest/v1/plans**", (r) => fulfill(r, [
    {
      key: "free", name: "Free", is_active: true, sort_order: 0,
      modules: ["inventory", "pos", "suppliers", "raw_materials", "purchase_orders", "invoices", "export_invoices", "general_store", "expenditure", "accounting", "assets", "reports", "team", "production", "csv_import", "csv_export"],
      limits: { inventory: null, suppliers: null, invoices: null, team: null, raw_materials: null, purchase_orders: null },
      prices: [],
    },
  ]));
}

function arrayOrObjectWithCount(route: Route, rows: unknown[]) {
  const accept = route.request().headers()["accept"] || "";
  if (accept.includes("vnd.pgrst.object")) return fulfill(route, rows[0] ?? null);
  return fulfill(route, rows, range(rows.length));
}
