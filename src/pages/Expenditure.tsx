import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import SearchableSelect from "@/components/SearchableSelect";
import ConfirmDialog from "@/components/ConfirmDialog";
import Paginator, { usePagination } from "@/components/Paginator";
import { TablePageSkeleton } from "@/components/Skeletons";
import { ImportProgressDialog, ImportResultDialog, type FailedImportRow, type ImportOutcome, type ImportProgress } from "@/components/ImportDialogs";
import { toast } from "sonner";
import { Wallet, Plus, Search, Pencil, Trash2, Check, Upload, Download, FileDown, MoreHorizontal, CalendarClock } from "lucide-react";
import { useCurrency } from "@/hooks/useCurrency";
import { useDateFormat } from "@/hooks/useDateFormat";
import { toCsv, downloadCsv, parseCsv, readFileText } from "@/lib/csv";
import { EXPENSE_FIELDS, buildExpenseImportPlan, templateHeaders, templateValues } from "@/lib/csvImport";
import {
  listExpenses, saveExpense, deleteExpense, insertExpenseBatch, downloadExpensesPdf,
  periodTotal, byCategory, displayStatus, EXPENSE_CATEGORIES, EXPENSE_PAYMENT_METHODS,
  type Expense, type ExpenseStatus,
} from "@/lib/expenditure";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import PayrollPanel from "@/components/PayrollPanel";

type Supplier = { id: string; name: string };
type Form = {
  id: string | null; expense_date: string; category: string; categoryOther: string; amount: string;
  payment_method: string; payee: string; supplier_id: string; description: string;
  status: ExpenseStatus; due_date: string; receipt_ref: string; tax_amount: string;
};
const todayStr = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const emptyForm = (): Form => ({
  id: null, expense_date: todayStr(), category: "", categoryOther: "", amount: "", payment_method: "cash",
  payee: "", supplier_id: "", description: "", status: "paid", due_date: "", receipt_ref: "", tax_amount: "",
});
// Custom categories are stored/displayed as "Other: <label>". Split a stored value back into the
// dropdown selection + the free-text specifier.
const splitCategory = (c: string): { category: string; categoryOther: string } => {
  const m = /^other:\s*(.+)$/i.exec(c.trim());
  return m ? { category: "Other", categoryOther: m[1] } : { category: c, categoryOther: "" };
};

const STATUS_BADGE: Record<"paid" | "pending" | "overdue", { label: string; className: string }> = {
  paid:    { label: "Paid",    className: "bg-brand-light text-brand-dark border-brand/20" },
  pending: { label: "Pending", className: "bg-warning/10 text-warning border-warning/20" },
  overdue: { label: "Overdue", className: "bg-danger/10 text-danger border-danger/20" },
};

export default function Expenditure() {
  const { business, user, hasModule, can } = useAuth();
  const { fmt, symbol } = useCurrency();
  const { fmtDate } = useDateFormat();
  const taxEnabled = !!business?.tax_enabled;
  const [searchParams] = useSearchParams();

  const canCreate = can("expenditure", "create");
  const canEdit = can("expenditure", "edit");
  const canDelete = can("expenditure", "delete");
  const canExportPdf = can("expenditure", "export");
  const canExportCsv = can("expenditure", "csv_export");
  const canImport = can("expenditure", "csv_import");

  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(todayStr());
  const [items, setItems] = useState<Expense[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") === "pending" ? "pending" : "all");
  const [tab, setTab] = useState<"expenses" | "payroll">(searchParams.get("tab") === "payroll" ? "payroll" : "expenses");

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(emptyForm());
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<Expense | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const [importResult, setImportResult] = useState<ImportOutcome | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);

  const timezone = business?.timezone || "Africa/Lagos";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());

  const load = useCallback(async () => {
    if (!business) return;
    try {
      const [rows, { data: sup }] = await Promise.all([
        listExpenses(from, to),
        supabase.from("suppliers").select("id,name").order("name"),
      ]);
      setItems(rows);
      setSuppliers((sup as Supplier[]) ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't load expenses");
    } finally {
      setLoading(false);
    }
  }, [business, from, to]);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => { setForm(emptyForm()); setOpen(true); };
  const openEdit = (e: Expense) => {
    setForm({
      id: e.id, expense_date: e.expense_date, ...splitCategory(e.category), amount: String(e.amount),
      payment_method: e.payment_method || "cash", payee: e.payee || "", supplier_id: e.supplier_id || "",
      description: e.description || "", status: e.status, due_date: e.due_date || "", receipt_ref: e.receipt_ref || "",
      tax_amount: e.tax_amount ? String(e.tax_amount) : "",
    });
    setOpen(true);
  };

  const save = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!business) return;
    if (!form.category.trim()) return toast.error("Pick a category.");
    if (form.category === "Other" && !form.categoryOther.trim()) return toast.error("Say what the 'Other' expense is.");
    if (!(Number(form.amount) > 0)) return toast.error("Enter an amount greater than zero.");
    const finalCategory = form.category === "Other" ? `Other: ${form.categoryOther.trim()}` : form.category;
    setBusy(true);
    try {
      await saveExpense(business.id, user?.id ?? null, form.id, {
        expense_date: form.expense_date, category: finalCategory, amount: Number(form.amount),
        payment_method: form.payment_method || null, payee: form.payee.trim() || null,
        supplier_id: form.supplier_id || null, description: form.description.trim() || null,
        status: form.status, due_date: form.status === "pending" ? (form.due_date || null) : null,
        paid_date: form.status === "paid" ? form.expense_date : null,
        receipt_ref: form.receipt_ref.trim() || null,
        tax_amount: taxEnabled ? (Number(form.tax_amount) || 0) : 0,
      });
      toast.success(form.id ? "Expense updated" : "Expense added");
      setOpen(false); load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save the expense");
    } finally {
      setBusy(false);
    }
  };

  const markPaid = async (e: Expense) => {
    try {
      await saveExpense(business!.id, user?.id ?? null, e.id, {
        expense_date: e.expense_date, category: e.category, amount: Number(e.amount),
        payment_method: e.payment_method, payee: e.payee, supplier_id: e.supplier_id,
        description: e.description, status: "paid", due_date: null, paid_date: today, receipt_ref: e.receipt_ref,
        tax_amount: Number(e.tax_amount) || 0,
      });
      toast.success("Marked as paid"); load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update");
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await deleteExpense(deleting.id);
      toast.success("Expense deleted"); setDeleting(null); load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete");
    }
  };

  // ---- filtered view + summaries
  const filtered = useMemo(() => items.filter(e => {
    if (categoryFilter !== "all" && e.category !== categoryFilter) return false;
    if (statusFilter !== "all" && displayStatus(e, today) !== statusFilter && !(statusFilter === "pending" && displayStatus(e, today) === "overdue")) return false;
    if (q) {
      const hay = `${e.category} ${e.payee ?? ""} ${e.description ?? ""}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  }), [items, categoryFilter, statusFilter, q, today]);

  const total = periodTotal(filtered);
  const cats = byCategory(filtered).slice(0, 4);
  const pending = items.filter(e => e.status === "pending");
  const overdueCount = pending.filter(e => displayStatus(e, today) === "overdue").length;
  const categoryOptions = [...new Set([...EXPENSE_CATEGORIES, ...items.map(e => e.category)])].filter(Boolean);
  // The Add/Edit dropdown: curated + any legacy custom already used (customs going forward are "Other: …").
  const categoryFormOptions = [...new Set([...EXPENSE_CATEGORIES, ...items.map(e => e.category).filter(c => c && !/^other:/i.test(c))])];
  const { paged, page, setPage, pageSize, setPageSize, pageCount, total: totalRows } = usePagination(filtered, 20);

  // ---- CSV / PDF export
  const CSV_HEADERS = [...templateHeaders(EXPENSE_FIELDS)];
  const exportCsv = () => {
    const rows = filtered.map(e => ({
      "Date": e.expense_date, "Category": e.category, "Amount": e.amount, "VAT": e.tax_amount ?? 0,
      "Payment Method": e.payment_method || "", "Payee": e.payee || "", "Description": e.description || "",
      "Status": e.status, "Due Date": e.due_date || "",
    }));
    downloadCsv(`expenses-${todayStr()}.csv`, toCsv(rows, CSV_HEADERS));
    toast.success(`Exported ${rows.length} expense${rows.length === 1 ? "" : "s"}`);
  };
  const exportPdf = async () => {
    try {
      await downloadExpensesPdf(filtered, { businessName: business?.name || "Expenditure", from, to, fmt }, `expenses-${todayStr()}.pdf`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't build the PDF");
    }
  };

  // ---- CSV import
  const downloadTemplate = () => {
    const example = ["2026-07-01", "Rent", "150000", "0", "transfer", "Landlord", "July shop rent", "paid", ""];
    downloadCsv("expenses-template.csv", [CSV_HEADERS.join(","), example.join(",")].join("\n"));
    toast.success("Template downloaded");
  };
  const importCsv = async (file: File) => {
    if (!business) return;
    try {
      const rows = parseCsv(await readFileText(file));
      const plan = buildExpenseImportPlan(rows);
      if (plan.inserts.length === 0 && plan.rejected.length === 0) return toast.error("No rows found in the file.");
      const failed: FailedImportRow[] = plan.rejected.map(r => ({ values: templateValues(r.row, EXPENSE_FIELDS), reason: r.reason }));

      const BATCH = 100;
      const batches: (typeof plan.inserts)[] = [];
      for (let i = 0; i < plan.inserts.length; i += BATCH) batches.push(plan.inserts.slice(i, i + BATCH));
      let done = 0; const tick = () => setImportProgress({ done: ++done, total: batches.length });
      if (batches.length) setImportProgress({ done: 0, total: batches.length });

      let added = 0;
      for (const batch of batches) {
        const { error } = await insertExpenseBatch(business.id, user?.id ?? null, batch as unknown as Record<string, unknown>[]);
        if (error) batch.forEach(i => failed.push({ values: { "Date": i.expense_date, "Category": i.category, "Amount": String(i.amount) }, reason: `Upload failed: ${error.message}` }));
        else added += batch.length;
        tick();
      }
      setImportProgress(null);
      setImportResult({ imported: added, failed });
      load();
    } catch (e) {
      setImportProgress(null);
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const downloadFailedRows = () => {
    if (!importResult?.failed.length) return;
    const cols = [...CSV_HEADERS, "Reason"];
    const rows = importResult.failed.map(f => ({ ...f.values, "Reason": f.reason }));
    downloadCsv(`expenses-not-imported-${todayStr()}.csv`, toCsv(rows, cols));
  };

  if (loading && tab === "expenses") return <TablePageSkeleton />;

  const RowActions = ({ e }: { e: Expense }) => {
    const isPending = e.status === "pending";
    const more = [
      ...(canEdit && isPending ? [{ label: "Mark as paid", onClick: () => markPaid(e), destructive: false }] : []),
      ...(canDelete ? [{ label: "Delete", onClick: () => setDeleting(e), destructive: true }] : []),
    ];
    return (
      <div className="flex gap-1 justify-end">
        {canEdit && <Button variant="ghost" size="sm" onClick={() => openEdit(e)}><Pencil className="size-4" /> Edit</Button>}
        {more.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" aria-label={`More actions for ${e.category} on ${e.expense_date}`}><MoreHorizontal className="size-4" /> More</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {more.map((m, i) => (
                <DropdownMenuItem key={i} className={m.destructive ? "text-destructive focus:text-destructive" : ""} onClick={m.onClick}>
                  {m.destructive ? <Trash2 className="size-4 mr-2" /> : <Check className="size-4 mr-2" />}{m.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6 w-full">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl lg:text-4xl font-bold text-brand-dark flex items-center gap-2"><Wallet className="size-7" /> Expenditure</h1>
          <p className="text-muted-foreground mt-1">Record what your business spends, run payroll, and track bills to pay.</p>
        </div>
        {tab === "expenses" && (
        <div className="flex gap-2 flex-wrap">
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} />
          <Button variant="outline" onClick={downloadTemplate}><Download className="size-4" /> CSV Template</Button>
          {canImport && hasModule("csv_import") && <Button variant="outline" onClick={() => fileRef.current?.click()}><Upload className="size-4" /> Import CSV</Button>}
          {(canExportCsv || canExportPdf) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" disabled={filtered.length === 0}><FileDown className="size-4" /> Export</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canExportCsv && hasModule("csv_export") && <DropdownMenuItem onClick={exportCsv}><Download className="size-4 mr-2" /> Export CSV</DropdownMenuItem>}
                {canExportPdf && <DropdownMenuItem onClick={exportPdf}><FileDown className="size-4 mr-2" /> Download PDF</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {canCreate && <Button variant="hero" onClick={openAdd}><Plus className="size-4" /> Add expense</Button>}
        </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-border/60">
        {([{ key: "expenses", label: "Expenses" }, { key: "payroll", label: "Payroll" }] as const).map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors", tab === t.key ? "border-brand text-brand-dark" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "payroll" && <PayrollPanel />}

      {tab === "expenses" && <>
      {/* Bills due strip */}
      {pending.length > 0 && (
        <Card className="shadow-card border-border/60 p-4 flex flex-wrap items-center gap-x-6 gap-y-2">
          <span className="flex items-center gap-2 text-sm font-medium text-brand-dark"><CalendarClock className="size-4 text-warning" /> Bills to pay</span>
          <span className="text-sm text-muted-foreground">{pending.length} pending · {fmt(periodTotal(pending))}</span>
          {overdueCount > 0 && <Badge variant="outline" className={STATUS_BADGE.overdue.className}>{overdueCount} overdue</Badge>}
          <button className="text-sm text-brand hover:underline ml-auto" onClick={() => setStatusFilter("pending")}>View pending</button>
        </Card>
      )}

      <Card className="shadow-card border-border/60">
        <div className="p-4 border-b border-border flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-40" aria-label="From date" />
            <span className="text-muted-foreground text-sm">to</span>
            <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-40" aria-label="To date" />
          </div>
          <div className="relative flex-1 min-w-[160px] max-w-xs">
            <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search payee or note" className="pl-9" />
          </div>
          <SearchableSelect value={categoryFilter} onValueChange={setCategoryFilter} className="w-40" placeholder="Category"
            options={[{ value: "all", label: "All categories" }, ...categoryOptions.map(c => ({ value: c, label: c }))]} />
          <SearchableSelect value={statusFilter} onValueChange={setStatusFilter} className="w-36" placeholder="Status"
            options={[{ value: "all", label: "All statuses" }, { value: "paid", label: "Paid" }, { value: "pending", label: "Pending / overdue" }]} />
          <div className="ml-auto text-right">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Total</p>
            <p className="font-display font-bold text-brand-dark">{fmt(total)}</p>
          </div>
        </div>

        {cats.length > 0 && (
          <div className="px-4 py-3 border-b border-border flex flex-wrap gap-2">
            {cats.map(c => (
              <span key={c.category} className="text-xs rounded-full bg-secondary px-2.5 py-1 text-secondary-foreground">
                {c.category} <span className="font-medium text-brand-dark">{fmt(c.total)}</span>
              </span>
            ))}
          </div>
        )}

        {filtered.length === 0 ? (
          <div className="p-12 text-center">
            <div className="size-14 rounded-2xl bg-brand-light text-brand grid place-items-center mx-auto mb-4"><Wallet className="size-6" /></div>
            <h3 className="font-display text-lg font-semibold text-brand-dark">No expenses in this view</h3>
            <p className="text-muted-foreground text-sm mt-1 mb-4">Record a cost or widen the date range.</p>
            {canCreate && <Button variant="brand" onClick={openAdd}><Plus className="size-4" /> Add expense</Button>}
          </div>
        ) : (
          <>
            {/* Mobile cards */}
            <div className="sm:hidden divide-y">
              {paged.map(e => {
                const s = STATUS_BADGE[displayStatus(e, today)];
                return (
                  <div key={e.id} className="p-4 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-brand-dark">{e.category}</p>
                      <div className="text-right">
                        <p className="font-display font-bold text-brand-dark">{fmt(Number(e.amount))}</p>
                        {Number(e.tax_amount) > 0 && <p className="text-xs text-muted-foreground">incl. VAT {fmt(Number(e.tax_amount))}</p>}
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-muted-foreground truncate">{e.payee || "—"} · {fmtDate(e.expense_date)}</p>
                      <Badge variant="outline" className={s.className}>{s.label}</Badge>
                    </div>
                    <RowActions e={e} />
                  </div>
                );
              })}
            </div>
            {/* Desktop table */}
            <div className="hidden sm:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead><TableHead>Category</TableHead><TableHead>Payee</TableHead>
                    <TableHead>Status</TableHead><TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paged.map(e => {
                    const s = STATUS_BADGE[displayStatus(e, today)];
                    return (
                      <TableRow key={e.id}>
                        <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDate(e.expense_date)}</TableCell>
                        <TableCell className="font-medium text-brand-dark">{e.category}{e.description ? <span className="block text-xs font-normal text-muted-foreground">{e.description}</span> : null}</TableCell>
                        <TableCell className="text-muted-foreground">{e.payee || "—"}</TableCell>
                        <TableCell><Badge variant="outline" className={s.className}>{s.label}{s.label !== "Paid" && e.due_date ? ` · ${fmtDate(e.due_date)}` : ""}</Badge></TableCell>
                        <TableCell className="text-right font-display font-semibold text-brand-dark">{fmt(Number(e.amount))}{Number(e.tax_amount) > 0 && <span className="block text-xs font-normal text-muted-foreground">incl. VAT {fmt(Number(e.tax_amount))}</span>}</TableCell>
                        <TableCell className="text-right"><RowActions e={e} /></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <Paginator page={page} pageCount={pageCount} pageSize={pageSize} total={totalRows} onPageChange={setPage} onPageSizeChange={setPageSize} />
          </>
        )}
      </Card>
      </>}

      {/* Add / Edit */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent variant="wide">
          <DialogHeader><DialogTitle className="font-display">{form.id ? "Edit expense" : "Add expense"}</DialogTitle></DialogHeader>
          <form onSubmit={save} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Date *</Label><Input type="date" required value={form.expense_date} onChange={e => setForm({ ...form, expense_date: e.target.value })} /></div>
              <div className="space-y-2"><Label>Amount *</Label><Input type="number" required min="0" step="0.01" placeholder="0" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></div>
            </div>
            {taxEnabled && (
              <div className="space-y-2 max-w-[calc(50%-0.375rem)]">
                <Label>of which VAT ({symbol}) <span className="font-normal text-muted-foreground">(input VAT — optional)</span></Label>
                <Input type="number" min="0" step="0.01" placeholder="0" value={form.tax_amount} onChange={e => setForm({ ...form, tax_amount: e.target.value })} />
              </div>
            )}
            <div className="space-y-2">
              <Label>Category *</Label>
              <SearchableSelect value={form.category} onValueChange={v => setForm({ ...form, category: v })}
                placeholder="Select category" searchPlaceholder="Search categories"
                options={categoryFormOptions.map(c => ({ value: c, label: c }))} />
              {form.category === "Other" && (
                <Input autoFocus placeholder="Specify — shows as “Other: …”" value={form.categoryOther}
                  onChange={e => setForm({ ...form, categoryOther: e.target.value })} />
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Payment method</Label>
                <SearchableSelect value={form.payment_method} onValueChange={v => setForm({ ...form, payment_method: v })}
                  options={EXPENSE_PAYMENT_METHODS.map(m => ({ value: m, label: m.charAt(0).toUpperCase() + m.slice(1) }))} />
              </div>
              <div className="space-y-2"><Label>Payee <span className="font-normal text-muted-foreground">(optional)</span></Label><Input value={form.payee} onChange={e => setForm({ ...form, payee: e.target.value })} placeholder="Who you paid" /></div>
            </div>
            <div className="space-y-2">
              <Label>Supplier <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <SearchableSelect value={form.supplier_id || "none"} onValueChange={v => setForm({ ...form, supplier_id: v === "none" ? "" : v })}
                options={[{ value: "none", label: "— None —" }, ...suppliers.map(s => ({ value: s.id, label: s.name }))]} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Status</Label>
                <SearchableSelect value={form.status} onValueChange={v => setForm({ ...form, status: v as ExpenseStatus })}
                  options={[{ value: "paid", label: "Paid" }, { value: "pending", label: "Pending (bill to pay)" }]} />
              </div>
              {form.status === "pending" && (
                <div className="space-y-2"><Label>Due date</Label><Input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} /></div>
              )}
            </div>
            <div className="space-y-2"><Label>Description / receipt ref <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="What was this for?" />
              <Input value={form.receipt_ref} onChange={e => setForm({ ...form, receipt_ref: e.target.value })} placeholder="Receipt / reference no." />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" variant="brand" disabled={busy}>{busy ? "Saving..." : form.id ? "Save changes" : "Add expense"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this expense?"
        description="This removes it from your records and reports. This can't be undone."
        confirmLabel="Delete"
        onConfirm={remove}
      />

      <ImportProgressDialog progress={importProgress} noun="expenses" />
      <ImportResultDialog result={importResult} onClose={() => setImportResult(null)} onDownloadFailed={downloadFailedRows} />
    </div>
  );
}
