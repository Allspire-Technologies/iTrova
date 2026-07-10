import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/hooks/useCurrency";
import { useDateFormat } from "@/hooks/useDateFormat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import SearchableSelect from "@/components/SearchableSelect";
import ConfirmDialog from "@/components/ConfirmDialog";
import { PayrollSkeleton } from "@/components/Skeletons";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Users, Plus, Pencil, Trash2, MoreHorizontal, FileDown, Send, Eye, X, Wallet,
} from "lucide-react";
import {
  listEmployees, saveEmployee, deleteEmployee, listCandidates,
  listRuns, getRunLines, saveRun, deleteRun, postRun, downloadPayslipPdf,
  deductionTotal, lineNet, grossFor, summarisePayroll, friendlyPayrollError,
  PAY_TYPES, PAY_TYPE_LABEL,
  type PayrollEmployee, type PayrollRun, type PayrollRunLine, type PayrollCandidate,
  type PayType, type Deduction, type RunLineInput,
} from "@/lib/payroll";
import { EXPENSE_PAYMENT_METHODS } from "@/lib/expenditure";

// ---- editable models (strings while typing) ------------------------------------------------
type EditDeduction = { label: string; amount: string };
type EditLine = { key: string; employee_id: string | null; employee_name: string; gross_pay: string; deductions: EditDeduction[]; notes: string };
type RunEditor = {
  id: string | null; period_label: string; period_start: string; period_end: string;
  pay_date: string; notes: string; lines: EditLine[];
};

const todayStr = () => new Date().toISOString().slice(0, 10);
const monthLabel = (iso: string) => {
  const d = new Date(iso + "T00:00:00");
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
};
const num = (s: string) => Number(s) || 0;
const uid = () => Math.random().toString(36).slice(2);

const emptyEmployeeForm = {
  id: null as string | null, name: "", store_staff_id: null as string | null, user_id: null as string | null,
  pay_type: "monthly" as PayType, base_rate: "", bank_name: "", account_number: "", account_name: "",
  notes: "", active: true, source: "manual" as "manual" | "store_staff" | "team",
};
type EmployeeForm = typeof emptyEmployeeForm;

export default function PayrollPanel() {
  const { business, user, can } = useAuth();
  const { fmt, symbol } = useCurrency();
  const { fmtDate } = useDateFormat();

  const canCreate = can("expenditure", "create");
  const canEdit = can("expenditure", "edit");
  const canDelete = can("expenditure", "delete");

  const [subtab, setSubtab] = useState<"runs" | "employees">("runs");
  const [employees, setEmployees] = useState<PayrollEmployee[] | null>(null);
  const [runs, setRuns] = useState<PayrollRun[] | null>(null);
  const [candidates, setCandidates] = useState<PayrollCandidate[]>([]);

  // employee dialog
  const [empForm, setEmpForm] = useState<EmployeeForm | null>(null);
  const [empBusy, setEmpBusy] = useState(false);

  // run editor + view
  const [editor, setEditor] = useState<RunEditor | null>(null);
  const [runBusy, setRunBusy] = useState(false);
  const [viewRun, setViewRun] = useState<{ run: PayrollRun; lines: PayrollRunLine[] } | null>(null);

  // post dialog
  const [posting, setPosting] = useState<{ run: PayrollRun; payment_method: string; mark_paid: boolean } | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; description: string; onConfirm: () => void } | null>(null);

  const reloadEmployees = useCallback(() => listEmployees().then(setEmployees).catch((e) => toast.error(friendlyPayrollError(e?.message, "Couldn't load employees"))), []);
  const reloadRuns = useCallback(() => listRuns().then(setRuns).catch((e) => toast.error(friendlyPayrollError(e?.message, "Couldn't load pay runs"))), []);
  useEffect(() => { reloadEmployees(); reloadRuns(); }, [reloadEmployees, reloadRuns]);

  const activeEmployees = useMemo(() => (employees ?? []).filter((e) => e.active), [employees]);

  // -------------------------------------------------------------------- employees
  const openEnrol = async () => {
    setEmpForm({ ...emptyEmployeeForm });
    if (business) {
      try { setCandidates(await listCandidates(business.id)); } catch { /* candidates optional */ }
    }
  };
  const openEditEmployee = (e: PayrollEmployee) => setEmpForm({
    id: e.id, name: e.name, store_staff_id: e.store_staff_id, user_id: e.user_id,
    pay_type: e.pay_type, base_rate: e.base_rate ? String(e.base_rate) : "",
    bank_name: e.bank_name || "", account_number: e.account_number || "", account_name: e.account_name || "",
    notes: e.notes || "", active: e.active,
    source: e.store_staff_id ? "store_staff" : e.user_id ? "team" : "manual",
  });

  // Already-enrolled refs, so the candidate picker doesn't offer duplicates.
  const enrolledRefs = useMemo(() => new Set((employees ?? []).flatMap((e) => [e.store_staff_id, e.user_id].filter(Boolean) as string[])), [employees]);
  const candidateOptions = useMemo(() => candidates
    .filter((c) => !enrolledRefs.has(c.ref_id) || (empForm?.store_staff_id === c.ref_id || empForm?.user_id === c.ref_id))
    .map((c) => ({ value: `${c.source}:${c.ref_id}`, label: `${c.name}${c.role ? ` · ${c.role}` : ""} — ${c.source === "team" ? "Team" : "Store staff"}` })), [candidates, enrolledRefs, empForm]);

  const pickCandidate = (val: string) => {
    if (!empForm) return;
    if (val === "manual") { setEmpForm({ ...empForm, source: "manual", store_staff_id: null, user_id: null }); return; }
    const [source, refId] = val.split(/:(.*)/s);
    const c = candidates.find((x) => x.source === source && x.ref_id === refId);
    setEmpForm({
      ...empForm, source: source as "store_staff" | "team",
      store_staff_id: source === "store_staff" ? refId : null,
      user_id: source === "team" ? refId : null,
      name: empForm.name.trim() || c?.name || "",
    });
  };

  const submitEmployee = async () => {
    if (!business || !empForm) return;
    if (!empForm.name.trim()) return toast.error("Enter a name");
    setEmpBusy(true);
    try {
      await saveEmployee(business.id, empForm.id, {
        name: empForm.name.trim(), store_staff_id: empForm.store_staff_id, user_id: empForm.user_id,
        pay_type: empForm.pay_type, base_rate: num(empForm.base_rate),
        bank_name: empForm.bank_name.trim() || null, account_number: empForm.account_number.trim() || null,
        account_name: empForm.account_name.trim() || null, notes: empForm.notes.trim() || null, active: empForm.active,
      });
      toast.success(empForm.id ? "Employee updated" : "Employee enrolled");
      setEmpForm(null); reloadEmployees();
    } catch (e) { toast.error(friendlyPayrollError((e as Error)?.message, "Couldn't save employee")); }
    finally { setEmpBusy(false); }
  };

  const removeEmployee = (e: PayrollEmployee) => setConfirm({
    title: `Remove ${e.name} from payroll?`, description: "Their past pay runs and payslips stay intact.",
    onConfirm: async () => { try { await deleteEmployee(e.id); toast.success("Employee removed"); reloadEmployees(); } catch (err) { toast.error(friendlyPayrollError((err as Error)?.message, "Couldn't remove")); } },
  });

  // -------------------------------------------------------------------- run editor
  const lineFromEmployee = (e: PayrollEmployee): EditLine => ({
    key: uid(), employee_id: e.id, employee_name: e.name,
    // Monthly pre-fills the salary; daily/hourly need effort, so start blank for the user to enter.
    gross_pay: e.pay_type === "monthly" ? String(grossFor("monthly", e.base_rate)) : "",
    deductions: [], notes: "",
  });

  const openNewRun = () => {
    if (activeEmployees.length === 0) { toast.error("Enrol at least one employee first"); setSubtab("employees"); return; }
    const pay = todayStr();
    setEditor({ id: null, period_label: monthLabel(pay), period_start: "", period_end: "", pay_date: pay, notes: "", lines: activeEmployees.map(lineFromEmployee) });
  };

  const openEditRun = async (run: PayrollRun) => {
    try {
      const lines = await getRunLines(run.id);
      setEditor({
        id: run.id, period_label: run.period_label, period_start: run.period_start || "", period_end: run.period_end || "",
        pay_date: run.pay_date, notes: run.notes || "",
        lines: lines.map((l) => ({ key: uid(), employee_id: l.employee_id, employee_name: l.employee_name, gross_pay: String(l.gross_pay), deductions: (l.deductions ?? []).map((d) => ({ label: d.label, amount: String(d.amount) })), notes: l.notes || "" })),
      });
    } catch (e) { toast.error(friendlyPayrollError((e as Error)?.message, "Couldn't open the pay run")); }
  };

  const patchLine = (key: string, patch: Partial<EditLine>) =>
    setEditor((ed) => ed && ({ ...ed, lines: ed.lines.map((l) => l.key === key ? { ...l, ...patch } : l) }));
  const addDeduction = (key: string) => setEditor((ed) => ed && ({ ...ed, lines: ed.lines.map((l) => l.key === key ? { ...l, deductions: [...l.deductions, { label: "", amount: "" }] } : l) }));
  const patchDeduction = (key: string, i: number, patch: Partial<EditDeduction>) =>
    setEditor((ed) => ed && ({ ...ed, lines: ed.lines.map((l) => l.key === key ? { ...l, deductions: l.deductions.map((d, di) => di === i ? { ...d, ...patch } : d) } : l) }));
  const removeDeduction = (key: string, i: number) =>
    setEditor((ed) => ed && ({ ...ed, lines: ed.lines.map((l) => l.key === key ? { ...l, deductions: l.deductions.filter((_, di) => di !== i) } : l) }));
  const removeLine = (key: string) => setEditor((ed) => ed && ({ ...ed, lines: ed.lines.filter((l) => l.key !== key) }));

  const addEmployeeToRun = (empId: string) => {
    const e = (employees ?? []).find((x) => x.id === empId);
    if (e) setEditor((ed) => ed && ({ ...ed, lines: [...ed.lines, lineFromEmployee(e)] }));
  };
  const employeesNotInRun = useMemo(() => {
    const inRun = new Set((editor?.lines ?? []).map((l) => l.employee_id).filter(Boolean));
    return activeEmployees.filter((e) => !inRun.has(e.id));
  }, [editor, activeEmployees]);

  const editorTotals = useMemo(() => summarisePayroll((editor?.lines ?? []).map((l) => ({ gross_pay: num(l.gross_pay), deductions: l.deductions.map((d) => ({ amount: num(d.amount) })) }))), [editor]);

  const linesForSave = (ed: RunEditor): RunLineInput[] => ed.lines.map((l) => ({
    employee_id: l.employee_id, employee_name: l.employee_name.trim() || "Employee",
    gross_pay: num(l.gross_pay), deductions: l.deductions.filter((d) => d.label.trim() || num(d.amount)).map((d): Deduction => ({ label: d.label.trim() || "Deduction", amount: num(d.amount) })),
    notes: l.notes.trim() || null,
  }));

  const saveDraft = async (): Promise<string | null> => {
    if (!business || !editor) return null;
    if (!editor.period_label.trim()) { toast.error("Enter a pay period (e.g. July 2026)"); return null; }
    if (editor.lines.length === 0) { toast.error("Add at least one employee"); return null; }
    setRunBusy(true);
    try {
      const id = await saveRun(business.id, user?.id ?? null, editor.id, {
        period_label: editor.period_label.trim(), period_start: editor.period_start || null, period_end: editor.period_end || null,
        pay_date: editor.pay_date, notes: editor.notes.trim() || null,
      }, linesForSave(editor));
      reloadRuns();
      return id;
    } catch (e) { toast.error(friendlyPayrollError((e as Error)?.message, "Couldn't save the pay run")); return null; }
    finally { setRunBusy(false); }
  };

  const onSaveDraft = async () => { const id = await saveDraft(); if (id) { toast.success("Draft saved"); setEditor(null); } };

  const removeRun = (run: PayrollRun) => setConfirm({
    title: run.status === "posted" ? `Delete ${run.period_label} pay run?` : `Delete this draft?`,
    description: run.status === "posted" ? "The pay run is removed. The Salaries expense it created stays in Expenditure — delete that separately if needed." : "This draft pay run will be removed.",
    onConfirm: async () => { try { await deleteRun(run.id); toast.success("Pay run deleted"); reloadRuns(); } catch (e) { toast.error(friendlyPayrollError((e as Error)?.message, "Couldn't delete")); } },
  });

  // -------------------------------------------------------------------- post
  const openPost = (run: PayrollRun) => setPosting({ run, payment_method: "transfer", mark_paid: true });
  const confirmPost = async () => {
    if (!posting) return;
    setRunBusy(true);
    try {
      await postRun(posting.run.id, posting.payment_method, posting.mark_paid);
      toast.success(`Posted ${fmt(posting.run.gross_total)} to Expenditure`);
      setPosting(null); reloadRuns();
    } catch (e) { toast.error(friendlyPayrollError((e as Error)?.message, "Couldn't post the pay run")); }
    finally { setRunBusy(false); }
  };

  const openView = async (run: PayrollRun) => {
    try { setViewRun({ run, lines: await getRunLines(run.id) }); }
    catch (e) { toast.error(friendlyPayrollError((e as Error)?.message, "Couldn't open the pay run")); }
  };

  const payslip = async (line: PayrollRunLine, run: PayrollRun) => {
    try {
      await downloadPayslipPdf(line, run, { name: business?.name, currency: business?.currency, tin: business?.tin },
        `payslip-${line.employee_name.replace(/\s+/g, "-").toLowerCase()}-${run.period_label.replace(/\s+/g, "-").toLowerCase()}.pdf`);
    } catch (e) { toast.error(friendlyPayrollError((e as Error)?.message, "Couldn't build the payslip")); }
  };

  if (employees === null || runs === null) return <PayrollSkeleton />;

  const STATUS = { draft: { label: "Draft", cls: "bg-warning/10 text-warning border-warning/20" }, posted: { label: "Posted", cls: "bg-brand-light text-brand-dark border-brand/20" } };

  return (
    <div className="space-y-4">
      {/* sub-tabs + primary action */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg bg-muted p-1">
          {(["runs", "employees"] as const).map((k) => (
            <button key={k} type="button" onClick={() => setSubtab(k)}
              className={cn("rounded-md px-3 py-1.5 text-sm font-medium transition-colors", subtab === k ? "bg-card text-brand-dark shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {k === "runs" ? "Pay runs" : "Employees"}
              <span className="ml-1.5 text-xs text-muted-foreground">{k === "runs" ? runs.length : employees.length}</span>
            </button>
          ))}
        </div>
        {canCreate && (subtab === "runs"
          ? <Button variant="hero" onClick={openNewRun}><Plus className="size-4" /> New pay run</Button>
          : <Button variant="hero" onClick={openEnrol}><Plus className="size-4" /> Enrol employee</Button>)}
      </div>

      {subtab === "runs" ? <RunsList /> : <EmployeesList />}

      {/* ============ Employee dialog ============ */}
      <Dialog open={!!empForm} onOpenChange={(o) => !o && setEmpForm(null)}>
        <DialogContent variant="wide">
          <DialogHeader><DialogTitle className="font-display">{empForm?.id ? "Edit employee" : "Enrol employee"}</DialogTitle></DialogHeader>
          {empForm && (
            <div className="space-y-4">
              {!empForm.id && (
                <div className="space-y-2">
                  <Label>Who is this? <span className="font-normal text-muted-foreground">(from your staff, or add manually)</span></Label>
                  <SearchableSelect
                    value={empForm.source === "manual" ? "manual" : `${empForm.source}:${empForm.store_staff_id || empForm.user_id}`}
                    onValueChange={pickCandidate}
                    placeholder="Pick a person or add manually"
                    options={[{ value: "manual", label: "➕ Add manually (type a name)" }, ...candidateOptions]}
                  />
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2"><Label>Name *</Label><Input value={empForm.name} onChange={(e) => setEmpForm({ ...empForm, name: e.target.value })} placeholder="Employee name" /></div>
                <div className="space-y-2">
                  <Label>Pay type</Label>
                  <SearchableSelect value={empForm.pay_type} onValueChange={(v) => setEmpForm({ ...empForm, pay_type: v as PayType })}
                    options={PAY_TYPES.map((p) => ({ value: p.value, label: p.label }))} />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>{PAY_TYPES.find((p) => p.value === empForm.pay_type)?.rateLabel} ({symbol})</Label>
                  <Input type="number" min="0" step="0.01" value={empForm.base_rate} onChange={(e) => setEmpForm({ ...empForm, base_rate: e.target.value })} placeholder="0" />
                </div>
                <div className="flex items-end gap-2 pb-1">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="size-4 accent-[hsl(var(--brand))]" checked={empForm.active} onChange={(e) => setEmpForm({ ...empForm, active: e.target.checked })} />
                    Active <span className="text-muted-foreground">(included in new pay runs)</span>
                  </label>
                </div>
              </div>
              <details className="rounded-lg border border-border/60 p-3">
                <summary className="cursor-pointer text-sm font-medium text-brand-dark">Bank details <span className="font-normal text-muted-foreground">(optional — shown on payslips)</span></summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <div className="space-y-2"><Label>Bank</Label><Input value={empForm.bank_name} onChange={(e) => setEmpForm({ ...empForm, bank_name: e.target.value })} /></div>
                  <div className="space-y-2"><Label>Account no.</Label><Input value={empForm.account_number} onChange={(e) => setEmpForm({ ...empForm, account_number: e.target.value })} /></div>
                  <div className="space-y-2"><Label>Account name</Label><Input value={empForm.account_name} onChange={(e) => setEmpForm({ ...empForm, account_name: e.target.value })} /></div>
                </div>
              </details>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEmpForm(null)}>Cancel</Button>
            <Button variant="brand" onClick={submitEmployee} disabled={empBusy}>{empBusy ? "Saving..." : empForm?.id ? "Save changes" : "Enrol"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============ Run editor ============ */}
      <Dialog open={!!editor} onOpenChange={(o) => !o && setEditor(null)}>
        <DialogContent variant="wide">
          <DialogHeader><DialogTitle className="font-display">{editor?.id ? "Edit pay run" : "New pay run"}</DialogTitle></DialogHeader>
          {editor && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-4">
                <div className="space-y-2 sm:col-span-2"><Label>Pay period *</Label><Input value={editor.period_label} onChange={(e) => setEditor({ ...editor, period_label: e.target.value })} placeholder="e.g. July 2026" /></div>
                <div className="space-y-2"><Label>Pay date</Label><Input type="date" value={editor.pay_date} onChange={(e) => setEditor({ ...editor, pay_date: e.target.value, period_label: editor.period_label.trim() ? editor.period_label : monthLabel(e.target.value) })} /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-2"><Label className="text-xs">Period from</Label><Input type="date" value={editor.period_start} onChange={(e) => setEditor({ ...editor, period_start: e.target.value })} /></div>
                  <div className="space-y-2"><Label className="text-xs">to</Label><Input type="date" value={editor.period_end} onChange={(e) => setEditor({ ...editor, period_end: e.target.value })} /></div>
                </div>
              </div>

              {/* employee pay lines */}
              <div className="space-y-2">
                {editor.lines.length === 0 && <p className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">No employees on this run yet.</p>}
                {editor.lines.map((l) => {
                  const net = lineNet(num(l.gross_pay), l.deductions.map((d) => ({ amount: num(d.amount) })));
                  return (
                    <div key={l.key} className="rounded-xl border border-border/60 bg-card p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="font-medium text-brand-dark">{l.employee_name}</p>
                        <div className="flex items-center gap-3">
                          <span className="text-sm text-muted-foreground">Net <span className="font-semibold text-brand-dark">{fmt(net)}</span></span>
                          <Button variant="ghost" size="icon" className="size-7" onClick={() => removeLine(l.key)} aria-label={`Remove ${l.employee_name}`}><X className="size-4" /></Button>
                        </div>
                      </div>
                      <div className="mt-2 grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Gross pay ({symbol})</Label>
                          <Input type="number" min="0" step="0.01" value={l.gross_pay} onChange={(e) => patchLine(l.key, { gross_pay: e.target.value })} placeholder="0" aria-label={`Gross pay for ${l.employee_name}`} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Deductions</Label>
                          <div className="space-y-1.5">
                            {l.deductions.map((d, i) => (
                              <div key={i} className="flex items-center gap-2">
                                <Input value={d.label} onChange={(e) => patchDeduction(l.key, i, { label: e.target.value })} placeholder="e.g. Tax, Advance" className="flex-1" aria-label={`Deduction label ${i + 1} for ${l.employee_name}`} />
                                <Input type="number" min="0" step="0.01" value={d.amount} onChange={(e) => patchDeduction(l.key, i, { amount: e.target.value })} placeholder="0" className="w-28" aria-label={`Deduction amount ${i + 1} for ${l.employee_name}`} />
                                <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={() => removeDeduction(l.key, i)} aria-label="Remove deduction"><X className="size-3.5" /></Button>
                              </div>
                            ))}
                            <Button type="button" variant="outline" size="sm" className="h-7" onClick={() => addDeduction(l.key)}><Plus className="size-3.5" /> Add deduction</Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {employeesNotInRun.length > 0 && (
                  <div className="pt-1">
                    <SearchableSelect value="" onValueChange={addEmployeeToRun} placeholder="+ Add an employee to this run"
                      options={employeesNotInRun.map((e) => ({ value: e.id, label: e.name }))} className="w-full sm:w-72" />
                  </div>
                )}
              </div>

              {/* totals */}
              <div className="flex flex-wrap justify-end gap-x-8 gap-y-1 rounded-xl bg-muted/50 p-4 text-sm">
                <span className="text-muted-foreground">Gross <span className="ml-1 font-semibold text-brand-dark">{fmt(editorTotals.grossTotal)}</span></span>
                <span className="text-muted-foreground">Deductions <span className="ml-1 font-semibold text-brand-dark">{fmt(editorTotals.deductionTotal)}</span></span>
                <span className="text-muted-foreground">Net pay <span className="ml-1 font-display text-base font-bold text-brand-dark">{fmt(editorTotals.netTotal)}</span></span>
              </div>
              <p className="text-xs text-muted-foreground">Posting records the <span className="font-medium">gross {fmt(editorTotals.grossTotal)}</span> as a Salaries expense (the full cost to the business). Deductions appear on payslips.</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditor(null)}>Cancel</Button>
            <Button variant="outline" onClick={onSaveDraft} disabled={runBusy}>Save draft</Button>
            <Button variant="brand" disabled={runBusy} onClick={async () => { const id = await saveDraft(); if (id) { setEditor(null); reloadRuns(); const r = (await listRuns()).find((x) => x.id === id); if (r) openPost(r); } }}>
              <Send className="size-4" /> Save &amp; post
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============ Post dialog ============ */}
      <Dialog open={!!posting} onOpenChange={(o) => !o && setPosting(null)}>
        <DialogContent variant="wide">
          <DialogHeader><DialogTitle className="font-display">Post to Expenditure</DialogTitle></DialogHeader>
          {posting && (
            <div className="space-y-4">
              <div className="rounded-lg bg-muted/50 p-4 text-sm">
                <p><span className="text-muted-foreground">Pay run:</span> <span className="font-medium text-brand-dark">{posting.run.period_label}</span></p>
                <p className="mt-1"><span className="text-muted-foreground">Gross salaries:</span> <span className="font-display font-bold text-brand-dark">{fmt(posting.run.gross_total)}</span></p>
                <p className="mt-1 text-xs text-muted-foreground">Creates one “Salaries” expense dated {fmtDate(posting.run.pay_date)}.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Payment method</Label>
                  <SearchableSelect value={posting.payment_method} onValueChange={(v) => setPosting({ ...posting, payment_method: v })}
                    options={EXPENSE_PAYMENT_METHODS.map((m) => ({ value: m, label: m.charAt(0).toUpperCase() + m.slice(1) }))} />
                </div>
                <div className="flex items-end pb-1">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="size-4 accent-[hsl(var(--brand))]" checked={posting.mark_paid} onChange={(e) => setPosting({ ...posting, mark_paid: e.target.checked })} />
                    Mark as paid <span className="text-muted-foreground">(else records a pending bill)</span>
                  </label>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPosting(null)}>Cancel</Button>
            <Button variant="brand" onClick={confirmPost} disabled={runBusy}><Send className="size-4" /> {runBusy ? "Posting..." : "Post payroll"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============ View run ============ */}
      <Dialog open={!!viewRun} onOpenChange={(o) => !o && setViewRun(null)}>
        <DialogContent variant="wide">
          <DialogHeader><DialogTitle className="font-display">{viewRun?.run.period_label} · payslips</DialogTitle></DialogHeader>
          {viewRun && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <span className="text-muted-foreground">Pay date <span className="ml-1 font-medium text-brand-dark">{fmtDate(viewRun.run.pay_date)}</span></span>
                <span className="text-muted-foreground">Gross <span className="ml-1 font-medium text-brand-dark">{fmt(viewRun.run.gross_total)}</span></span>
                <span className="text-muted-foreground">Net <span className="ml-1 font-semibold text-brand-dark">{fmt(viewRun.run.net_total)}</span></span>
                <Badge variant="outline" className={STATUS[viewRun.run.status].cls}>{STATUS[viewRun.run.status].label}</Badge>
              </div>
              <div className="divide-y rounded-xl border border-border/60">
                {viewRun.lines.map((l) => (
                  <div key={l.id} className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <p className="font-medium text-brand-dark truncate">{l.employee_name}</p>
                      <p className="text-xs text-muted-foreground">Gross {fmt(l.gross_pay)}{l.deduction_total > 0 ? ` · less ${fmt(l.deduction_total)}` : ""} · Net {fmt(l.net_pay)}</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => payslip(l, viewRun.run)}><FileDown className="size-4" /> Payslip</Button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setViewRun(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)} title={confirm?.title ?? ""} description={confirm?.description} confirmLabel="Delete" onConfirm={confirm?.onConfirm ?? (() => {})} />
    </div>
  );

  // ---------------------------------------------------------------- inner lists
  function RunsList() {
    if (runs!.length === 0) return (
      <div className="rounded-xl border border-dashed border-border bg-card/50 p-12 text-center">
        <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-brand-light text-brand"><Wallet className="size-6" /></div>
        <h3 className="font-display text-lg font-semibold text-brand-dark">No pay runs yet</h3>
        <p className="mb-4 mt-1 text-sm text-muted-foreground">Create a pay run to pay your team and post salaries to Expenditure.</p>
        {canCreate && <Button variant="brand" onClick={openNewRun}><Plus className="size-4" /> New pay run</Button>}
      </div>
    );
    const runActions = (r: PayrollRun) => {
      const more = [
        ...(canEdit && r.status === "draft" ? [{ label: "Edit", icon: <Pencil className="size-4 mr-2" />, onClick: () => openEditRun(r), cls: "" }] : []),
        ...(canCreate && r.status === "draft" ? [{ label: "Post to Expenditure", icon: <Send className="size-4 mr-2" />, onClick: () => openPost(r), cls: "" }] : []),
        ...(canDelete ? [{ label: "Delete", icon: <Trash2 className="size-4 mr-2" />, onClick: () => removeRun(r), cls: "text-destructive focus:text-destructive" }] : []),
      ];
      return (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => openView(r)}><Eye className="size-4" /> View</Button>
          {more.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" aria-label={`More actions for ${r.period_label}`}><MoreHorizontal className="size-4" /> More</Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {more.map((m, i) => <DropdownMenuItem key={i} className={m.cls} onClick={m.onClick}>{m.icon}{m.label}</DropdownMenuItem>)}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      );
    };
    return (
      <>
        {/* mobile cards */}
        <div className="space-y-2 sm:hidden">
          {runs!.map((r) => (
            <div key={r.id} className="rounded-xl border border-border/60 bg-card p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-brand-dark">{r.period_label}</p>
                  <p className="text-xs text-muted-foreground">Paid {fmtDate(r.pay_date)}</p>
                </div>
                <Badge variant="outline" className={STATUS[r.status].cls}>{STATUS[r.status].label}</Badge>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Net <span className="font-display font-semibold text-brand-dark">{fmt(r.net_total)}</span></span>
                <span className="text-xs text-muted-foreground">Gross {fmt(r.gross_total)}</span>
              </div>
              <div className="mt-2 border-t border-border/50 pt-2">{runActions(r)}</div>
            </div>
          ))}
        </div>
        {/* desktop table */}
        <div className="hidden overflow-x-auto rounded-xl border border-border/60 bg-card sm:block">
          <Table>
            <TableHeader><TableRow className="hover:bg-transparent">
              <TableHead>Period</TableHead><TableHead>Pay date</TableHead><TableHead>Status</TableHead>
              <TableHead className="text-right">Gross</TableHead><TableHead className="text-right">Net</TableHead><TableHead className="text-right">Actions</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {runs!.map((r) => (
                <TableRow key={r.id} className="hover:bg-transparent">
                  <TableCell className="font-medium text-brand-dark">{r.period_label}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDate(r.pay_date)}</TableCell>
                  <TableCell><Badge variant="outline" className={STATUS[r.status].cls}>{STATUS[r.status].label}</Badge></TableCell>
                  <TableCell className="text-right text-muted-foreground">{fmt(r.gross_total)}</TableCell>
                  <TableCell className="text-right font-display font-semibold text-brand-dark">{fmt(r.net_total)}</TableCell>
                  <TableCell className="text-right">{runActions(r)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </>
    );
  }

  function EmployeesList() {
    if (employees!.length === 0) return (
      <div className="rounded-xl border border-dashed border-border bg-card/50 p-12 text-center">
        <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-brand-light text-brand"><Users className="size-6" /></div>
        <h3 className="font-display text-lg font-semibold text-brand-dark">No employees enrolled</h3>
        <p className="mb-4 mt-1 text-sm text-muted-foreground">Enrol people from your General Store staff or Team, or add them manually.</p>
        {canCreate && <Button variant="brand" onClick={openEnrol}><Plus className="size-4" /> Enrol employee</Button>}
      </div>
    );
    const empActions = (e: PayrollEmployee) => (
      <div className="flex justify-end gap-1">
        {canEdit && <Button variant="ghost" size="sm" onClick={() => openEditEmployee(e)}><Pencil className="size-4" /> Edit</Button>}
        {canDelete && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" aria-label={`More actions for ${e.name}`}><MoreHorizontal className="size-4" /> More</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => removeEmployee(e)}><Trash2 className="size-4 mr-2" /> Remove</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    );
    const sourceBadge = (e: PayrollEmployee) => e.store_staff_id ? "Store staff" : e.user_id ? "Team" : "Manual";
    const rate = (e: PayrollEmployee) => `${fmt(e.base_rate)}${e.pay_type === "daily" ? "/day" : e.pay_type === "hourly" ? "/hr" : "/mo"}`;
    return (
      <>
        {/* mobile cards */}
        <div className="space-y-2 sm:hidden">
          {employees!.map((e) => (
            <div key={e.id} className="rounded-xl border border-border/60 bg-card p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className={cn("font-medium", e.active ? "text-brand-dark" : "text-muted-foreground line-through")}>{e.name}</p>
                  <p className="text-xs text-muted-foreground">{PAY_TYPE_LABEL[e.pay_type]} · {rate(e)}</p>
                </div>
                <Badge variant="secondary" className="shrink-0">{sourceBadge(e)}</Badge>
              </div>
              <div className="mt-2 border-t border-border/50 pt-2">{empActions(e)}</div>
            </div>
          ))}
        </div>
        {/* desktop table */}
        <div className="hidden overflow-x-auto rounded-xl border border-border/60 bg-card sm:block">
          <Table>
            <TableHeader><TableRow className="hover:bg-transparent">
              <TableHead>Name</TableHead><TableHead>Source</TableHead><TableHead>Pay type</TableHead>
              <TableHead className="text-right">Rate</TableHead><TableHead className="text-right">Actions</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {employees!.map((e) => (
                <TableRow key={e.id} className="hover:bg-transparent">
                  <TableCell><span className={cn("font-medium", e.active ? "text-brand-dark" : "text-muted-foreground line-through")}>{e.name}</span>{!e.active && <span className="ml-2 text-xs text-muted-foreground">(inactive)</span>}</TableCell>
                  <TableCell><Badge variant="secondary">{sourceBadge(e)}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{PAY_TYPE_LABEL[e.pay_type]}</TableCell>
                  <TableCell className="text-right whitespace-nowrap text-muted-foreground">{rate(e)}</TableCell>
                  <TableCell className="text-right">{empActions(e)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </>
    );
  }
}
