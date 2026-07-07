import { supabase } from "@/integrations/supabase/client";

// Production module data layer. The production tables/RPCs postdate the generated Supabase types,
// so calls go through one localized cast (same pattern as generalStore.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export type RecipeLine = {
  id?: string;
  product_id: string;
  raw_material_id: string;
  quantity_per_unit: number;
  raw_materials?: { name: string; unit: string | null } | null;
};

export type Recipe = {
  product_id: string;
  product_name: string;
  product_unit: string | null;
  lines: RecipeLine[];
};

export type RequisitionStatus = "pending" | "approved" | "rejected" | "cancelled" | "completed";

export type RequisitionItem = {
  id: string;
  raw_material_id: string;
  quantity_requested: number;
  quantity_issued: number | null;
  raw_materials?: { name: string; unit: string | null } | null;
};

export type Requisition = {
  id: string;
  status: RequisitionStatus;
  requested_by: string | null;
  notes: string | null;
  decision_note: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  production_requisition_items: RequisitionItem[];
};

export type Run = {
  id: string;
  requisition_id: string | null;
  produced_by: string | null;
  notes: string | null;
  created_at: string;
  production_run_outputs: { product_id: string; quantity: number; products?: { name: string; unit: string | null } | null }[];
  production_run_materials: { raw_material_id: string; quantity_used: number; raw_materials?: { name: string; unit: string | null } | null }[];
};

export const REQUISITION_STATUS_LABEL: Record<RequisitionStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
  completed: "Completed",
};

export const REQUISITION_STATUS_CLASS: Record<RequisitionStatus, string> = {
  pending: "bg-warning/10 text-warning border-warning/20",
  approved: "bg-brand-light text-brand-dark border-brand/20",
  rejected: "bg-danger/10 text-danger border-danger/20",
  cancelled: "bg-muted text-muted-foreground border-border",
  completed: "bg-brand-light text-brand-dark border-brand/20",
};

// ---------------------------------------------------------------- pure helpers (unit-tested)

/** Which actions make sense for a requisition in this status (mirrors the RPC guards).
 *  edit/delete additionally require being the requester — the caller checks that. */
export function canTransition(status: RequisitionStatus, action: "approve" | "reject" | "cancel" | "produce" | "edit" | "delete"): boolean {
  switch (action) {
    case "approve":
    case "reject":
    case "edit":
    case "delete":
      return status === "pending";
    case "cancel":
      return status === "pending" || status === "approved";
    case "produce":
      return status === "approved";
  }
}

/**
 * Per-material stock delta when a run completes against a requisition: positive = extra to
 * deduct, negative = unused remainder to restock. Mirrors the SQL reconciliation loop.
 */
export function materialDeltas(
  issued: { raw_material_id: string; quantity: number }[],
  used: { raw_material_id: string; quantity: number }[],
): { raw_material_id: string; delta: number }[] {
  const map = new Map<string, number>();
  for (const i of issued) map.set(i.raw_material_id, (map.get(i.raw_material_id) ?? 0) - i.quantity);
  for (const u of used) map.set(u.raw_material_id, (map.get(u.raw_material_id) ?? 0) + u.quantity);
  return [...map.entries()]
    .filter(([, delta]) => delta !== 0)
    .map(([raw_material_id, delta]) => ({ raw_material_id, delta }));
}

/** Problems in a set of recipe/request lines (empty = valid). */
export function validateLines(lines: { raw_material_id: string; quantity: number }[]): string[] {
  const problems: string[] = [];
  if (lines.length === 0) problems.push("Add at least one material.");
  if (lines.some((l) => !l.raw_material_id)) problems.push("Every line needs a material.");
  if (lines.some((l) => !(Number(l.quantity) > 0))) problems.push("Quantities must be greater than zero.");
  const ids = lines.map((l) => l.raw_material_id).filter(Boolean);
  if (new Set(ids).size !== ids.length) problems.push("Each material can only appear once.");
  return problems;
}

/** Materials whose requested quantity exceeds current stock (warn before approving). */
export function requisitionShortfalls(
  items: { raw_material_id: string; quantity_requested: number }[],
  stock: { id: string; name: string; stock_quantity: number }[],
): { name: string; requested: number; available: number }[] {
  const byId = new Map(stock.map((m) => [m.id, m]));
  return items.flatMap((i) => {
    const m = byId.get(i.raw_material_id);
    if (!m || Number(m.stock_quantity) >= Number(i.quantity_requested)) return [];
    return [{ name: m.name, requested: Number(i.quantity_requested), available: Number(m.stock_quantity) }];
  });
}

/** Map the RPCs' typed errors to human copy. */
export function friendlyProductionError(message: string | undefined, fallback: string): string {
  const msg = message ?? "";
  if (msg.includes("INSUFFICIENT_STOCK:")) {
    const name = msg.split("INSUFFICIENT_STOCK:")[1]?.trim() || "a material";
    return `Not enough ${name} in stock for this.`;
  }
  if (msg.includes("REQUISITION_NOT_PENDING")) return "This request has already been decided.";
  if (msg.includes("NOT_YOUR_REQUEST")) return "Only the person who made this request can change it.";
  if (msg.includes("APPROVE_QTY_INVALID")) return "Approved quantities must be above zero and no more than what was requested.";
  if (msg.includes("REQUISITION_REQUIRED")) return "Production must be recorded against an approved materials request.";
  if (msg.includes("REQUISITION_NOT_APPROVED")) return "Only an approved request can be used for production.";
  if (msg.includes("REQUISITION_NOT_CANCELLABLE")) return "This request can no longer be cancelled.";
  if (msg.includes("EMPTY_ITEMS")) return "Add at least one material.";
  if (msg.includes("EMPTY_OUTPUTS")) return "Add at least one product produced.";
  if (msg.includes("BAD_QUANTITY")) return "Quantities must be greater than zero.";
  if (msg.includes("MATERIAL_NOT_FOUND")) return "One of the materials no longer exists.";
  if (msg.includes("PRODUCT_NOT_FOUND")) return "One of the products no longer exists.";
  return msg || fallback;
}

// ---------------------------------------------------------------- data access

export async function listRecipes(): Promise<Recipe[]> {
  const { data, error } = await sb
    .from("product_materials")
    .select("id, product_id, raw_material_id, quantity_per_unit, products(name, unit), raw_materials(name, unit)");
  if (error) throw new Error(error.message);
  const byProduct = new Map<string, Recipe>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of (data ?? []) as any[]) {
    const r = byProduct.get(row.product_id) ?? {
      product_id: row.product_id,
      product_name: row.products?.name ?? "Product",
      product_unit: row.products?.unit ?? null,
      lines: [],
    };
    r.lines.push({
      id: row.id, product_id: row.product_id, raw_material_id: row.raw_material_id,
      quantity_per_unit: Number(row.quantity_per_unit), raw_materials: row.raw_materials ?? null,
    });
    byProduct.set(row.product_id, r);
  }
  return [...byProduct.values()].sort((a, b) => a.product_name.localeCompare(b.product_name));
}

/** Replace a product's recipe with the given lines (delete + insert — small sets). */
export async function saveRecipe(productId: string, lines: { raw_material_id: string; quantity_per_unit: number }[]): Promise<void> {
  const del = await sb.from("product_materials").delete().eq("product_id", productId);
  if (del.error) throw new Error(del.error.message);
  if (lines.length === 0) return;
  const ins = await sb.from("product_materials").insert(
    lines.map((l) => ({ product_id: productId, raw_material_id: l.raw_material_id, quantity_per_unit: l.quantity_per_unit })),
  );
  if (ins.error) throw new Error(ins.error.message);
}

export async function listRequisitions(): Promise<Requisition[]> {
  const { data, error } = await sb
    .from("production_requisitions")
    .select("*, production_requisition_items(id, raw_material_id, quantity_requested, quantity_issued, raw_materials(name, unit))")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Requisition[];
}

export async function listRuns(): Promise<Run[]> {
  const { data, error } = await sb
    .from("production_runs")
    .select("*, production_run_outputs(product_id, quantity, products(name, unit)), production_run_materials(raw_material_id, quantity_used, raw_materials(name, unit))")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Run[];
}

// ---------------------------------------------------------------- RPC wrappers

export async function createRequisition(businessId: string, items: { raw_material_id: string; quantity: number }[], notes: string): Promise<void> {
  const { error } = await sb.rpc("create_requisition", { _business_id: businessId, _items: items, _notes: notes || null });
  if (error) throw new Error(error.message);
}

export async function updateRequisition(id: string, items: { raw_material_id: string; quantity: number }[], notes: string): Promise<void> {
  const { error } = await sb.rpc("update_requisition", { _requisition_id: id, _items: items, _notes: notes || null });
  if (error) throw new Error(error.message);
}

export async function deleteRequisition(id: string): Promise<void> {
  const { error } = await sb.rpc("delete_requisition", { _requisition_id: id });
  if (error) throw new Error(error.message);
}

/** Approve and issue — the approver may reduce quantities (0 < qty ≤ requested) per material. */
export async function approveRequisition(id: string, items: { raw_material_id: string; quantity: number }[]): Promise<void> {
  const { error } = await sb.rpc("approve_requisition", { _requisition_id: id, _items: items });
  if (error) throw new Error(error.message);
}

export async function rejectRequisition(id: string, reason: string): Promise<void> {
  const { error } = await sb.rpc("reject_requisition", { _requisition_id: id, _reason: reason || null });
  if (error) throw new Error(error.message);
}

export async function cancelRequisition(id: string): Promise<void> {
  const { error } = await sb.rpc("cancel_requisition", { _requisition_id: id });
  if (error) throw new Error(error.message);
}

export async function recordProductionRun(args: {
  businessId: string;
  requisitionId: string | null;
  outputs: { product_id: string; quantity: number }[];
  materials: { raw_material_id: string; quantity_used: number }[];
  notes: string;
}): Promise<void> {
  const { error } = await sb.rpc("record_production_run", {
    _business_id: args.businessId,
    _requisition_id: args.requisitionId,
    _outputs: args.outputs,
    _materials: args.materials,
    _notes: args.notes || null,
  });
  if (error) throw new Error(error.message);
}
