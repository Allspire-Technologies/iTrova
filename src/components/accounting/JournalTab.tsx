import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/hooks/useCurrency";
import { useDateFormat } from "@/hooks/useDateFormat";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import SearchableSelect from "@/components/SearchableSelect";
import DatePicker from "@/components/DatePicker";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TablePageSkeleton } from "@/components/Skeletons";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Plus, X, BookOpen } from "lucide-react";
import {
  ensureChart, listAccounts, listEntries, postManualJournal, validateEntryLines, friendlyLedgerError,
  type Account, type JournalEntry,
} from "@/lib/ledger";

const todayStr = () => new Date().toISOString().slice(0, 10);
const num = (s: string) => Number(s) || 0;
const uid = () => Math.random().toString(36).slice(2);
type EditLine = { key: string; account_id: string; debit: string; credit: string };
const SOURCE_LABEL: Record<JournalEntry["source"], string> = {
  manual: "Manual", opening: "Opening", sale: "Sale", expense: "Expense", payment: "Payment", payroll: "Payroll", purchase: "Purchase",
};

export default function JournalTab({ from, to, canManage }: { from: string; to: string; canManage: boolean }) {
  const { business } = useAuth();
  const { fmt } = useCurrency();
  const { fmtDate } = useDateFormat();
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [date, setDate] = useState(todayStr());
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<EditLine[]>([]);

  const load = useCallback(async () => {
    if (!business) return;
    setLoading(true);
    try {
      await ensureChart();
      const [accs, ents] = await Promise.all([listAccounts(), listEntries(from, to)]);
      setAccounts(accs); setEntries(ents);
    } catch (e) {
      toast.error(friendlyLedgerError((e as Error)?.message, "Couldn't load the journal"));
    } finally { setLoading(false); }
  }, [business, from, to]);
  useEffect(() => { load(); }, [load]);

  const accountOptions = useMemo(() => accounts.filter(a => a.active).map(a => ({ value: a.id, label: `${a.code} · ${a.name}` })), [accounts]);

  const openNew = () => {
    setDate(todayStr()); setMemo("");
    setLines([{ key: uid(), account_id: "", debit: "", credit: "" }, { key: uid(), account_id: "", debit: "", credit: "" }]);
    setOpen(true);
  };
  const patch = (key: string, p: Partial<EditLine>) => setLines(ls => ls.map(l => l.key === key ? { ...l, ...p } : l));
  const totals = useMemo(() => {
    const d = lines.reduce((a, l) => a + num(l.debit), 0);
    const c = lines.reduce((a, l) => a + num(l.credit), 0);
    return { d: Math.round(d * 100) / 100, c: Math.round(c * 100) / 100 };
  }, [lines]);

  const submit = async () => {
    const filled = lines.filter(l => l.account_id && (num(l.debit) > 0 || num(l.credit) > 0));
    if (filled.length < 2) return toast.error("Add at least two lines (a debit and a credit).");
    const check = validateEntryLines(filled.map(l => ({ debit: num(l.debit), credit: num(l.credit) })));
    if (!check.ok) return toast.error(check.reason ?? "Entry doesn't balance");
    setBusy(true);
    try {
      await postManualJournal(date, memo, filled.map(l => ({ account_id: l.account_id, debit: num(l.debit), credit: num(l.credit) })));
      toast.success("Journal entry posted");
      setOpen(false); load();
    } catch (e) { toast.error(friendlyLedgerError((e as Error)?.message, "Couldn't post the entry")); }
    finally { setBusy(false); }
  };

  if (loading) return <TablePageSkeleton />;

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Button variant="hero" onClick={openNew}><Plus className="size-4" /> New journal entry</Button>
        </div>
      )}

      {entries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/50 p-12 text-center">
          <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-brand-light text-brand"><BookOpen className="size-6" /></div>
          <h3 className="font-display text-lg font-semibold text-brand-dark">No journal entries yet</h3>
          <p className="mb-4 mt-1 text-sm text-muted-foreground">Sales post here automatically; you can also record manual entries and adjustments.</p>
          {canManage && <Button variant="brand" onClick={openNew}><Plus className="size-4" /> New journal entry</Button>}
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map((e) => (
            <Card key={e.id} className="shadow-card border-border/60 overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border/60 bg-muted/30">
                <div className="min-w-0">
                  <span className="font-medium text-brand-dark">{e.memo || "Journal entry"}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{fmtDate(e.entry_date)}</span>
                </div>
                <Badge variant="secondary" className="shrink-0">{SOURCE_LABEL[e.source]}</Badge>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {e.lines.map((l) => (
                      <tr key={l.id} className="border-b border-border/30 last:border-0">
                        <td className="px-4 py-2">{l.account ? <><span className="text-muted-foreground">{l.account.code}</span> <span className="text-brand-dark">{l.account.name}</span></> : "—"}{l.description && <span className="block text-xs text-muted-foreground">{l.description}</span>}</td>
                        <td className="px-4 py-2 text-right tabular-nums w-32">{Number(l.debit) ? fmt(Number(l.debit)) : ""}</td>
                        <td className="px-4 py-2 text-right tabular-nums w-32">{Number(l.credit) ? fmt(Number(l.credit)) : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* New journal entry */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent variant="wide">
          <DialogHeader><DialogTitle className="font-display">New journal entry</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5"><Label>Date</Label><DatePicker value={date} onChange={setDate} placeholder="Select date" /></div>
              <div className="space-y-1.5 sm:col-span-2"><Label>Memo</Label><Input value={memo} onChange={e => setMemo(e.target.value)} placeholder="What is this entry for?" /></div>
            </div>
            <div className="space-y-2">
              {lines.map((l) => (
                <div key={l.key} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2">
                  <SearchableSelect value={l.account_id} onValueChange={v => patch(l.key, { account_id: v })} placeholder="Select account" options={accountOptions} className="w-full" />
                  <Input type="number" min="0" step="0.01" value={l.debit} onChange={e => patch(l.key, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} placeholder="Debit" className="w-28" aria-label="Debit" />
                  <Input type="number" min="0" step="0.01" value={l.credit} onChange={e => patch(l.key, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} placeholder="Credit" className="w-28" aria-label="Credit" />
                  <Button variant="ghost" size="icon" className="size-8" onClick={() => setLines(ls => ls.filter(x => x.key !== l.key))} aria-label="Remove line"><X className="size-4" /></Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => setLines(ls => [...ls, { key: uid(), account_id: "", debit: "", credit: "" }])}><Plus className="size-3.5" /> Add line</Button>
            </div>
            <div className="flex flex-wrap justify-end gap-x-8 gap-y-1 rounded-xl bg-muted/50 p-4 text-sm">
              <span className="text-muted-foreground">Debits <span className="ml-1 font-semibold text-brand-dark">{fmt(totals.d)}</span></span>
              <span className="text-muted-foreground">Credits <span className="ml-1 font-semibold text-brand-dark">{fmt(totals.c)}</span></span>
              <span className={cn("font-medium", totals.d === totals.c && totals.d > 0 ? "text-brand" : "text-danger")}>{totals.d === totals.c ? (totals.d > 0 ? "Balanced" : "") : `Off by ${fmt(Math.abs(totals.d - totals.c))}`}</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="brand" onClick={submit} disabled={busy || totals.d !== totals.c || totals.d === 0}>{busy ? "Posting..." : "Post entry"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
