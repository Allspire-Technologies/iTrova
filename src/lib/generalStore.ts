import { supabase } from "@/integrations/supabase/client";

// The General Store tables/RPCs aren't in the generated Supabase types (types.ts isn't regenerated),
// so cast the client once rather than sprinkling `as any` everywhere.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export type StoreItemKind = "borrowable" | "consumable";
export type TxnKind = "borrow" | "collect";
export type TxnStatus = "out" | "partially_returned" | "returned" | "collected";

export type StoreStaff = { id: string; name: string; phone: string | null; role: string | null; active: boolean; created_at: string };
export type StoreItem = { id: string; name: string; category: string | null; unit: string | null; kind: StoreItemKind; stock_quantity: number; reorder_level: number; created_at: string };
export type StoreTransaction = {
  id: string; item_id: string; staff_id: string | null; kind: TxnKind; quantity: number; returned_quantity: number;
  status: TxnStatus; due_date: string | null; returned_at: string | null; notes: string | null; created_at: string;
  item?: { name: string; unit: string | null; kind: StoreItemKind } | null;
  staff?: { name: string } | null;
};

export const ITEM_KIND_LABEL: Record<StoreItemKind, string> = { borrowable: "Borrowable", consumable: "Consumable" };
export const TXN_STATUS_LABEL: Record<TxnStatus, string> = { out: "Out", partially_returned: "Partly returned", returned: "Returned", collected: "Collected" };

// ---------------------------------------------------------------- pure helpers
/** Units of a borrow still with the staff member (quantity minus what's been returned). */
export function outstanding(t: Pick<StoreTransaction, "quantity" | "returned_quantity">): number {
  return Math.max(0, (Number(t.quantity) || 0) - (Number(t.returned_quantity) || 0));
}

/** A borrow is overdue when it's still out and its due date has passed (today = YYYY-MM-DD). */
export function isOverdue(t: Pick<StoreTransaction, "kind" | "status" | "due_date">, today: string): boolean {
  return t.kind === "borrow" && (t.status === "out" || t.status === "partially_returned") && !!t.due_date && t.due_date < today;
}

/** Stock health for a store item, from available quantity vs reorder level. */
export function itemStatus(it: Pick<StoreItem, "stock_quantity" | "reorder_level">): "out" | "low" | "ok" {
  const s = Number(it.stock_quantity) || 0;
  if (s <= 0) return "out";
  if (s <= (Number(it.reorder_level) || 0)) return "low";
  return "ok";
}

// ---------------------------------------------------------------- staff
export async function listStaff(): Promise<StoreStaff[]> {
  const { data, error } = await sb.from("store_staff").select("*").order("name");
  if (error) throw error;
  return (data ?? []) as StoreStaff[];
}
export async function saveStaff(businessId: string, s: { id?: string; name: string; phone: string; role: string; active: boolean }): Promise<void> {
  const row = { name: s.name.trim(), phone: s.phone.trim() || null, role: s.role.trim() || null, active: s.active };
  const { error } = s.id
    ? await sb.from("store_staff").update(row).eq("id", s.id)
    : await sb.from("store_staff").insert({ ...row, business_id: businessId });
  if (error) throw error;
}
export async function deleteStaff(id: string): Promise<void> {
  const { error } = await sb.from("store_staff").delete().eq("id", id);
  if (error) throw error;
}

// ---------------------------------------------------------------- items
export async function listItems(): Promise<StoreItem[]> {
  const { data, error } = await sb.from("store_items").select("*").order("name");
  if (error) throw error;
  return (data ?? []) as StoreItem[];
}
export async function saveItem(businessId: string, it: { id?: string; name: string; category: string; unit: string; kind: StoreItemKind; stock_quantity: number; reorder_level: number }): Promise<void> {
  // Editing never touches stock — that's the "Add stock" action / borrow-collect flow.
  const base = { name: it.name.trim(), category: it.category.trim() || null, unit: it.unit.trim() || "pcs", kind: it.kind, reorder_level: Number(it.reorder_level) || 0 };
  const { error } = it.id
    ? await sb.from("store_items").update(base).eq("id", it.id)
    : await sb.from("store_items").insert({ ...base, stock_quantity: Number(it.stock_quantity) || 0, business_id: businessId });
  if (error) throw error;
}
export async function addItemStock(id: string, current: number, delta: number): Promise<void> {
  const { error } = await sb.from("store_items").update({ stock_quantity: (Number(current) || 0) + (Number(delta) || 0) }).eq("id", id);
  if (error) throw error;
}
export async function deleteItem(id: string): Promise<void> {
  const { error } = await sb.from("store_items").delete().eq("id", id);
  if (error) throw error;
}

// ---------------------------------------------------------------- transactions
export async function listTransactions(): Promise<StoreTransaction[]> {
  const { data, error } = await sb.from("store_transactions")
    .select("*, item:store_items(name,unit,kind), staff:store_staff(name)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as StoreTransaction[];
}
export async function checkout(businessId: string, p: { item_id: string; staff_id: string | null; kind: TxnKind; quantity: number; due_date: string | null; notes: string }): Promise<void> {
  const { error } = await sb.rpc("store_checkout", {
    _business_id: businessId, _item_id: p.item_id, _staff_id: p.staff_id, _kind: p.kind,
    _quantity: p.quantity, _due_date: p.due_date, _notes: p.notes || null,
  });
  if (error) throw error;
}
export async function returnBorrow(transactionId: string, quantity: number): Promise<void> {
  const { error } = await sb.rpc("store_return", { _transaction_id: transactionId, _quantity: quantity });
  if (error) throw error;
}

/** Map an RPC error message to a friendly one (server raises typed prefixes). */
export function friendlyStoreError(message: string | undefined, fallback: string): string {
  const m = message ?? "";
  if (m.includes("INSUFFICIENT_STOCK:")) return `Not enough stock for ${m.split("INSUFFICIENT_STOCK:")[1]?.trim() || "this item"}`;
  if (m.includes("WRONG_KIND:")) return `${m.split("WRONG_KIND:")[1]?.trim() || "This item"} can't be used that way`;
  if (m.includes("RETURN_TOO_MUCH:")) return `You can only return up to ${m.split("RETURN_TOO_MUCH:")[1]?.trim()}`;
  return m || fallback;
}
