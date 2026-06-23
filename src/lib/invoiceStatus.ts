export const INVOICE_STATUSES = ["draft", "issued", "paid", "void"] as const;

type StatusInput = { sale_id?: string | null; status: string };
type OverdueInput = { status: string; due_date: string | null };

/** POS invoices, and any invoice already paid, are limited to paid/void. */
export function statusOptionsFor(inv: StatusInput): string[] {
  return inv.sale_id || inv.status === "paid" ? ["paid", "void"] : [...INVOICE_STATUSES];
}

/** `today` is an ISO date (YYYY-MM-DD), already resolved to the business timezone. */
export function isOverdue(inv: OverdueInput, today: string): boolean {
  return inv.status === "issued" && !!inv.due_date && inv.due_date < today;
}

export function overdueDays(dueDate: string, today: string): number {
  return Math.max(1, Math.round((Date.parse(today) - Date.parse(dueDate)) / 86_400_000));
}
