import { describe, it, expect } from "vitest";
import {
  canonicalize, validateRow, templateValues, templateHeaders,
  SUPPLIER_FIELDS, buildSupplierImportPlan,
  MATERIAL_FIELDS, buildMaterialImportPlan,
  PO_FIELDS, buildPoImportPlan,
  TEAM_FIELDS, buildTeamImportPlan,
} from "./csvImport";

describe("canonicalize / validateRow", () => {
  it("maps aliased, case/spacing-varied headers onto canonical keys", () => {
    const canon = canonicalize(
      { "Supplier Name": "Olu Farms", "PHONE_NUMBER": "0801", "e-mail": "a@b.co" },
      SUPPLIER_FIELDS,
    );
    expect(canon).toEqual({ name: "Olu Farms", phone: "0801", email: "a@b.co" });
  });

  it("first matching column wins when two headers alias the same field", () => {
    const canon = canonicalize({ "Name": "First", "Supplier": "Second" }, SUPPLIER_FIELDS);
    expect(canon.name).toBe("First");
  });

  it("flags missing required and non-numeric numeric fields", () => {
    const canon = canonicalize({ "Rating": "great" }, SUPPLIER_FIELDS);
    expect(validateRow(canon, SUPPLIER_FIELDS)).toEqual(["Missing Name", "Invalid Rating"]);
  });

  it("templateValues re-keys a raw row onto template headers for the re-download", () => {
    const values = templateValues({ "supplier_name": "Olu", "tel": "0801" }, SUPPLIER_FIELDS);
    expect(values["Name"]).toBe("Olu");
    expect(values["Phone"]).toBe("0801");
    expect(Object.keys(values)).toEqual(templateHeaders(SUPPLIER_FIELDS));
  });
});

describe("buildSupplierImportPlan", () => {
  const rows = (over: Record<string, string>[]) => over;

  it("inserts new suppliers and tolerates currency/commas in rating-free fields", () => {
    const plan = buildSupplierImportPlan(rows([{ name: "Olu Farms", rating: "4" }]), [], 0, null);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0]).toMatchObject({ name: "Olu Farms", rating: 4 });
    expect(plan.rejected).toHaveLength(0);
  });

  it("rejects out-of-range ratings with a specific reason", () => {
    const plan = buildSupplierImportPlan(rows([{ name: "X", rating: "9" }]), [], 0, null);
    expect(plan.inserts).toHaveLength(0);
    expect(plan.rejected[0].reason).toMatch(/Invalid Rating — use 1 to 5/);
  });

  it("updates an existing supplier by name, only overwriting non-blank cells", () => {
    const plan = buildSupplierImportPlan(
      rows([{ name: "olu farms", phone: "0802", email: "" }]),
      [{ id: "s1", name: "Olu Farms" }], 1, null,
    );
    expect(plan.inserts).toHaveLength(0);
    expect(plan.updates).toEqual([{ id: "s1", fields: { phone: "0802" } }]);
  });

  it("rejects duplicate names in the file (both copies)", () => {
    const plan = buildSupplierImportPlan(rows([{ name: "Dup" }, { name: "DUP" }]), [], 0, null);
    expect(plan.inserts).toHaveLength(0);
    expect(plan.rejected).toHaveLength(2);
    expect(plan.rejected[0].reason).toMatch(/Duplicate name in file/);
  });

  it("caps only new inserts at the plan limit; updates stay free", () => {
    const plan = buildSupplierImportPlan(
      rows([{ name: "Existing", phone: "1" }, { name: "New A" }, { name: "New B" }]),
      [{ id: "s1", name: "Existing" }], 1, 2,
    );
    expect(plan.updates).toHaveLength(1);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.rejected[0].reason).toMatch(/Plan limit reached/);
  });
});

describe("buildMaterialImportPlan", () => {
  const suppliers = [{ id: "sup1", name: "Olu Farms" }];

  it("parses currency/comma numbers and defaults unit/reorder", () => {
    const plan = buildMaterialImportPlan(
      [{ "Name": "Flour", "Stock Quantity": "1,500", "Cost Per Unit": "₦1,200" }],
      [], suppliers, 0, null,
    );
    expect(plan.inserts[0]).toMatchObject({ name: "Flour", unit: "kg", reorder_level: 5, stock_quantity: 1500, cost_per_unit: 1200 });
  });

  it("restocks an existing material matched by SKU (case-insensitive)", () => {
    const plan = buildMaterialImportPlan(
      [{ name: "Flour", sku: "cf-1", stock_quantity: "10", cost_per_unit: "100" }],
      [{ id: "m1", sku: "CF-1", stock_quantity: 5 }], suppliers, 1, null,
    );
    expect(plan.inserts).toHaveLength(0);
    expect(plan.updates).toEqual([expect.objectContaining({ id: "m1", stock: 15 })]);
  });

  it("rejects duplicate SKUs in the file but lets SKU-less rows insert freely", () => {
    const plan = buildMaterialImportPlan(
      [
        { name: "A", sku: "D-1", stock_quantity: "1", cost_per_unit: "1" },
        { name: "B", sku: "d-1", stock_quantity: "1", cost_per_unit: "1" },
        { name: "C", stock_quantity: "1", cost_per_unit: "1" },
      ],
      [], suppliers, 0, null,
    );
    expect(plan.rejected).toHaveLength(2);
    expect(plan.rejected[0].reason).toMatch(/Duplicate SKU/);
    expect(plan.inserts.map(i => i.name)).toEqual(["C"]);
  });

  it("links a named supplier and rejects unknown supplier names", () => {
    const plan = buildMaterialImportPlan(
      [
        { name: "A", stock_quantity: "1", cost_per_unit: "1", supplier: "Olu Farms" },
        { name: "B", stock_quantity: "1", cost_per_unit: "1", supplier: "Ghost Ltd" },
      ],
      [], suppliers, 0, null,
    );
    expect(plan.inserts).toEqual([expect.objectContaining({ name: "A", supplier_id: "sup1" })]);
    expect(plan.rejected[0].reason).toMatch(/Supplier "Ghost Ltd" not found/);
  });
});

describe("buildPoImportPlan", () => {
  const suppliers = [{ id: "sup1", name: "Olu Farms" }];

  it("groups rows sharing an Order Ref into one multi-line PO", () => {
    const plan = buildPoImportPlan(
      [
        { "Order Ref": "A", "Supplier": "Olu Farms", "Expected Date": "2026-07-15", "Description": "Flour", "Quantity": "10", "Unit Cost": "8,500" },
        { "Order Ref": "a", "Description": "Sugar", "Quantity": "4", "Unit Cost": "12000" },
      ],
      suppliers, 0, null,
    );
    expect(plan.pos).toHaveLength(1);
    expect(plan.pos[0]).toMatchObject({ supplier_id: "sup1", expected_date: "2026-07-15", total_amount: 10 * 8500 + 4 * 12000 });
    expect(plan.pos[0].items).toHaveLength(2);
  });

  it("rows without a ref each become their own PO", () => {
    const plan = buildPoImportPlan(
      [
        { description: "Flour", quantity: "1", unit_cost: "10" },
        { description: "Sugar", quantity: "2", unit_cost: "20" },
      ],
      suppliers, 0, null,
    );
    expect(plan.pos).toHaveLength(2);
  });

  it("rejects zero quantity, malformed dates and unknown suppliers per-row", () => {
    const plan = buildPoImportPlan(
      [
        { description: "Flour", quantity: "0", unit_cost: "10" },
        { description: "Sugar", quantity: "1", unit_cost: "10", expected_date: "15/07/2026" },
        { description: "Salt", quantity: "1", unit_cost: "10", supplier: "Ghost Ltd" },
      ],
      suppliers, 0, null,
    );
    expect(plan.pos).toHaveLength(0);
    expect(plan.rejected.map(r => r.reason)).toEqual([
      expect.stringMatching(/Invalid Quantity — must be above zero/),
      expect.stringMatching(/Invalid Expected Date — use YYYY-MM-DD/),
      expect.stringMatching(/Supplier "Ghost Ltd" not found/),
    ]);
  });

  it("rejects a whole group when one ref names two different suppliers", () => {
    const plan = buildPoImportPlan(
      [
        { "order ref": "A", supplier: "Olu Farms", description: "Flour", quantity: "1", unit_cost: "10" },
        { "order ref": "A", supplier: "Other Ltd", description: "Sugar", quantity: "1", unit_cost: "10" },
      ],
      [...suppliers, { id: "sup2", name: "Other Ltd" }], 0, null,
    );
    expect(plan.pos).toHaveLength(0);
    expect(plan.rejected).toHaveLength(2);
    expect(plan.rejected[0].reason).toMatch(/Conflicting suppliers/);
  });

  it("caps whole POs (not lines) at the plan limit", () => {
    const plan = buildPoImportPlan(
      [
        { "order ref": "A", description: "L1", quantity: "1", unit_cost: "1" },
        { "order ref": "A", description: "L2", quantity: "1", unit_cost: "1" },
        { "order ref": "B", description: "L3", quantity: "1", unit_cost: "1" },
      ],
      suppliers, 0, 1,
    );
    expect(plan.pos).toHaveLength(1);
    expect(plan.pos[0].items).toHaveLength(2);
    expect(plan.rejected).toHaveLength(1);
    expect(plan.rejected[0].reason).toMatch(/Plan limit reached/);
  });
});

describe("buildTeamImportPlan", () => {
  it("accepts manager/cashier rows and normalises email casing", () => {
    const plan = buildTeamImportPlan(
      [{ "Email": "Ada@Example.com", "Role": "Cashier" }],
      [], [], 1, null,
    );
    expect(plan.invites).toEqual([{ email: "ada@example.com", role: "cashier" }]);
  });

  it("rejects bad emails, unknown roles, existing members and pending invites", () => {
    const plan = buildTeamImportPlan(
      [
        { email: "not-an-email", role: "cashier" },
        { email: "a@b.co", role: "owner" },
        { email: "member@b.co", role: "cashier" },
        { email: "pending@b.co", role: "manager" },
      ],
      ["member@b.co"], ["pending@b.co"], 1, null,
    );
    expect(plan.invites).toHaveLength(0);
    expect(plan.rejected.map(r => r.reason)).toEqual([
      expect.stringMatching(/Invalid Email/),
      expect.stringMatching(/Invalid Role — use manager or cashier/),
      expect.stringMatching(/Already a team member/),
      expect.stringMatching(/An invitation for this email is already pending/),
    ]);
  });

  it("rejects every copy of an email duplicated in the file", () => {
    const plan = buildTeamImportPlan(
      [
        { email: "dup@b.co", role: "cashier" },
        { email: "DUP@b.co", role: "manager" },
      ],
      [], [], 1, null,
    );
    expect(plan.invites).toHaveLength(0);
    expect(plan.rejected).toHaveLength(2);
    expect(plan.rejected[0].reason).toMatch(/Duplicate email in file/);
  });

  it("caps invitations at the seat limit", () => {
    const plan = buildTeamImportPlan(
      [
        { email: "a@b.co", role: "cashier" },
        { email: "b@b.co", role: "cashier" },
      ],
      [], [], 2, 3,
    );
    expect(plan.invites).toHaveLength(1);
    expect(plan.rejected[0].reason).toMatch(/Plan limit reached/);
  });
});
