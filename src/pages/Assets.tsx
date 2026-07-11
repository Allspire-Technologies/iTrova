import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/hooks/useCurrency";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import ConfirmDialog from "@/components/ConfirmDialog";
import { TablePageSkeleton } from "@/components/Skeletons";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, RefreshCw, Package } from "lucide-react";
import {
  listAssets, saveAsset, deleteAsset, runDepreciation, friendlyAssetError, type FixedAsset,
} from "@/lib/assets";
import { currentValue, accumulatedDepreciation, yearsElapsed, DEFAULT_RATE } from "@/lib/depreciation";

const thisYear = new Date().getFullYear();
const emptyForm = { id: null as string | null, name: "", category: "", cost: "", year_purchased: String(thisYear), rate_pct: String(DEFAULT_RATE * 100), active: true };
type Form = typeof emptyForm;

export default function Assets() {
  const { business, user, can } = useAuth();
  const { fmt } = useCurrency();
  const canCreate = can("assets", "create");
  const canEdit = can("assets", "edit");
  const canDelete = can("assets", "delete");
  const canDepreciate = can("assets", "depreciate");

  const [assets, setAssets] = useState<FixedAsset[] | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [deleting, setDeleting] = useState<FixedAsset | null>(null);

  const load = useCallback(() => listAssets().then(setAssets).catch(e => toast.error(friendlyAssetError(e?.message, "Couldn't load assets"))), []);
  useEffect(() => { load(); }, [load]);

  const openAdd = () => setForm({ ...emptyForm });
  const openEdit = (a: FixedAsset) => setForm({
    id: a.id, name: a.name, category: a.category || "", cost: String(a.cost),
    year_purchased: a.year_purchased ? String(a.year_purchased) : "", rate_pct: String((Number(a.depreciation_rate) || 0) * 100), active: a.active,
  });

  const submit = async () => {
    if (!business || !form) return;
    if (!form.name.trim()) return toast.error("Enter an item name");
    if (!(Number(form.cost) > 0)) return toast.error("Enter a cost greater than zero");
    setBusy(true);
    try {
      await saveAsset(business.id, user?.id ?? null, form.id, {
        name: form.name.trim(), category: form.category.trim() || null, cost: Number(form.cost) || 0,
        year_purchased: form.year_purchased ? Number(form.year_purchased) : null,
        depreciation_rate: (Number(form.rate_pct) || 0) / 100, active: form.active,
      });
      toast.success(form.id ? "Asset updated" : "Asset added");
      setForm(null); load();
    } catch (e) { toast.error(friendlyAssetError((e as Error)?.message, "Couldn't save the asset")); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!deleting) return;
    try { await deleteAsset(deleting.id); toast.success("Asset deleted"); setDeleting(null); load(); }
    catch (e) { toast.error(friendlyAssetError((e as Error)?.message, "Couldn't delete")); }
  };

  const doRunDepreciation = async () => {
    setRunning(true);
    try {
      const n = await runDepreciation();
      toast.success(n > 0 ? `Depreciation posted for ${n} asset${n === 1 ? "" : "s"} — see Accounting` : "Depreciation already up to date");
    } catch (e) { toast.error(friendlyAssetError((e as Error)?.message, "Couldn't run depreciation")); }
    finally { setRunning(false); }
  };

  const totals = useMemo(() => {
    const list = assets ?? [];
    const cost = list.reduce((s, a) => s + (Number(a.cost) || 0), 0);
    const nbv = list.reduce((s, a) => s + currentValue(a.cost, a.depreciation_rate, a.year_purchased, thisYear), 0);
    return { cost, nbv };
  }, [assets]);

  if (assets === null) return <TablePageSkeleton />;

  const rowFor = (a: FixedAsset) => {
    const years = yearsElapsed(a.year_purchased, thisYear);
    const acc = accumulatedDepreciation(a.cost, a.depreciation_rate, years);
    const nbv = currentValue(a.cost, a.depreciation_rate, a.year_purchased, thisYear);
    return { years, acc, nbv };
  };
  const actions = (a: FixedAsset) => (
    <div className="flex justify-end gap-1">
      {canEdit && <Button variant="ghost" size="sm" onClick={() => openEdit(a)}><Pencil className="size-4" /> Edit</Button>}
      {canDelete && <Button variant="ghost" size="icon" className="size-8" onClick={() => setDeleting(a)} aria-label={`Delete ${a.name}`}><Trash2 className="size-4 text-destructive" /></Button>}
    </div>
  );

  return (
    <div className="space-y-6 w-full">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl lg:text-4xl font-bold text-brand-dark">Assets</h1>
          <p className="text-muted-foreground mt-1">Track equipment and other fixed assets, and depreciate them into your accounts.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {canDepreciate && <Button variant="outline" onClick={doRunDepreciation} disabled={running || assets.length === 0}><RefreshCw className={running ? "size-4 animate-spin" : "size-4"} /> Run depreciation</Button>}
          {canCreate && <Button variant="hero" onClick={openAdd}><Plus className="size-4" /> Add asset</Button>}
        </div>
      </div>

      {assets.length > 0 && (
        <Card className="shadow-card border-border/60 p-4 flex flex-wrap items-center gap-x-8 gap-y-2">
          <span className="text-sm text-muted-foreground">Assets <span className="font-medium text-brand-dark">{assets.length}</span></span>
          <span className="text-sm text-muted-foreground">Total cost <span className="font-medium text-brand-dark">{fmt(totals.cost)}</span></span>
          <span className="text-sm text-muted-foreground">Current value (net) <span className="font-display font-bold text-brand-dark">{fmt(totals.nbv)}</span></span>
        </Card>
      )}

      {assets.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/50 p-12 text-center">
          <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-brand-light text-brand"><Package className="size-6" /></div>
          <h3 className="font-display text-lg font-semibold text-brand-dark">No assets yet</h3>
          <p className="mb-4 mt-1 text-sm text-muted-foreground">Add equipment, vehicles or fittings to track their value over time.</p>
          {canCreate && <Button variant="brand" onClick={openAdd}><Plus className="size-4" /> Add asset</Button>}
        </div>
      ) : (
        <Card className="shadow-card border-border/60 overflow-hidden">
          {/* Mobile cards */}
          <div className="sm:hidden divide-y">
            {assets.map(a => {
              const r = rowFor(a);
              return (
                <div key={a.id} className="p-4 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-brand-dark">{a.name}{a.category ? <span className="text-muted-foreground font-normal"> · {a.category}</span> : null}</p>
                    <p className="font-display font-bold text-brand-dark">{fmt(r.nbv)}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">Cost {fmt(a.cost)} · {a.year_purchased ?? "—"} · {Math.round((Number(a.depreciation_rate) || 0) * 100)}%/yr · depreciated {fmt(r.acc)}</p>
                  {actions(a)}
                </div>
              );
            })}
          </div>
          {/* Desktop table */}
          <div className="hidden sm:block overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Item</TableHead><TableHead className="text-right">Cost</TableHead><TableHead>Year</TableHead>
                <TableHead className="text-right">Rate</TableHead><TableHead className="text-right">Depreciated</TableHead>
                <TableHead className="text-right">Current value</TableHead><TableHead className="text-right">Actions</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {assets.map(a => {
                  const r = rowFor(a);
                  return (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium text-brand-dark">{a.name}{a.category ? <span className="block text-xs font-normal text-muted-foreground">{a.category}</span> : null}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{fmt(a.cost)}</TableCell>
                      <TableCell className="text-muted-foreground">{a.year_purchased ?? "—"}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{Math.round((Number(a.depreciation_rate) || 0) * 100)}%/yr</TableCell>
                      <TableCell className="text-right text-muted-foreground">{fmt(r.acc)}</TableCell>
                      <TableCell className="text-right font-display font-semibold text-brand-dark">{fmt(r.nbv)}</TableCell>
                      <TableCell className="text-right">{actions(a)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* Add / edit */}
      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent variant="wide">
          <DialogHeader><DialogTitle className="font-display">{form?.id ? "Edit asset" : "Add asset"}</DialogTitle></DialogHeader>
          {form && (
            <div className="space-y-4">
              <div className="space-y-2"><Label>Name of item *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Generator" /></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2"><Label>Cost *</Label><Input type="number" min="0" step="0.01" value={form.cost} onChange={e => setForm({ ...form, cost: e.target.value })} placeholder="0" /></div>
                <div className="space-y-2"><Label>Category <span className="font-normal text-muted-foreground">(optional)</span></Label><Input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="e.g. Equipment" /></div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2"><Label>Year purchased</Label><Input type="number" min="1900" max={String(thisYear + 1)} step="1" value={form.year_purchased} onChange={e => setForm({ ...form, year_purchased: e.target.value })} placeholder={String(thisYear)} /></div>
                <div className="space-y-2"><Label>Depreciation per year (%)</Label><Input type="number" min="0" max="100" step="1" value={form.rate_pct} onChange={e => setForm({ ...form, rate_pct: e.target.value })} placeholder="20" /></div>
              </div>
              {Number(form.cost) > 0 && (
                <p className="text-sm text-muted-foreground">Current value: <span className="font-medium text-brand-dark">{fmt(currentValue(Number(form.cost), (Number(form.rate_pct) || 0) / 100, Number(form.year_purchased) || thisYear, thisYear))}</span> <span className="text-xs">(after {yearsElapsed(Number(form.year_purchased) || thisYear, thisYear)} year{yearsElapsed(Number(form.year_purchased) || thisYear, thisYear) === 1 ? "" : "s"})</span></p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setForm(null)}>Cancel</Button>
            <Button variant="brand" onClick={submit} disabled={busy}>{busy ? "Saving..." : form?.id ? "Save changes" : "Add asset"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} title={`Delete ${deleting?.name ?? "this asset"}?`}
        description="This removes the asset from your register. Any depreciation already posted to Accounting stays." confirmLabel="Delete" onConfirm={remove} />
    </div>
  );
}
