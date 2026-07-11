import { supabase } from "@/integrations/supabase/client";

// The ledger tables/RPCs postdate the generated Supabase types, so cast the client once.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";
export const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: "asset", label: "Asset" },
  { value: "liability", label: "Liability" },
  { value: "equity", label: "Equity" },
  { value: "income", label: "Income" },
  { value: "expense", label: "Expense" },
];
export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  asset: "Asset", liability: "Liability", equity: "Equity", income: "Income", expense: "Expense",
};

export interface Account {
  id: string;
  business_id: string;
  code: string;
  name: string;
  type: AccountType;
  is_system: boolean;
  active: boolean;
  created_at: string;
}
export interface JournalLine {
  id?: string;
  account_id: string;
  debit: number;
  credit: number;
  description?: string | null;
  account?: { code: string; name: string; type: AccountType } | null;
}
export interface JournalEntry {
  id: string;
  entry_date: string;
  memo: string | null;
  source: "manual" | "opening" | "sale" | "expense" | "payment" | "payroll" | "purchase";
  source_id: string | null;
  created_at: string;
  lines: JournalLine[];
}

function round2(n: number): number {
  return Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;
}

// ---------------------------------------------------------------- pure helpers (unit-tested)
/** Assets and expenses increase on the debit side; liabilities, equity and income on the credit side. */
export function normalBalanceFor(type: AccountType): "debit" | "credit" {
  return type === "asset" || type === "expense" ? "debit" : "credit";
}

/** A journal entry is valid when debits = credits, it isn't empty, and no line is both a debit and a credit. */
export function validateEntryLines(lines: { debit: number; credit: number }[]): { ok: boolean; reason?: string } {
  let d = 0, c = 0;
  for (const l of lines) {
    const dv = Number(l.debit) || 0, cv = Number(l.credit) || 0;
    if (dv < 0 || cv < 0) return { ok: false, reason: "Amounts can't be negative." };
    if (dv > 0 && cv > 0) return { ok: false, reason: "A line is either a debit or a credit, not both." };
    d += dv; c += cv;
  }
  if (round2(d) === 0 && round2(c) === 0) return { ok: false, reason: "Enter at least one debit and one credit." };
  if (round2(d) !== round2(c)) return { ok: false, reason: `Debits (${round2(d)}) must equal credits (${round2(c)}).` };
  return { ok: true };
}

export interface TrialBalanceRow { account: Account; debit: number; credit: number }
export interface TrialBalance { rows: TrialBalanceRow[]; totalDebit: number; totalCredit: number; balanced: boolean }

/** Net each account's postings to a single-sided balance, drop zero accounts, and total the columns. */
export function buildTrialBalance(
  accounts: Account[],
  lines: { account_id: string; debit: number; credit: number }[],
): TrialBalance {
  const net = new Map<string, number>(); // debit − credit
  for (const l of lines) {
    net.set(l.account_id, (net.get(l.account_id) ?? 0) + (Number(l.debit) || 0) - (Number(l.credit) || 0));
  }
  const rows: TrialBalanceRow[] = [];
  let totalDebit = 0, totalCredit = 0;
  for (const account of [...accounts].sort((a, b) => a.code.localeCompare(b.code))) {
    const n = round2(net.get(account.id) ?? 0);
    if (n === 0) continue;
    if (n > 0) { rows.push({ account, debit: n, credit: 0 }); totalDebit += n; }
    else { rows.push({ account, debit: 0, credit: -n }); totalCredit += -n; }
  }
  return { rows, totalDebit: round2(totalDebit), totalCredit: round2(totalCredit), balanced: round2(totalDebit) === round2(totalCredit) };
}

export function friendlyLedgerError(message: string | undefined, fallback: string): string {
  const m = message ?? "";
  if (m.includes("UNBALANCED")) return "Debits and credits must be equal.";
  if (m.includes("EMPTY_ENTRY")) return "Add at least one debit and one credit line.";
  if (m.includes("ACCOUNT_NOT_FOUND")) return "One of the selected accounts no longer exists.";
  if (m.includes("row-level security") || m.includes("permission") || m.includes("PERMISSION_DENIED"))
    return "You don't have permission to do that.";
  return m || fallback;
}

// ---------------------------------------------------------------- data layer
export async function ensureChart(): Promise<void> {
  const { error } = await sb.rpc("ensure_chart_of_accounts");
  if (error) throw new Error(error.message);
}

export async function listAccounts(): Promise<Account[]> {
  const { data, error } = await sb.from("accounts").select("*").order("code");
  if (error) throw new Error(error.message);
  return (data ?? []) as Account[];
}

export async function saveAccount(businessId: string, id: string | null, input: { code: string; name: string; type: AccountType; active: boolean }): Promise<void> {
  const row = { code: input.code.trim(), name: input.name.trim(), type: input.type, active: input.active };
  const { error } = id
    ? await sb.from("accounts").update(row).eq("id", id)
    : await sb.from("accounts").insert({ ...row, business_id: businessId });
  if (error) throw new Error(error.message);
}

export async function deleteAccount(id: string): Promise<void> {
  const { error } = await sb.from("accounts").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export type EntryLineInput = { account_id: string; debit: number; credit: number; description?: string | null };

export async function postManualJournal(entryDate: string, memo: string, lines: EntryLineInput[]): Promise<void> {
  const { error } = await sb.rpc("post_journal", { _entry_date: entryDate, _memo: memo || null, _lines: lines });
  if (error) throw new Error(error.message);
}

/** All journal lines in a window, for the Trial Balance (joined to their entry's date + account). */
export async function fetchLines(fromIso: string, toIso: string): Promise<{ account_id: string; debit: number; credit: number }[]> {
  const { data, error } = await sb.from("journal_lines")
    .select("account_id,debit,credit,journal_entries!inner(entry_date)")
    .gte("journal_entries.entry_date", fromIso).lte("journal_entries.entry_date", toIso);
  if (error) throw new Error(error.message);
  return (data ?? []) as { account_id: string; debit: number; credit: number }[];
}

export async function listEntries(fromIso: string, toIso: string): Promise<JournalEntry[]> {
  const { data, error } = await sb.from("journal_entries")
    .select("id,entry_date,memo,source,source_id,created_at,journal_lines(id,account_id,debit,credit,description,accounts(code,name,type))")
    .gte("entry_date", fromIso).lte("entry_date", toIso)
    .order("entry_date", { ascending: false }).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((e: Record<string, unknown>) => ({
    ...e,
    lines: ((e.journal_lines ?? []) as Record<string, unknown>[]).map((l) => ({ ...l, account: l.accounts })),
  })) as unknown as JournalEntry[];
}
