import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, Search, Truck, Pencil, Trash2, Phone, Mail, Upload, Download, TrendingUp, Calendar, MoreHorizontal } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import StarRating from "@/components/StarRating";
import { toCsv, downloadCsv, parseCsv, readFileText } from "@/lib/csv";
import { buildSupplierImportPlan, SUPPLIER_FIELDS, templateHeaders, templateValues } from "@/lib/csvImport";
import { ImportProgressDialog, ImportResultDialog, type FailedImportRow, type ImportOutcome, type ImportProgress } from "@/components/ImportDialogs";
import Paginator, { usePagination } from "@/components/Paginator";
import ConfirmDialog from "@/components/ConfirmDialog";
import { TablePageSkeleton } from "@/components/Skeletons";
import { getLimit, isAtLimit, limitMessage } from "@/lib/planLimits";
import { useCurrency } from "@/hooks/useCurrency";
import { useDateFormat } from "@/hooks/useDateFormat";

type Supplier = {
  id: string; name: string; contact_name: string | null; phone: string | null;
  email: string | null; address: string | null; notes: string | null; rating: number | null;
};
type SupplierStats = { totalSpend: number; lastDelivery: string | null };

const empty = { name: "", contact_name: "", phone: "", email: "", address: "", notes: "", rating: 0 };

export default function Suppliers() {
  const { business, hasModule } = useAuth();
  const { fmt } = useCurrency();
  const { fmtDate } = useDateFormat();
  const [items, setItems] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Record<string, SupplierStats>>({});
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState<any>(empty);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ title: string; description: string; onConfirm: () => void } | null>(null);
  const [importResult, setImportResult] = useState<ImportOutcome | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);

  const load = async () => {
    const [{ data, error }, { data: purchases }] = await Promise.all([
      supabase.from("suppliers")
        .select("id,name,contact_name,phone,email,address,notes,rating")
        .order("created_at", { ascending: false }),
      supabase.from("material_purchases").select("supplier_id,total_cost,created_at"),
    ]);
    if (error) return toast.error(error.message);
    setItems((data as Supplier[]) || []);

    if (purchases) {
      const map: Record<string, SupplierStats> = {};
      for (const p of purchases as { supplier_id: string | null; total_cost: number; created_at: string }[]) {
        if (!p.supplier_id) continue;
        if (!map[p.supplier_id]) map[p.supplier_id] = { totalSpend: 0, lastDelivery: null };
        map[p.supplier_id].totalSpend += Number(p.total_cost);
        if (!map[p.supplier_id].lastDelivery || p.created_at > map[p.supplier_id].lastDelivery!) {
          map[p.supplier_id].lastDelivery = p.created_at;
        }
      }
      setStats(map);
    }
    setLoading(false);
  };
  useEffect(() => { if (business) load(); }, [business]);

  const openAdd = () => { setEditing(null); setForm(empty); setOpen(true); };
  const openEdit = (s: Supplier) => { setEditing(s); setForm({ ...s, rating: s.rating || 0 }); setOpen(true); };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business) return;
    if (!editing && isAtLimit(items.length, business.subscription_tier, "suppliers")) {
      toast.error(limitMessage("suppliers"));
      return;
    }
    setBusy(true);
    const payload = {
      name: form.name, contact_name: form.contact_name || null, phone: form.phone || null,
      email: form.email || null, address: form.address || null, notes: form.notes || null,
      rating: form.rating ? Number(form.rating) : null,
    };
    const { error } = editing
      ? await supabase.from("suppliers").update(payload).eq("id", editing.id)
      : await supabase.from("suppliers").insert({ ...payload, business_id: business.id });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(editing ? "Supplier updated" : "Supplier added");
    setOpen(false); load();
  };

  const remove = (s: Supplier) => {
    setPending({
      title: `Delete "${s.name}"?`,
      description: "This supplier will be permanently deleted. Any linked raw materials will lose their supplier association.",
      onConfirm: async () => {
        const { error } = await supabase.from("suppliers").delete().eq("id", s.id);
        if (error) return toast.error(error.message);
        toast.success("Supplier removed"); load();
      },
    });
  };

  const rateInline = async (s: Supplier, value: number) => {
    const { error } = await supabase.from("suppliers").update({ rating: value || null }).eq("id", s.id);
    if (error) return toast.error(error.message);
    setItems(prev => prev.map(x => x.id === s.id ? { ...x, rating: value || null } : x));
  };

  // Human-readable headers for the template/export. Import is case/spacing-insensitive and accepts
  // these plus common aliases (see SUPPLIER_FIELDS), so old snake_case exports still import fine.
  const CSV_HEADERS = templateHeaders(SUPPLIER_FIELDS);

  const downloadTemplate = () => {
    const example = ["Olu Farms Ltd", "Olusegun Bello", "08012345678", "olufarms@example.com", "12 Market Road, Lagos", "Reliable cereal supplier", "5"];
    downloadCsv("suppliers-template.csv", [CSV_HEADERS.join(","), example.join(",")].join("\n"));
    toast.success("Template downloaded");
  };

  const exportCsv = () => {
    const rows = items.map(s => ({
      "Name": s.name, "Contact Name": s.contact_name || "", "Phone": s.phone || "",
      "Email": s.email || "", "Address": s.address || "", "Notes": s.notes || "", "Rating": s.rating ?? "",
    }));
    downloadCsv(`suppliers-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows, CSV_HEADERS));
    toast.success(`Exported ${rows.length} supplier${rows.length === 1 ? "" : "s"}`);
  };

  const importCsv = async (file: File) => {
    if (!business) return;
    try {
      const text = await readFileText(file);
      const rows = parseCsv(text);
      const plan = buildSupplierImportPlan(rows, items, items.length, getLimit(business.subscription_tier, "suppliers"));
      if (plan.inserts.length === 0 && plan.updates.length === 0 && plan.rejected.length === 0) {
        return toast.error("No rows found in the file.");
      }

      const failed: FailedImportRow[] = plan.rejected.map(r => ({ values: templateValues(r.row, SUPPLIER_FIELDS), reason: r.reason }));

      const INSERT_BATCH = 100;
      const insertBatches: (typeof plan.inserts)[] = [];
      for (let i = 0; i < plan.inserts.length; i += INSERT_BATCH) insertBatches.push(plan.inserts.slice(i, i + INSERT_BATCH));
      const totalSteps = plan.updates.length + insertBatches.length;
      let done = 0;
      const tick = () => setImportProgress({ done: ++done, total: totalSteps });
      if (totalSteps > 0) setImportProgress({ done: 0, total: totalSteps });

      let updated = 0;
      for (const u of plan.updates) {
        const { error } = await supabase.from("suppliers").update(u.fields).eq("id", u.id);
        if (error) failed.push({ values: { "Name": items.find(s => s.id === u.id)?.name ?? "" }, reason: `Update failed: ${error.message}` });
        else updated++;
        tick();
      }

      let added = 0;
      for (const batch of insertBatches) {
        const { error } = await supabase.from("suppliers").insert(batch.map(i => ({ ...i, business_id: business.id })));
        if (error) batch.forEach(i => failed.push({ values: { "Name": i.name, "Contact Name": i.contact_name ?? "", "Phone": i.phone ?? "", "Email": i.email ?? "", "Address": i.address ?? "", "Notes": i.notes ?? "", "Rating": i.rating == null ? "" : String(i.rating) }, reason: `Upload failed: ${error.message}` }));
        else added += batch.length;
        tick();
      }

      setImportProgress(null);
      const detail = [added ? `${added} added` : "", updated ? `${updated} updated` : ""].filter(Boolean).join(" · ");
      setImportResult({ imported: added + updated, detail: detail || undefined, failed });
      load();
    } catch (e: any) {
      setImportProgress(null);
      toast.error(e.message || "Import failed");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const downloadFailedRows = () => {
    if (!importResult?.failed.length) return;
    const cols = [...CSV_HEADERS, "Reason"];
    const rows = importResult.failed.map(f => ({ ...f.values, "Reason": f.reason }));
    downloadCsv(`suppliers-not-imported-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows, cols));
  };

  const filtered = items.filter(i => !q || i.name.toLowerCase().includes(q.toLowerCase()) || i.contact_name?.toLowerCase().includes(q.toLowerCase()));
  const { paged, page, setPage, pageSize, setPageSize, pageCount, total } = usePagination(filtered, 20);

  const tier = business?.subscription_tier;
  const supplierLimit = getLimit(tier, "suppliers");
  const atSupplierLimit = isAtLimit(items.length, tier, "suppliers");

  if (loading) return <TablePageSkeleton />;

  return (
    <div className="space-y-6 w-full">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl lg:text-4xl font-bold text-brand-dark">Suppliers</h1>
          <p className="text-muted-foreground mt-1">Track who supplies your raw materials and stock.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} />
          <Button variant="outline" onClick={downloadTemplate}><Download className="size-4" /> CSV Template</Button>
          {hasModule("csv_import") && <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={atSupplierLimit} title={atSupplierLimit ? limitMessage("suppliers") : undefined}><Upload className="size-4" /> Import CSV</Button>}
          {hasModule("csv_export") && <Button variant="outline" onClick={exportCsv} disabled={items.length === 0}><Download className="size-4" /> Export</Button>}
          {supplierLimit !== null && items.length >= Math.floor(supplierLimit * 0.8) && (
            <span className={`self-center text-xs font-medium ${atSupplierLimit ? "text-destructive" : "text-amber-600"}`}>
              {items.length} / {supplierLimit}
            </span>
          )}
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="hero" onClick={openAdd} disabled={atSupplierLimit} title={atSupplierLimit ? limitMessage("suppliers") : undefined}><Plus className="size-4" /> Add supplier</Button>
            </DialogTrigger>
            <DialogContent variant="wide">
              <DialogHeader><DialogTitle className="font-display">{editing ? "Edit supplier" : "Add a supplier"}</DialogTitle></DialogHeader>
              <form onSubmit={save} className="space-y-4">
                <div className="space-y-2"><Label>Business name</Label><Input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Olu Farms Ltd" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2"><Label>Contact person</Label><Input value={form.contact_name || ""} onChange={e => setForm({ ...form, contact_name: e.target.value })} /></div>
                  <div className="space-y-2"><Label>Phone</Label><Input value={form.phone || ""} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+234..." /></div>
                </div>
                <div className="space-y-2"><Label>Email</Label><Input type="email" value={form.email || ""} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
                <div className="space-y-2"><Label>Address</Label><Input value={form.address || ""} onChange={e => setForm({ ...form, address: e.target.value })} /></div>
                <div className="space-y-2">
                  <Label>Reliability rating</Label>
                  <div className="flex items-center gap-3">
                    <StarRating value={form.rating} onChange={(v) => setForm({ ...form, rating: v })} size={22} />
                    <span className="text-sm text-muted-foreground">{form.rating ? `${form.rating} / 5` : "Not rated"}</span>
                  </div>
                </div>
                <div className="space-y-2"><Label>Notes</Label><Textarea rows={2} value={form.notes || ""} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
                <DialogFooter>
                  <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button type="submit" variant="brand" disabled={busy}>{busy ? "Saving..." : editing ? "Save changes" : "Add supplier"}</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card className="shadow-card border-border/60">
        <div className="p-4 border-b border-border flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search suppliers" className="pl-9" />
          </div>
          <div className="text-sm text-muted-foreground">{filtered.length} of {items.length}</div>
        </div>
        {filtered.length === 0 ? (
          <div className="p-12 text-center">
            <div className="size-14 rounded-2xl bg-brand-light text-brand grid place-items-center mx-auto mb-4"><Truck className="size-6" /></div>
            <h3 className="font-display text-lg font-semibold text-brand-dark">No suppliers yet</h3>
            <p className="text-muted-foreground text-sm mt-1 mb-4">Add a supplier to start linking raw materials.</p>
            <Button variant="brand" onClick={openAdd} disabled={atSupplierLimit}><Plus className="size-4" /> Add supplier</Button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
              {paged.map(s => (
                <Card key={s.id} className="p-4 hover:shadow-elevated transition-shadow">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-display font-semibold text-brand-dark truncate">{s.name}</div>
                      {s.contact_name && <div className="text-sm text-muted-foreground truncate">{s.contact_name}</div>}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(s)}><Pencil className="size-4" /> Edit</Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" aria-label={`More actions for ${s.name}`}><MoreHorizontal className="size-4" /> More</Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => remove(s)}><Trash2 className="size-4 mr-2" /> Delete</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  <div className="mt-2">
                    <StarRating value={s.rating} onChange={(v) => rateInline(s, v)} />
                  </div>
                  <div className="space-y-1 mt-3 text-sm">
                    {s.phone && <div className="flex items-center gap-2 text-muted-foreground"><Phone className="size-3.5" />{s.phone}</div>}
                    {s.email && <div className="flex items-center gap-2 text-muted-foreground"><Mail className="size-3.5" />{s.email}</div>}
                    {s.address && <div className="text-muted-foreground line-clamp-2">{s.address}</div>}
                  </div>
                  {stats[s.id] && (
                    <div className="mt-3 pt-3 border-t border-border/50 grid grid-cols-2 gap-2 text-xs">
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <TrendingUp className="size-3 shrink-0" />
                        <span className="font-medium text-brand-dark">{fmt(stats[s.id].totalSpend)}</span> spent
                      </div>
                      {stats[s.id].lastDelivery && (
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <Calendar className="size-3 shrink-0" />
                          {fmtDate(stats[s.id].lastDelivery, { day: "numeric", month: "short" })}
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              ))}
            </div>
            <Paginator page={page} pageCount={pageCount} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={setPageSize} />
          </>
        )}
      </Card>
      <ConfirmDialog
        open={!!pending}
        onOpenChange={(open) => !open && setPending(null)}
        title={pending?.title ?? ""}
        description={pending?.description}
        onConfirm={pending?.onConfirm ?? (() => {})}
      />
      <ImportProgressDialog progress={importProgress} noun="suppliers" />
      <ImportResultDialog result={importResult} onClose={() => setImportResult(null)} onDownloadFailed={downloadFailedRows} />
    </div>
  );
}
