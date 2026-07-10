import { supabase } from "@/integrations/supabase/client";
import { loadPdf } from "./pdf";

// The payroll_* tables postdate the generated Supabase types, so cast the client once (same pattern
// as generalStore.ts / expenditure.ts) rather than sprinkling `as any` everywhere.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export type PayType = "monthly" | "daily" | "hourly";
export const PAY_TYPES: { value: PayType; label: string; rateLabel: string }[] = [
  { value: "monthly", label: "Monthly salary", rateLabel: "Monthly salary" },
  { value: "daily", label: "Daily wage", rateLabel: "Rate per day" },
  { value: "hourly", label: "Hourly", rateLabel: "Rate per hour" },
];
export const PAY_TYPE_LABEL: Record<PayType, string> = { monthly: "Monthly", daily: "Daily", hourly: "Hourly" };

export type Deduction = { label: string; amount: number };

export type PayrollEmployee = {
  id: string;
  business_id: string;
  name: string;
  store_staff_id: string | null;
  user_id: string | null;
  pay_type: PayType;
  base_rate: number;
  bank_name: string | null;
  account_number: string | null;
  account_name: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
};

export type PayrollRun = {
  id: string;
  business_id: string;
  period_label: string;
  period_start: string | null;
  period_end: string | null;
  pay_date: string;
  status: "draft" | "posted";
  expense_id: string | null;
  gross_total: number;
  deduction_total: number;
  net_total: number;
  notes: string | null;
  created_at: string;
};

export type PayrollRunLine = {
  id: string;
  run_id: string;
  employee_id: string | null;
  employee_name: string;
  gross_pay: number;
  deductions: Deduction[];
  deduction_total: number;
  net_pay: number;
  notes: string | null;
};

/** A person you can enrol into payroll — sourced from General Store staff or a Team member. */
export type PayrollCandidate = {
  source: "store_staff" | "team";
  ref_id: string;        // store_staff.id or user_id
  name: string;
  role: string | null;
};

// ---------------------------------------------------------------- pure helpers (unit-tested)
function round2(n: number): number {
  return Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;
}

/** Sum of a set of deduction amounts (rounded to 2dp). Only `amount` is read. */
export function deductionTotal(deductions: { amount: number; label?: string }[]): number {
  return round2((deductions ?? []).reduce((s, d) => s + (Number(d.amount) || 0), 0));
}

/** Net pay for one line = gross − deductions (2dp). Can be zero; never NaN. */
export function lineNet(gross: number, deductions: { amount: number; label?: string }[]): number {
  return round2((Number(gross) || 0) - deductionTotal(deductions));
}

/** Gross pay implied by an employee's pay type + rate for the given period effort. */
export function grossFor(payType: PayType, baseRate: number, opts?: { days?: number; hours?: number }): number {
  const rate = Number(baseRate) || 0;
  if (payType === "daily") return round2(rate * (Number(opts?.days) || 0));
  if (payType === "hourly") return round2(rate * (Number(opts?.hours) || 0));
  return round2(rate); // monthly
}

/** Run totals from its lines — powers the footer, the posted expense, and the ledger. */
export function summarisePayroll(
  lines: { gross_pay: number; deductions?: { amount: number; label?: string }[] }[],
): { grossTotal: number; deductionTotal: number; netTotal: number } {
  let grossTotal = 0, dedTotal = 0, netTotal = 0;
  for (const l of lines) {
    const g = round2(Number(l.gross_pay) || 0);
    const d = deductionTotal(l.deductions ?? []);
    grossTotal += g;
    dedTotal += d;
    netTotal += round2(g - d);
  }
  return { grossTotal: round2(grossTotal), deductionTotal: round2(dedTotal), netTotal: round2(netTotal) };
}

export function friendlyPayrollError(message: string | undefined, fallback: string): string {
  const m = message ?? "";
  if (m.includes("ALREADY_POSTED")) return "This pay run has already been posted.";
  if (m.includes("NO_LINES")) return "Add at least one employee before posting.";
  if (m.includes("row-level security") || m.includes("permission") || m.includes("PERMISSION_DENIED"))
    return "You don't have permission to do that.";
  return m || fallback;
}

// ---------------------------------------------------------------- employees registry
export async function listEmployees(): Promise<PayrollEmployee[]> {
  const { data, error } = await sb.from("payroll_employees").select("*").order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as PayrollEmployee[];
}

export type EmployeeInput = {
  name: string; store_staff_id: string | null; user_id: string | null;
  pay_type: PayType; base_rate: number;
  bank_name: string | null; account_number: string | null; account_name: string | null;
  notes: string | null; active: boolean;
};

export async function saveEmployee(businessId: string, id: string | null, input: EmployeeInput): Promise<void> {
  const { error } = id
    ? await sb.from("payroll_employees").update(input).eq("id", id)
    : await sb.from("payroll_employees").insert({ ...input, business_id: businessId });
  if (error) throw new Error(error.message);
}

export async function deleteEmployee(id: string): Promise<void> {
  const { error } = await sb.from("payroll_employees").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** People available to enrol: active General Store staff + Team members (names via profiles). */
export async function listCandidates(businessId: string): Promise<PayrollCandidate[]> {
  const [{ data: staff }, { data: roles }] = await Promise.all([
    sb.from("store_staff").select("id,name,role,active").eq("active", true).order("name"),
    supabase.from("user_roles").select("user_id, role").eq("business_id", businessId),
  ]);
  const out: PayrollCandidate[] = ((staff ?? []) as { id: string; name: string; role: string | null }[])
    .map((s) => ({ source: "store_staff" as const, ref_id: s.id, name: s.name, role: s.role }));

  const userIds = Array.from(new Set(((roles ?? []) as { user_id: string }[]).map((r) => r.user_id)));
  if (userIds.length) {
    const { data: profs } = await supabase.from("profiles").select("id, owner_name").in("id", userIds);
    const nameById = Object.fromEntries(((profs ?? []) as { id: string; owner_name: string | null }[]).map((p) => [p.id, p.owner_name]));
    const roleById = Object.fromEntries(((roles ?? []) as { user_id: string; role: string }[]).map((r) => [r.user_id, r.role]));
    for (const uid of userIds) {
      out.push({ source: "team", ref_id: uid, name: nameById[uid] || "Team member", role: roleById[uid] ?? null });
    }
  }
  return out;
}

// ---------------------------------------------------------------- pay runs
export async function listRuns(): Promise<PayrollRun[]> {
  const { data, error } = await sb.from("payroll_runs").select("*").order("pay_date", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as PayrollRun[];
}

export async function getRunLines(runId: string): Promise<PayrollRunLine[]> {
  const { data, error } = await sb.from("payroll_run_lines").select("*").eq("run_id", runId).order("employee_name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((l: PayrollRunLine) => ({ ...l, deductions: (l.deductions ?? []) as Deduction[] })) as PayrollRunLine[];
}

export type RunInput = {
  period_label: string; period_start: string | null; period_end: string | null; pay_date: string; notes: string | null;
};
export type RunLineInput = {
  employee_id: string | null; employee_name: string;
  gross_pay: number; deductions: Deduction[]; notes: string | null;
};

/** Create or replace a draft run with its lines. Totals are computed here (source of truth). */
export async function saveRun(
  businessId: string, userId: string | null, id: string | null, run: RunInput, lines: RunLineInput[],
): Promise<string> {
  const totals = summarisePayroll(lines);
  const runRow = { ...run, gross_total: totals.grossTotal, deduction_total: totals.deductionTotal, net_total: totals.netTotal };

  let runId = id;
  if (runId) {
    const { error } = await sb.from("payroll_runs").update(runRow).eq("id", runId);
    if (error) throw new Error(error.message);
    const { error: delErr } = await sb.from("payroll_run_lines").delete().eq("run_id", runId);
    if (delErr) throw new Error(delErr.message);
  } else {
    const { data, error } = await sb.from("payroll_runs")
      .insert({ ...runRow, business_id: businessId, status: "draft", created_by: userId })
      .select("id").single();
    if (error) throw new Error(error.message);
    runId = (data as { id: string }).id;
  }

  if (lines.length) {
    const rows = lines.map((l) => ({
      business_id: businessId, run_id: runId, employee_id: l.employee_id, employee_name: l.employee_name,
      gross_pay: Number(l.gross_pay) || 0, deductions: l.deductions ?? [],
      deduction_total: deductionTotal(l.deductions ?? []), net_pay: lineNet(l.gross_pay, l.deductions ?? []),
      notes: l.notes,
    }));
    const { error } = await sb.from("payroll_run_lines").insert(rows);
    if (error) throw new Error(error.message);
  }
  return runId as string;
}

export async function deleteRun(id: string): Promise<void> {
  const { error } = await sb.from("payroll_runs").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Post a draft run to Expenditure via the guarded RPC — creates the aggregate Salaries expense. */
export async function postRun(runId: string, paymentMethod: string, markPaid: boolean): Promise<void> {
  const { error } = await sb.rpc("post_payroll_run", { _run_id: runId, _payment_method: paymentMethod || null, _mark_paid: markPaid });
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------- payslip PDF
// ASCII currency code (jsPDF's Latin-1 core fonts can't render ₦) — matches lib/pdf.ts.
function pdfMoney(currency?: string): (n: number) => string {
  const code = (currency || "NGN").toUpperCase();
  try {
    const nf = new Intl.NumberFormat("en-US", { style: "currency", currency: code, currencyDisplay: "code", minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (n) => nf.format(Number(n) || 0);
  } catch {
    return (n) => `${code} ${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}

export async function downloadPayslipPdf(
  line: PayrollRunLine, run: Pick<PayrollRun, "period_label" | "pay_date">,
  business: { name?: string | null; currency?: string | null; tin?: string | null },
  filename: string,
): Promise<void> {
  const { jsPDF, autoTable } = await loadPdf();
  const money = pdfMoney(business.currency ?? undefined);
  const doc = new jsPDF();

  doc.setFontSize(16); doc.text(business.name || "Payslip", 14, 18);
  doc.setFontSize(11); doc.setTextColor(110);
  doc.text(`Payslip · ${run.period_label}`, 14, 25);
  if (business.tin) doc.text(`TIN: ${business.tin}`, 14, 31);
  doc.setTextColor(0);

  doc.setFontSize(12);
  doc.text(line.employee_name, 14, business.tin ? 42 : 38);
  doc.setFontSize(10); doc.setTextColor(110);
  doc.text(`Pay date: ${run.pay_date}`, 14, business.tin ? 48 : 44);
  doc.setTextColor(0);

  const body: (string | number)[][] = [["Gross pay", money(line.gross_pay)]];
  for (const d of line.deductions ?? []) body.push([`  Less: ${d.label || "Deduction"}`, `- ${money(d.amount)}`]);

  autoTable(doc, {
    startY: business.tin ? 54 : 50,
    head: [["Earnings & deductions", "Amount"]],
    body,
    foot: [["Net pay", money(line.net_pay)]],
    theme: "grid", headStyles: { fillColor: [22, 101, 52] },
    footStyles: { fillColor: [240, 240, 240], textColor: 0, fontStyle: "bold" },
  });

  doc.save(filename);
}
