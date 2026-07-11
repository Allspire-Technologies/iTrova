import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/hooks/useCurrency";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import SearchableSelect from "@/components/SearchableSelect";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { TablePageSkeleton } from "@/components/Skeletons";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { FileDown, Download, Plus, Pencil, Trash2, Settings2, Info } from "lucide-react";
import { downloadCsv } from "@/lib/csv";
import { loadPdf, pdfMoneyFormatter } from "@/lib/pdf";
import {
  ensureChart, listAccounts, fetchLines, buildTrialBalance, saveAccount, deleteAccount,
  friendlyLedgerError, ACCOUNT_TYPES, ACCOUNT_TYPE_LABEL,
  type Account, type AccountType, type TrialBalance,
} from "@/lib/ledger";

const emptyAccount = { id: null as string | null, code: "", name: "", type: "expense" as AccountType, active: true };

export default function TrialBalanceTab({ from, to, canManage, canExport }: { from: string; to: string; canManage: boolean; canExport: boolean }) {
  const { business } = useAuth();
  const { fmt } = useCurrency();
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [tb, setTb] = useState<TrialBalance | null>(null);

  const [manageOpen, setManageOpen] = useState(false);
  const [form, setForm] = useState<typeof emptyAccount | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; description: string; onConfirm: () => void } | null>(null);

  const load = useCallback(async () => {
    if (!business) return;
    setLoading(true);
    try {
      await ensureChart();
      const [accs, lines] = await Promise.all([listAccounts(), fetchLines(from, to)]);
      setAccounts(accs);
      setTb(buildTrialBalance(accs, lines));
    } catch (e) {
      toast.error(friendlyLedgerError((e as Error)?.message, "Couldn't build the trial balance"));
    } finally {
      setLoading(false);
    }
  }, [business, from, to]);
  useEffect(() => { load(); }, [load]);

  const submitAccount = async () => {
    if (!business || !form) return;
    if (!form.code.trim() || !form.name.trim()) return toast.error("Enter a code and a name");
    setBusy(true);
    try {
      await saveAccount(business.id, form.id, { code: form.code, name: form.name, type: form.type, active: form.active });
      toast.success(form.id ? "Account updated" : "Account added");
      setForm(null);
      const accs = await listAccounts(); setAccounts(accs);
      const lines = await fetchLines(from, to); setTb(buildTrialBalance(accs, lines));
    } catch (e) { toast.error(friendlyLedgerError((e as Error)?.message, "Couldn't save account")); }
    finally { setBusy(false); }
  };
  const removeAccount = (a: Account) => setConfirm({
    title: `Delete ${a.code} · ${a.name}?`, description: "You can only delete an account with no postings.",
    onConfirm: async () => {
      try { await deleteAccount(a.id); toast.success("Account deleted"); const accs = await listAccounts(); setAccounts(accs); setTb(buildTrialBalance(accs, await fetchLines(from, to))); }
      catch (e) { toast.error(friendlyLedgerError((e as Error)?.message, "Couldn't delete — it may have postings")); }
    },
  });

  const exportCsv = () => {
    if (!tb) return;
    const rows = tb.rows.map(r => [r.account.code, r.account.name, String(r.debit || ""), String(r.credit || "")]);
    const csv = [["Code", "Account", "Debit", "Credit"], ...rows, ["", "Total", String(tb.totalDebit), String(tb.totalCredit)]]
      .map(cols => cols.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    downloadCsv(`trial-balance-${from}_${to}.csv`, csv);
    toast.success("Trial balance exported");
  };
  const exportPdf = async () => {
    if (!tb) return;
    try {
      const { jsPDF, autoTable } = await loadPdf();
      const money = pdfMoneyFormatter(business?.currency ?? undefined);
      const doc = new jsPDF();
      doc.setFontSize(16); doc.text(business?.name || "Trial Balance", 14, 18);
      doc.setFontSize(11); doc.setTextColor(110); doc.text(`Trial Balance · ${from} to ${to}`, 14, 25); doc.setTextColor(0);
      autoTable(doc, {
        startY: 32,
        head: [["Code", "Account", "Debit", "Credit"]],
        body: tb.rows.map(r => [r.account.code, r.account.name, r.debit ? money(r.debit) : "", r.credit ? money(r.credit) : ""]),
        foot: [["", "Total", money(tb.totalDebit), money(tb.totalCredit)]],
        columnStyles: { 2: { halign: "right" }, 3: { halign: "right" } },
        theme: "grid", headStyles: { fillColor: [22, 101, 52] }, footStyles: { fillColor: [240, 240, 240], textColor: 0, fontStyle: "bold" },
      });
      doc.save(`trial-balance-${from}_${to}.pdf`);
    } catch (e) { toast.error(friendlyLedgerError((e as Error)?.message, "Couldn't build the PDF")); }
  };

  const typeOrder = useMemo(() => ({ asset: 0, liability: 1, equity: 2, income: 3, expense: 4 }), []);
  const chart = useMemo(() => [...accounts].sort((a, b) => (typeOrder[a.type] - typeOrder[b.type]) || a.code.localeCompare(b.code)), [accounts, typeOrder]);

  if (loading || !tb) return <TablePageSkeleton />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {canManage && <Button variant="outline" onClick={() => setManageOpen(true)}><Settings2 className="size-4" /> Manage accounts</Button>}
        {canExport && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="outline"><FileDown className="size-4" /> Export</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={exportPdf}><FileDown className="size-4 mr-2" /> Download PDF</DropdownMenuItem>
              <DropdownMenuItem onClick={exportCsv}><Download className="size-4 mr-2" /> Export CSV</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <Card className="shadow-card border-border/60 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                <th className="text-left font-medium px-4 py-3">Account</th>
                <th className="text-right font-medium px-4 py-3">Debit</th>
                <th className="text-right font-medium px-4 py-3">Credit</th>
              </tr>
            </thead>
            <tbody>
              {tb.rows.length === 0 && <tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">No postings in this period yet.</td></tr>}
              {tb.rows.map((r) => (
                <tr key={r.account.id} className="border-b border-border/40 last:border-0">
                  <td className="px-4 py-2.5"><span className="text-muted-foreground">{r.account.code}</span> <span className="font-medium text-brand-dark">{r.account.name}</span></td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.debit ? fmt(r.debit) : ""}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.credit ? fmt(r.credit) : ""}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border bg-brand-light/30 font-semibold text-brand-dark">
                <td className="px-4 py-2.5">Total</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{fmt(tb.totalDebit)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{fmt(tb.totalCredit)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <div className="flex items-center gap-2 text-sm">
        <Badge variant="outline" className={cn(tb.balanced ? "bg-brand-light text-brand-dark border-brand/20" : "bg-danger/10 text-danger border-danger/20")}>
          {tb.balanced ? "Balanced — debits = credits" : "Out of balance"}
        </Badge>
        <span className="flex items-center gap-1 text-muted-foreground"><Info className="size-3.5" /> Every posting is double-entry, so this always balances.</span>
      </div>

      {/* Manage accounts */}
      <Dialog open={manageOpen} onOpenChange={(o) => { if (!o) { setManageOpen(false); setForm(null); } }}>
        <DialogContent variant="wide">
          <DialogHeader><DialogTitle className="font-display">Chart of accounts</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="flex justify-end">
              <Button variant="brand" size="sm" onClick={() => setForm({ ...emptyAccount })}><Plus className="size-4" /> Add account</Button>
            </div>
            {form && (
              <div className="rounded-xl border border-border/60 p-3 grid gap-3 sm:grid-cols-4">
                <div className="space-y-1.5"><Label className="text-xs">Code</Label><Input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="e.g. 6100" /></div>
                <div className="space-y-1.5 sm:col-span-2"><Label className="text-xs">Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Account name" /></div>
                <div className="space-y-1.5"><Label className="text-xs">Type</Label>
                  <SearchableSelect value={form.type} onValueChange={v => setForm({ ...form, type: v as AccountType })} options={ACCOUNT_TYPES.map(t => ({ value: t.value, label: t.label }))} />
                </div>
                <div className="sm:col-span-4 flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setForm(null)}>Cancel</Button>
                  <Button variant="brand" size="sm" onClick={submitAccount} disabled={busy}>{busy ? "Saving..." : form.id ? "Save" : "Add"}</Button>
                </div>
              </div>
            )}
            <div className="divide-y rounded-xl border border-border/60 max-h-[50vh] overflow-y-auto">
              {chart.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="font-medium text-brand-dark truncate"><span className="text-muted-foreground">{a.code}</span> {a.name}</p>
                    <p className="text-xs text-muted-foreground">{ACCOUNT_TYPE_LABEL[a.type]}{a.is_system ? " · system" : ""}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="sm" onClick={() => setForm({ id: a.id, code: a.code, name: a.name, type: a.type, active: a.active })}><Pencil className="size-4" /> Edit</Button>
                    {!a.is_system && <Button variant="ghost" size="icon" className="size-8" onClick={() => removeAccount(a)} aria-label={`Delete ${a.name}`}><Trash2 className="size-4 text-destructive" /></Button>}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter><Button variant="ghost" onClick={() => { setManageOpen(false); setForm(null); }}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)} title={confirm?.title ?? ""} description={confirm?.description} confirmLabel="Delete" onConfirm={confirm?.onConfirm ?? (() => {})} />
    </div>
  );
}
