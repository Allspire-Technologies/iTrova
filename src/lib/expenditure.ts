import { supabase } from "@/integrations/supabase/client";
import { loadPdf } from "./pdf";

// The expenses table postdates the generated Supabase types, so cast the client once (same pattern
// as generalStore.ts / exportInvoice.ts) rather than sprinkling `as any`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export type ExpenseStatus = "paid" | "pending";

export type Expense = {
  id: string;
  business_id: string;
  expense_date: string;
  category: string;
  amount: number;
  payment_method: string | null;
  payee: string | null;
  supplier_id: string | null;
  description: string | null;
  status: ExpenseStatus;
  due_date: string | null;
  paid_date: string | null;
  receipt_ref: string | null;
  tax_amount: number; // input VAT portion of `amount` (from the supplier bill); 0 when none
  created_by: string | null;
  created_at: string;
};

/** Curated defaults; the category field also accepts anything the business types (custom). */
export const EXPENSE_CATEGORIES = [
  "Rent", "Utilities", "Salaries", "Transport", "Supplies",
  "Marketing", "Repairs", "Bank charges", "Tax/levies", "Other",
];

export const EXPENSE_PAYMENT_METHODS = ["cash", "transfer", "card", "mobile money", "cheque", "other"];

export const EXPENSE_STATUS_LABEL: Record<ExpenseStatus, string> = { paid: "Paid", pending: "Pending" };

// ---------------------------------------------------------------- pure helpers (unit-tested)

/** Sum of a set of expense amounts. */
export function periodTotal(expenses: Pick<Expense, "amount">[]): number {
  return expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
}

/** Spend grouped by category, highest first — powers the summary + the PDF breakdown. */
export function byCategory(expenses: Pick<Expense, "category" | "amount">[]): { category: string; total: number }[] {
  const map = new Map<string, number>();
  for (const e of expenses) {
    const key = (e.category || "Uncategorised").trim() || "Uncategorised";
    map.set(key, (map.get(key) ?? 0) + (Number(e.amount) || 0));
  }
  return [...map.entries()].map(([category, total]) => ({ category, total })).sort((a, b) => b.total - a.total);
}

/** A pending bill is overdue once its due date has passed (today = YYYY-MM-DD). */
export function isOverdue(e: Pick<Expense, "status" | "due_date">, today: string): boolean {
  return e.status === "pending" && !!e.due_date && e.due_date < today;
}

/** Display status: paid, overdue (pending + past due) or pending. */
export function displayStatus(e: Pick<Expense, "status" | "due_date">, today: string): "paid" | "overdue" | "pending" {
  if (e.status === "paid") return "paid";
  return isOverdue(e, today) ? "overdue" : "pending";
}

/** Net profit = gross profit − expenses (supplier spend stays a separate line, not re-subtracted). */
export function netProfit(grossProfit: number, expenses: number): number {
  return (Number(grossProfit) || 0) - (Number(expenses) || 0);
}

export function friendlyExpenseError(message: string | undefined, fallback: string): string {
  const msg = message ?? "";
  if (msg.includes("row-level security") || msg.includes("permission")) return "You don't have permission to do that.";
  return msg || fallback;
}

// ---------------------------------------------------------------- data access

export async function listExpenses(fromIso: string, toIso: string): Promise<Expense[]> {
  const { data, error } = await sb.from("expenses")
    .select("id,business_id,expense_date,category,amount,payment_method,payee,supplier_id,description,status,due_date,paid_date,receipt_ref,tax_amount,created_by,created_at")
    .gte("expense_date", fromIso).lte("expense_date", toIso)
    .order("expense_date", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Expense[];
}

export type ExpenseInput = {
  expense_date: string; category: string; amount: number; payment_method: string | null;
  payee: string | null; supplier_id: string | null; description: string | null;
  status: ExpenseStatus; due_date: string | null; paid_date: string | null; receipt_ref: string | null;
  tax_amount: number; // input VAT (of which VAT); 0 when none
};

export async function saveExpense(businessId: string, userId: string | null, id: string | null, input: ExpenseInput): Promise<void> {
  const row = { ...input, updated_at: new Date().toISOString() };
  const { error } = id
    ? await sb.from("expenses").update(row).eq("id", id)
    : await sb.from("expenses").insert({ ...row, business_id: businessId, created_by: userId });
  if (error) throw new Error(error.message);
}

export async function deleteExpense(id: string): Promise<void> {
  const { error } = await sb.from("expenses").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Bulk insert for CSV import — returns the error (not throwing) so the page can track failed rows. */
export async function insertExpenseBatch(
  businessId: string, userId: string | null, rows: Record<string, unknown>[],
): Promise<{ error: { message: string } | null }> {
  const { error } = await sb.from("expenses").insert(rows.map(r => ({ ...r, business_id: businessId, created_by: userId })));
  return { error: error ?? null };
}

/** Lightweight fetch for the Reports Net-profit + input-VAT tie-in (by expense_date; both periods). */
export async function fetchExpensesForReport(
  businessId: string, fromDate: string, toDate: string,
): Promise<{ expense_date: string; amount: number; tax_amount: number }[]> {
  const { data, error } = await sb.from("expenses").select("expense_date,amount,tax_amount")
    .eq("business_id", businessId).gte("expense_date", fromDate).lte("expense_date", toDate);
  if (error) return [];
  return (data ?? []) as { expense_date: string; amount: number; tax_amount: number }[];
}

// ---------------------------------------------------------------- PDF export
// Small dedicated report (the shared invoice PdfDocInput doesn't fit a line-item expense list);
// reuses the same lazy jsPDF+autotable loader so nothing extra loads at startup.
export async function downloadExpensesPdf(
  expenses: Expense[],
  meta: { businessName: string; from: string; to: string; fmt: (n: number) => string },
  filename: string,
): Promise<void> {
  const { jsPDF, autoTable } = await loadPdf();
  const doc = new jsPDF();
  doc.setFontSize(16); doc.text(meta.businessName || "Expenditure", 14, 18);
  doc.setFontSize(11); doc.setTextColor(110);
  doc.text(`Expenditure report · ${meta.from} → ${meta.to}`, 14, 25);
  doc.setTextColor(0);

  const cats = byCategory(expenses);
  const total = periodTotal(expenses);
  const totalVat = expenses.reduce((s, e) => s + (Number(e.tax_amount) || 0), 0);
  const hasVat = totalVat > 0; // only surface VAT when some was recorded

  autoTable(doc, {
    startY: 32,
    head: [["Category", "Total"]],
    body: cats.map(c => [c.category, meta.fmt(c.total)]),
    foot: hasVat ? [["Total", meta.fmt(total)], ["of which input VAT", meta.fmt(totalVat)]] : [["Total", meta.fmt(total)]],
    theme: "grid", headStyles: { fillColor: [22, 101, 52] }, footStyles: { fillColor: [240, 240, 240], textColor: 0, fontStyle: "bold" },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const afterY = (doc as any).lastAutoTable?.finalY ?? 60;
  autoTable(doc, {
    startY: afterY + 8,
    head: [hasVat ? ["Date", "Category", "Payee", "Status", "Amount", "VAT"] : ["Date", "Category", "Payee", "Status", "Amount"]],
    body: expenses.map(e => {
      const row = [e.expense_date, e.category, e.payee || "—", EXPENSE_STATUS_LABEL[e.status], meta.fmt(Number(e.amount) || 0)];
      if (hasVat) row.push(meta.fmt(Number(e.tax_amount) || 0));
      return row;
    }),
    theme: "striped", headStyles: { fillColor: [22, 101, 52] }, styles: { fontSize: 9 },
  });

  doc.save(filename);
}
