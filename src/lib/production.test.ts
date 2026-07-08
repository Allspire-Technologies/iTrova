import { describe, it, expect, vi } from "vitest";

// production.ts imports the Supabase client transitively; stub it so importing the module doesn't
// require env (these tests exercise only the pure helpers).
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));

import {
  canTransition, materialDeltas, validateLines, requisitionShortfalls, friendlyProductionError,
  type RequisitionStatus,
} from "./production";

describe("canTransition", () => {
  const statuses: RequisitionStatus[] = ["pending", "approved", "rejected", "cancelled", "completed"];
  it("approve/reject only from pending", () => {
    for (const s of statuses) {
      expect(canTransition(s, "approve")).toBe(s === "pending");
      expect(canTransition(s, "reject")).toBe(s === "pending");
    }
  });
  it("cancel from pending or approved", () => {
    for (const s of statuses) expect(canTransition(s, "cancel")).toBe(s === "pending" || s === "approved");
  });
  it("produce only from approved", () => {
    for (const s of statuses) expect(canTransition(s, "produce")).toBe(s === "approved");
  });
  it("requester edit/delete only while pending", () => {
    for (const s of statuses) {
      expect(canTransition(s, "edit")).toBe(s === "pending");
      expect(canTransition(s, "delete")).toBe(s === "pending");
    }
  });
});

describe("materialDeltas", () => {
  const issued = [{ raw_material_id: "m1", quantity: 10 }, { raw_material_id: "m2", quantity: 4 }];
  it("partial use restocks the remainder (negative delta)", () => {
    const d = materialDeltas(issued, [{ raw_material_id: "m1", quantity: 7 }, { raw_material_id: "m2", quantity: 4 }]);
    expect(d).toEqual([{ raw_material_id: "m1", delta: -3 }]);
  });
  it("overuse deducts the extra (positive delta)", () => {
    const d = materialDeltas(issued, [{ raw_material_id: "m1", quantity: 12 }, { raw_material_id: "m2", quantity: 4 }]);
    expect(d).toEqual([{ raw_material_id: "m1", delta: 2 }]);
  });
  it("an issued material omitted from usage fully restocks", () => {
    const d = materialDeltas(issued, [{ raw_material_id: "m1", quantity: 10 }]);
    expect(d).toEqual([{ raw_material_id: "m2", delta: -4 }]);
  });
  it("an extra material not issued deducts in full", () => {
    const d = materialDeltas([], [{ raw_material_id: "m9", quantity: 5 }]);
    expect(d).toEqual([{ raw_material_id: "m9", delta: 5 }]);
  });
  it("exact usage yields no deltas", () => {
    expect(materialDeltas(issued, issued.map(i => ({ ...i })))).toEqual([]);
  });
  it("waste counts as consumption on top of usage (extra deduct)", () => {
    // m1: 10 issued, 7 used + 5 wasted = 12 consumed → deduct 2 more.
    const d = materialDeltas(issued, [{ raw_material_id: "m1", quantity: 7, wasted: 5 }, { raw_material_id: "m2", quantity: 4 }]);
    expect(d).toEqual([{ raw_material_id: "m1", delta: 2 }]);
  });
  it("used + wasted exactly matching issued nets to zero", () => {
    const d = materialDeltas([{ raw_material_id: "m1", quantity: 10 }], [{ raw_material_id: "m1", quantity: 8, wasted: 2 }]);
    expect(d).toEqual([]);
  });
});

describe("validateLines", () => {
  it("accepts a clean set", () => {
    expect(validateLines([{ raw_material_id: "m1", quantity: 2 }])).toEqual([]);
  });
  it("flags empty, missing material, non-positive qty, and duplicates", () => {
    expect(validateLines([])).toContain("Add at least one material.");
    expect(validateLines([{ raw_material_id: "", quantity: 1 }])).toContain("Every line needs a material.");
    expect(validateLines([{ raw_material_id: "m1", quantity: 0 }])).toContain("Quantities must be greater than zero.");
    expect(validateLines([
      { raw_material_id: "m1", quantity: 1 }, { raw_material_id: "m1", quantity: 2 },
    ])).toContain("Each material can only appear once.");
  });
});

describe("requisitionShortfalls", () => {
  const stock = [
    { id: "m1", name: "Flour", stock_quantity: 5 },
    { id: "m2", name: "Sugar", stock_quantity: 50 },
  ];
  it("lists only materials short of the requested quantity", () => {
    const s = requisitionShortfalls(
      [{ raw_material_id: "m1", quantity_requested: 8 }, { raw_material_id: "m2", quantity_requested: 10 }],
      stock,
    );
    expect(s).toEqual([{ name: "Flour", requested: 8, available: 5 }]);
  });
  it("empty when everything is covered", () => {
    expect(requisitionShortfalls([{ raw_material_id: "m2", quantity_requested: 50 }], stock)).toEqual([]);
  });
});

describe("friendlyProductionError", () => {
  it("maps the typed prefixes", () => {
    expect(friendlyProductionError("INSUFFICIENT_STOCK:Flour", "x")).toBe("Not enough Flour in stock for this.");
    expect(friendlyProductionError("REQUISITION_NOT_PENDING", "x")).toBe("This request has already been decided.");
    expect(friendlyProductionError("REQUISITION_NOT_APPROVED", "x")).toBe("Only an approved request can be used for production.");
    expect(friendlyProductionError("REQUISITION_NOT_CANCELLABLE", "x")).toBe("This request can no longer be cancelled.");
    expect(friendlyProductionError("EMPTY_OUTPUTS", "x")).toBe("Add at least one product produced.");
  });
  it("falls back to the raw message, then the fallback", () => {
    expect(friendlyProductionError("weird db error", "fallback")).toBe("weird db error");
    expect(friendlyProductionError(undefined, "fallback")).toBe("fallback");
  });
});
