/** Statuses a user can set by hand. `partial` is excluded — only the payment RPC sets it. */
export const INVOICE_STATUSES = ["draft", "issued", "paid", "void"] as const;

/** All statuses an invoice can hold, including the system-managed `partial`. Used for filtering. */
export const INVOICE_STATUS_FILTERS = ["draft", "issued", "partial", "paid", "void"] as const;

type StatusInput = { sale_id?: string | null; status: string };
type OverdueInput = { status: string; due_date: string | null };

/**
 * POS invoices, and any invoice already paid, are limited to paid/void.
 * Once a manual invoice has a deposit (`partial`), the only manual move is to void it —
 * completing it happens by recording the remaining payment, not the dropdown.
 */
export function statusOptionsFor(inv: StatusInput): string[] {
  if (inv.status === "partial") return ["partial", "void"];
  return inv.sale_id || inv.status === "paid" ? ["paid", "void"] : [...INVOICE_STATUSES];
}

/** `today` is an ISO date (YYYY-MM-DD), already resolved to the business timezone. */
export function isOverdue(inv: OverdueInput, today: string): boolean {
  return inv.status === "issued" && !!inv.due_date && inv.due_date < today;
}

export function overdueDays(dueDate: string, today: string): number {
  return Math.max(1, Math.round((Date.parse(today) - Date.parse(dueDate)) / 86_400_000));
}
