import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import SearchableSelect from "@/components/SearchableSelect";
import { Plus, Search, Boxes, Pencil, PackagePlus, Upload, Download, SlidersHorizontal, MessageCircle, Truck } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { toCsv, downloadCsv, parseCsv, readFileText } from "@/lib/csv";
import StockAdjustDialog from "@/components/StockAdjustDialog";
import Paginator, { usePagination } from "@/components/Paginator";
import ConfirmDialog from "@/components/ConfirmDialog";
import { TablePageSkeleton } from "@/components/Skeletons";
import { getLimit, isAtLimit, limitMessage } from "@/lib/planLimits";
import { useCurrency } from "@/hooks/useCurrency";
import { useDateFormat } from "@/hooks/useDateFormat";

type Material = {
  id: string; name: string; sku: string | null; unit: string; stock_quantity: number;
  reorder_level: number; cost_per_unit: number; supplier_id: string | null; notes: string | null;
};
type Supplier = { id: string; name: string; phone: string | null; contact_name: string | null };
type Purchase = {
  id: string; created_at: string; quantity: number; unit_cost: number; total_cost: number;
  raw_material_id: string; supplier_id: string | null; notes: string | null;
};

const empty = { name: "", sku: "", unit: "kg", stock_quantity: "", reorder_level: 5, cost_per_unit: "", supplier_id: "", notes: "" };

export default function RawMaterials() {
  const { business } = useAuth();
  const { fmt, symbol } = useCurrency();
  const { fmtDate } = useDateFormat();
  const [items, setItems] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Material | null>(null);
  const [form, setForm] = useState<any>(empty);
  const [busy, setBusy] = useState(false);
  const [adjustTarget, setAdjustTarget] = useState<Material | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ title: string; description: string; onConfirm: () => void } | null>(null);


  // Purchase dialog
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [purchaseFor, setPurchaseFor] = useState<Material | null>(null);
  const [pQty, setPQty] = useState<number>(0);
  const [pCost, setPCost] = useState<number>(0);

  const load = async () => {
    const [{ data: m }, { data: s }, { data: pur }] = await Promise.all([
      supabase.from("raw_materials").select("*").order("created_at", { ascending: false }),
      supabase.from("suppliers").select("id,name,phone,contact_name").order("name"),
      supabase.from("material_purchases").select("*").order("created_at", { ascending: false }),
    ]);
    setItems((m as Material[]) || []);
    setSuppliers((s as Supplier[]) || []);
    setPurchases((pur as Purchase[]) || []);
    setLoading(false);
  };
  useEffect(() => { if (business) load(); }, [business]);

  const openAdd = () => { setEditing(null); setForm(empty); setOpen(true); };
  const openEdit = (m: Material) => { setEditing(m); setForm({ ...m, supplier_id: m.supplier_id || "" }); setOpen(true); };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business) return;
    if (!editing && isAtLimit(items.length, business.subscription_tier, "rawMaterials")) {
      toast.error(limitMessage("rawMaterials"));
      return;
    }
    setBusy(true);
    const payload = {
      name: form.name, sku: form.sku || null, unit: form.unit || "kg",
      stock_quantity: Number(form.stock_quantity) || 0,
      reorder_level: Number(form.reorder_level) || 0,
      cost_per_unit: Number(form.cost_per_unit) || 0,
      supplier_id: form.supplier_id || null,
      notes: form.notes || null,
    };
    const { error } = editing
      ? await supabase.from("raw_materials").update(payload).eq("id", editing.id)
      : await supabase.from("raw_materials").insert({ ...payload, business_id: business.id });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(editing ? "Material updated" : "Material added");
    setOpen(false); load();
  };

  const recordPurchase = async () => {
    if (!business || !purchaseFor || pQty <= 0) return;
    const { error } = await supabase.from("material_purchases").insert({
      business_id: business.id,
      supplier_id: purchaseFor.supplier_id,
      raw_material_id: purchaseFor.id,
      quantity: pQty,
      unit_cost: pCost,
      total_cost: pQty * pCost,
    });
    if (error) return toast.error(error.message);
    toast.success(`Recorded purchase of ${pQty} ${purchaseFor.unit}`);
    setPurchaseOpen(false); setPQty(0); setPCost(0); load();
  };

  const downloadTemplate = () => {
    const headers = ["name", "sku", "unit", "stock_quantity", "reorder_level", "cost_per_unit", "supplier", "notes"];
    const example = ["Cassava Flour", "CF-001", "kg", "50", "10", "1200", "Olu Farms Ltd", "Grade A white cassava"];
    downloadCsv("raw-materials-template.csv", [headers.join(","), example.join(",")].join("\n"));
    toast.success("Template downloaded");
  };

  const exportCsv = () => {
    const rows = items.map(m => ({
      name: m.name, sku: m.sku || "", unit: m.unit,
      stock_quantity: m.stock_quantity, reorder_level: m.reorder_level,
      cost_per_unit: m.cost_per_unit,
      supplier: suppliers.find(s => s.id === m.supplier_id)?.name || "",
      notes: m.notes || "",
    }));
    downloadCsv(`raw-materials-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(rows, ["name", "sku", "unit", "stock_quantity", "reorder_level", "cost_per_unit", "supplier", "notes"]));
    toast.success(`Exported ${rows.length} material${rows.length === 1 ? "" : "s"}`);
  };

  const importCsv = async (file: File) => {
    if (!business) return;
    if (isAtLimit(items.length, business.subscription_tier, "rawMaterials")) {
      toast.error(limitMessage("rawMaterials"));
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    try {
      const text = await readFileText(file);
      const rows = parseCsv(text);
      const valid = rows.filter(r => r.name?.trim());
      if (valid.length === 0) return toast.error("No valid rows. Required column: name");
      const payload = valid.map(r => {
        const supp = r.supplier ? suppliers.find(s => s.name.toLowerCase() === r.supplier.toLowerCase()) : null;
        return {
          business_id: business.id,
          name: r.name.trim(),
          sku: r.sku || null,
          unit: r.unit || "kg",
          stock_quantity: Number(r.stock_quantity) || 0,
          reorder_level: Number(r.reorder_level) || 5,
          cost_per_unit: Number(r.cost_per_unit) || 0,
          supplier_id: supp?.id || null,
          notes: r.notes || null,
        };
      });
      const { error } = await supabase.from("raw_materials").insert(payload);
      if (error) return toast.error(error.message);
      toast.success(`Imported ${payload.length} material${payload.length === 1 ? "" : "s"}`);
      load();
    } catch (e: any) {
      toast.error(e.message || "Import failed");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const reorder = (m: Material) => {
    const supp = suppliers.find(s => s.id === m.supplier_id);
    if (!supp?.phone) return toast.error("Supplier has no phone number on file");
    const need = Math.max(Number(m.reorder_level) * 2 - Number(m.stock_quantity), Number(m.reorder_level));
    const text = `Hello ${supp.contact_name || supp.name}, we'd like to reorder ${need} ${m.unit} of ${m.name}. Please confirm availability and price. Thanks!`;
    const phone = supp.phone.replace(/[^\d+]/g, "").replace(/^\+/, "");
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, "_blank");
  };

  const filtered = items.filter(i => !q || i.name.toLowerCase().includes(q.toLowerCase()) || i.sku?.toLowerCase().includes(q.toLowerCase()));
  const { paged, page, setPage, pageSize, setPageSize, pageCount, total } = usePagination(filtered, 20);
  const { paged: pagedPurchases, page: purPage, setPage: setPurPage, pageSize: purPageSize, setPageSize: setPurPageSize, pageCount: purPageCount, total: purTotal } = usePagination(purchases, 20);

  const tier = business?.subscription_tier;
  const rawMatLimit = getLimit(tier, "rawMaterials");
  const atRawMatLimit = isAtLimit(items.length, tier, "rawMaterials");

  if (loading) return <TablePageSkeleton />;

  const statusOf = (m: Material) => {
    if (m.stock_quantity <= 0) return { label: "Out", className: "bg-danger/10 text-danger border-danger/20" };
    if (m.stock_quantity <= m.reorder_level) return { label: "Low", className: "bg-warning/10 text-warning border-warning/20" };
    return { label: "OK", className: "bg-brand-light text-brand-dark border-brand/20" };
  };

  return (
    <div className="space-y-6 w-full">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl lg:text-4xl font-bold text-brand-dark">Raw Materials</h1>
          <p className="text-muted-foreground mt-1">Track the inputs and ingredients you use to make your products.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} />
          <Button variant="outline" onClick={downloadTemplate}><Download className="size-4" /> CSV Template</Button>
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={atRawMatLimit} title={atRawMatLimit ? limitMessage("rawMaterials") : undefined}><Upload className="size-4" /> Import CSV</Button>
          <Button variant="outline" onClick={exportCsv} disabled={items.length === 0}><Download className="size-4" /> Export</Button>
          {rawMatLimit !== null && items.length >= Math.floor(rawMatLimit * 0.8) && (
            <span className={`self-center text-xs font-medium ${atRawMatLimit ? "text-destructive" : "text-amber-600"}`}>
              {items.length} / {rawMatLimit}
            </span>
          )}
          <Button variant="hero" onClick={openAdd} disabled={atRawMatLimit} title={atRawMatLimit ? limitMessage("rawMaterials") : undefined}><Plus className="size-4" /> Add material</Button>
        </div>
      </div>

      <Tabs defaultValue="materials">
        <TabsList className="mb-2">
          <TabsTrigger value="materials" className="gap-2"><Boxes className="size-4" /> Materials</TabsTrigger>
          <TabsTrigger value="deliveries" className="gap-2"><Truck className="size-4" /> Deliveries {purchases.length > 0 && <span className="ml-1 bg-brand-light text-brand text-xs rounded-full px-1.5">{purchases.length}</span>}</TabsTrigger>
        </TabsList>

        <TabsContent value="materials">
      <Card className="shadow-card border-border/60">
        <div className="p-4 border-b border-border flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search materials" className="pl-9" />
          </div>
          <div className="text-sm text-muted-foreground">{filtered.length} of {items.length}</div>
        </div>

        {filtered.length === 0 ? (
          <div className="p-12 text-center">
            <div className="size-14 rounded-2xl bg-brand-light text-brand grid place-items-center mx-auto mb-4"><Boxes className="size-6" /></div>
            <h3 className="font-display text-lg font-semibold text-brand-dark">No raw materials yet</h3>
            <p className="text-muted-foreground text-sm mt-1 mb-4">Add inputs like flour, sugar, fabric, etc.</p>
            <Button variant="brand" onClick={openAdd} disabled={atRawMatLimit}><Plus className="size-4" /> Add material</Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
                  <th className="px-4 py-3">Material</th>
                  <th className="px-4 py-3">Supplier</th>
                  <th className="px-4 py-3 text-right">Stock</th>
                  <th className="px-4 py-3 text-right">Cost / unit</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paged.map(m => {
                  const s = statusOf(m);
                  const supp = suppliers.find(x => x.id === m.supplier_id);
                  return (
                    <tr key={m.id} className="border-b border-border/50 hover:bg-secondary/40">
                      <td className="px-4 py-3">
                        <div className="font-medium text-brand-dark">{m.name}</div>
                        {m.sku && <div className="text-xs text-muted-foreground">{m.sku}</div>}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{supp?.name || "—"}</td>
                      <td className="px-4 py-3 text-right font-medium">{Number(m.stock_quantity)} <span className="text-xs text-muted-foreground">{m.unit}</span></td>
                      <td className="px-4 py-3 text-right font-display font-semibold text-brand-dark">{fmt(m.cost_per_unit)}</td>
                      <td className="px-4 py-3"><Badge variant="outline" className={s.className}>{s.label}</Badge></td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <Button variant="ghost" size="icon" title="Record purchase" onClick={() => { setPurchaseFor(m); setPCost(Number(m.cost_per_unit) || 0); setPurchaseOpen(true); }}><PackagePlus className="size-4" /></Button>
                        <Button variant="ghost" size="icon" title="Adjust stock" onClick={() => setAdjustTarget(m)}><SlidersHorizontal className="size-4" /></Button>
                        <Button variant="ghost" size="icon" title="Reorder via WhatsApp" onClick={() => reorder(m)} disabled={!suppliers.find(x => x.id === m.supplier_id)?.phone}><MessageCircle className="size-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => openEdit(m)}><Pencil className="size-4" /></Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Paginator page={page} pageCount={pageCount} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={setPageSize} />
          </div>
        )}
      </Card>
        </TabsContent>

        <TabsContent value="deliveries">
          <Card className="shadow-card border-border/60">
            {purchases.length === 0 ? (
              <div className="p-12 text-center">
                <div className="size-14 rounded-2xl bg-brand-light text-brand grid place-items-center mx-auto mb-4"><Truck className="size-6" /></div>
                <h3 className="font-display text-lg font-semibold text-brand-dark">No deliveries recorded</h3>
                <p className="text-muted-foreground text-sm mt-1">Record a purchase on any material to see deliveries here.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Material</th>
                      <th className="px-4 py-3">Supplier</th>
                      <th className="px-4 py-3 text-right">Qty</th>
                      <th className="px-4 py-3 text-right">Unit cost</th>
                      <th className="px-4 py-3 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedPurchases.map(p => {
                      const mat = items.find(m => m.id === p.raw_material_id);
                      const supp = suppliers.find(s => s.id === p.supplier_id);
                      return (
                        <tr key={p.id} className="border-b border-border/50 hover:bg-secondary/40">
                          <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                            {fmtDate(p.created_at)}
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-medium text-brand-dark">{mat?.name || "—"}</div>
                            {p.notes && <div className="text-xs text-muted-foreground">{p.notes}</div>}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{supp?.name || "—"}</td>
                          <td className="px-4 py-3 text-right font-medium">{Number(p.quantity)} <span className="text-xs text-muted-foreground">{mat?.unit}</span></td>
                          <td className="px-4 py-3 text-right text-muted-foreground">{fmt(p.unit_cost)}</td>
                          <td className="px-4 py-3 text-right font-display font-semibold text-brand-dark">{fmt(p.total_cost)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {purPageCount > 1 && (
                  <Paginator page={purPage} pageCount={purPageCount} pageSize={purPageSize} total={purTotal} onPageChange={setPurPage} onPageSizeChange={setPurPageSize} />
                )}
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      {/* Add/Edit Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="font-display">{editing ? "Edit material" : "Add raw material"}</DialogTitle></DialogHeader>
          <form onSubmit={save} className="space-y-4">
            <div className="space-y-2"><Label>Name</Label><Input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Cassava flour" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>SKU</Label><Input value={form.sku || ""} onChange={e => setForm({ ...form, sku: e.target.value })} /></div>
              <div className="space-y-2"><Label>Unit</Label><Input value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} placeholder="kg, L, pcs" /></div>
            </div>
            <div className="space-y-2">
              <Label>Supplier</Label>
              <SearchableSelect
                value={form.supplier_id || "none"}
                onValueChange={v => setForm({ ...form, supplier_id: v === "none" ? "" : v })}
                placeholder="Select supplier"
                options={[
                  { value: "none", label: "None" },
                  ...suppliers.map(s => ({ value: s.id, label: s.name })),
                ]}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2"><Label>Stock</Label><Input type="number" min="0" step="0.01" placeholder="0" value={form.stock_quantity} onChange={e => setForm({ ...form, stock_quantity: e.target.value })} /></div>
              <div className="space-y-2"><Label>Reorder</Label><Input type="number" min="0" step="0.01" value={form.reorder_level} onChange={e => setForm({ ...form, reorder_level: e.target.value })} /></div>
              <div className="space-y-2"><Label>Cost/unit</Label><Input type="number" min="0" step="0.01" placeholder="0" value={form.cost_per_unit} onChange={e => setForm({ ...form, cost_per_unit: e.target.value })} /></div>
            </div>
            <div className="space-y-2"><Label>Notes</Label><Textarea rows={2} value={form.notes || ""} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" variant="brand" disabled={busy}>{busy ? "Saving..." : editing ? "Save changes" : "Add material"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Purchase Dialog */}
      <Dialog open={purchaseOpen} onOpenChange={setPurchaseOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="font-display">Record purchase{purchaseFor ? ` — ${purchaseFor.name}` : ""}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Quantity ({purchaseFor?.unit})</Label><Input type="number" min="0" step="0.01" placeholder="0" value={pQty || ""} onChange={e => setPQty(Number(e.target.value))} /></div>
              <div className="space-y-2"><Label>Unit cost ({symbol})</Label><Input type="number" min="0" step="0.01" placeholder="0" value={pCost || ""} onChange={e => setPCost(Number(e.target.value))} /></div>
            </div>
            <div className="text-sm text-muted-foreground">Total: <span className="font-semibold text-brand-dark">{fmt((pQty || 0) * (pCost || 0))}</span></div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setPurchaseOpen(false)}>Cancel</Button>
              <Button variant="brand" onClick={recordPurchase} disabled={pQty <= 0}>Add to stock</Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <StockAdjustDialog
        open={!!adjustTarget}
        onOpenChange={(v) => !v && setAdjustTarget(null)}
        target={adjustTarget ? { kind: "raw_material", id: adjustTarget.id, name: adjustTarget.name, unit: adjustTarget.unit, stock_quantity: Number(adjustTarget.stock_quantity) } : null}
        onSaved={load}
      />

      <ConfirmDialog
        open={!!pending}
        onOpenChange={(open) => !open && setPending(null)}
        title={pending?.title ?? ""}
        description={pending?.description}
        confirmLabel="Remove"
        onConfirm={pending?.onConfirm ?? (() => {})}
      />
    </div>
  );
}
