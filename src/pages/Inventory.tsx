import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Package, Pencil, Upload, Download, SlidersHorizontal } from "lucide-react";
import SearchableSelect from "@/components/SearchableSelect";
import { toast } from "sonner";
import { toCsv, downloadCsv, parseCsv, readFileText } from "@/lib/csv";
import StockAdjustDialog from "@/components/StockAdjustDialog";
import Paginator, { usePagination } from "@/components/Paginator";
import { TablePageSkeleton } from "@/components/Skeletons";
import { getLimit, isAtLimit, limitMessage } from "@/lib/planLimits";
import { useCurrency } from "@/hooks/useCurrency";

type Product = {
  id: string;
  name: string;
  category: string | null;
  sku: string | null;
  unit: string | null;
  selling_price: number;
  cost_price: number;
  stock_quantity: number;
  reorder_level: number;
};

const empty = { name: "", category: "", sku: "", unit: "pcs", selling_price: "", cost_price: "", stock_quantity: "", reorder_level: 5 };

export default function Inventory() {
  const { business } = useAuth();
  const { fmt, symbol } = useCurrency();
  const [searchParams] = useSearchParams();
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState(() => searchParams.get("q") || "");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState(() => searchParams.get("status") || "all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<any>(empty);
  const [busy, setBusy] = useState(false);
  const [adjustTarget, setAdjustTarget] = useState<Product | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    const { data, error } = await supabase.from("products").select("*").order("created_at", { ascending: false });
    if (error) return toast.error(error.message);
    setItems((data as Product[]) || []);
    setLoading(false);
  };

  useEffect(() => { if (business) load(); }, [business]);

  const openAdd = () => { setEditing(null); setForm(empty); setOpen(true); };
  const openEdit = (p: Product) => { setEditing(p); setForm(p); setOpen(true); };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business) return;
    if (!editing && isAtLimit(items.length, business.subscription_tier, "products")) {
      toast.error(limitMessage("products"));
      return;
    }
    const sku = (form.sku || "").trim();
    if (!sku) { toast.error("SKU is required"); return; }
    const dup = items.find(p => p.id !== editing?.id && p.sku?.trim().toLowerCase() === sku.toLowerCase());
    if (dup) { toast.error(`SKU "${sku}" is already used by ${dup.name}`); return; }
    setBusy(true);
    const payload = {
      name: form.name,
      category: form.category || null,
      sku,
      unit: form.unit || "pcs",
      selling_price: Number(form.selling_price) || 0,
      cost_price: Number(form.cost_price) || 0,
      reorder_level: Number(form.reorder_level) || 0,
    };
    const { error } = editing
      ? await supabase.from("products").update(payload).eq("id", editing.id)
      : await supabase.from("products").insert({ ...payload, stock_quantity: Number(form.stock_quantity) || 0, business_id: business.id });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(editing ? "Product updated" : "Product added");
    setOpen(false);
    load();
  };

  const downloadTemplate = () => {
    const headers = ["name", "category", "sku", "unit", "selling_price", "cost_price", "stock_quantity", "reorder_level"];
    const example = ["Garri 50kg", "Foodstuff", "GAR-50", "bag", "8500", "6000", "20", "5"];
    const csv = [headers.join(","), example.join(",")].join("\n");
    downloadCsv("products-template.csv", csv);
    toast.success("Template downloaded");
  };

  const exportCsv = () => {
    const rows = items.map(p => ({
      name: p.name, category: p.category || "", sku: p.sku || "", unit: p.unit || "pcs",
      selling_price: p.selling_price, cost_price: p.cost_price,
      stock_quantity: p.stock_quantity, reorder_level: p.reorder_level,
    }));
    downloadCsv(`products-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(rows, ["name", "category", "sku", "unit", "selling_price", "cost_price", "stock_quantity", "reorder_level"]));
    toast.success(`Exported ${rows.length} product${rows.length === 1 ? "" : "s"}`);
  };

  const importCsv = async (file: File) => {
    if (!business) return;
    try {
      const text = await readFileText(file);
      const rows = parseCsv(text);
      const usable = rows.filter(r => r.name?.trim() && r.sku?.trim());
      const noSku = rows.filter(r => r.name?.trim() && !r.sku?.trim()).length;
      if (usable.length === 0) return toast.error("No valid rows. Required columns: name, sku");

      // Aggregate by SKU (case-insensitive) so duplicate rows in the file merge.
      const agg = new Map<string, { fields: Record<string, unknown>; qty: number }>();
      for (const r of usable) {
        const key = r.sku.trim().toLowerCase();
        const fields: Record<string, unknown> = {
          name: r.name.trim(),
          category: r.category || null,
          sku: r.sku.trim(),
          unit: r.unit || "pcs",
          selling_price: Number(r.selling_price) || 0,
          cost_price: Number(r.cost_price) || 0,
          reorder_level: Number(r.reorder_level) || 5,
        };
        const prev = agg.get(key);
        agg.set(key, { fields, qty: (prev?.qty || 0) + (Number(r.stock_quantity) || 0) });
      }

      const existingBySku = new Map(items.filter(p => p.sku).map(p => [p.sku!.trim().toLowerCase(), p]));
      const toUpdate: { id: string; fields: Record<string, unknown>; stock: number }[] = [];
      const toInsert: Record<string, unknown>[] = [];
      for (const [key, a] of agg) {
        const ex = existingBySku.get(key);
        if (ex) toUpdate.push({ id: ex.id, fields: a.fields, stock: Number(ex.stock_quantity) + a.qty });
        else toInsert.push({ ...a.fields, stock_quantity: a.qty, business_id: business.id });
      }

      // The plan limit only restricts NEW products; restocks of existing ones are always allowed.
      const limit = getLimit(business.subscription_tier, "products");
      let insertList = toInsert;
      let overLimit = 0;
      if (limit !== null) {
        const capacity = Math.max(0, limit - items.length);
        if (toInsert.length > capacity) { overLimit = toInsert.length - capacity; insertList = toInsert.slice(0, capacity); }
      }

      let updated = 0;
      for (const u of toUpdate) {
        const { error } = await supabase.from("products").update({ ...u.fields, stock_quantity: u.stock }).eq("id", u.id);
        if (!error) updated++;
      }
      if (insertList.length > 0) {
        const { error } = await supabase.from("products").insert(insertList as never);
        if (error) return toast.error(error.message);
      }

      const parts: string[] = [];
      if (insertList.length) parts.push(`${insertList.length} added`);
      if (updated) parts.push(`${updated} restocked`);
      if (overLimit) parts.push(`${overLimit} skipped (plan limit)`);
      if (noSku) parts.push(`${noSku} skipped (no SKU)`);
      toast.success(parts.length ? `Import: ${parts.join(", ")}` : "Nothing to import");
      load();
    } catch (e: any) {
      toast.error(e.message || "Import failed");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const categories = [...new Set(items.map(i => i.category).filter(Boolean) as string[])].sort();

  const filtered = items.filter(i => {
    if (q && !i.name.toLowerCase().includes(q.toLowerCase()) && !i.sku?.toLowerCase().includes(q.toLowerCase())) return false;
    if (categoryFilter !== "all" && i.category !== categoryFilter) return false;
    if (statusFilter !== "all") {
      const stock = Number(i.stock_quantity);
      const reorder = Number(i.reorder_level);
      if (statusFilter === "in_stock" && !(stock > reorder)) return false;
      if (statusFilter === "low_stock" && !(stock > 0 && stock <= reorder)) return false;
      if (statusFilter === "out_of_stock" && stock > 0) return false;
    }
    return true;
  });
  const { paged, page, setPage, pageSize, setPageSize, pageCount, total } = usePagination(filtered, 20);

  // Sync filters from the URL on same-route navigation (deep-links while already mounted).
  useEffect(() => {
    const qp = searchParams.get("q");
    const sp = searchParams.get("status");
    if (qp !== null) setQ(qp);
    if (sp !== null) setStatusFilter(sp);
    if (qp !== null || sp !== null) setPage(1);
  }, [searchParams, setPage]);

  const statusOf = (p: Product) => {
    const stock = Number(p.stock_quantity);
    const reorder = Number(p.reorder_level);
    if (stock <= 0) return { label: "Out of stock", className: "bg-danger/10 text-danger border-danger/20" };
    if (stock <= reorder) return { label: "Low stock", className: "bg-warning/10 text-warning border-warning/20" };
    return { label: "In stock", className: "bg-brand-light text-brand-dark border-brand/20" };
  };

  const tier = business?.subscription_tier;
  const productLimit = getLimit(tier, "products");
  const atProductLimit = isAtLimit(items.length, tier, "products");

  if (loading) return <TablePageSkeleton />;

  return (
    <div className="space-y-6 w-full">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl lg:text-4xl font-bold text-brand-dark">Inventory</h1>
          <p className="text-muted-foreground mt-1">Manage all your finished products and stock levels.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} />
          <Button variant="outline" onClick={downloadTemplate}><Download className="size-4" /> CSV Template</Button>
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={atProductLimit} title={atProductLimit ? limitMessage("products") : undefined}><Upload className="size-4" /> Import CSV</Button>
          <Button variant="outline" onClick={exportCsv} disabled={items.length === 0}><Download className="size-4" /> Export</Button>
          {productLimit !== null && items.length >= Math.floor(productLimit * 0.8) && (
            <span className={`self-center text-xs font-medium ${atProductLimit ? "text-destructive" : "text-amber-600"}`}>
              {items.length} / {productLimit}
            </span>
          )}
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="hero" onClick={openAdd} disabled={atProductLimit} title={atProductLimit ? limitMessage("products") : undefined}><Plus className="size-4" /> Add product</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle className="font-display">{editing ? "Edit product" : "Add a new product"}</DialogTitle>
              </DialogHeader>
              <form onSubmit={save} className="space-y-4">
                <div className="space-y-2">
                  <Label>Product name</Label>
                  <Input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Garri (50kg)" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Category</Label>
                    <Input value={form.category || ""} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="Foodstuff" />
                  </div>
                  <div className="space-y-2">
                    <Label>SKU / barcode *</Label>
                    <Input required value={form.sku || ""} onChange={e => setForm({ ...form, sku: e.target.value })} placeholder="GAR-50" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Selling price ({symbol})</Label>
                    <Input type="number" min="0" step="0.01" placeholder="0" value={form.selling_price} onChange={e => setForm({ ...form, selling_price: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Cost price ({symbol})</Label>
                    <Input type="number" min="0" step="0.01" placeholder="0" value={form.cost_price} onChange={e => setForm({ ...form, cost_price: e.target.value })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Stock quantity</Label>
                    <Input type="number" min="0" step="1" placeholder="0" value={form.stock_quantity} disabled={!!editing} onChange={e => setForm({ ...form, stock_quantity: e.target.value })} />
                    {editing && <p className="text-xs text-muted-foreground">Use “Adjust stock” to change quantity.</p>}
                  </div>
                  <div className="space-y-2">
                    <Label>Reorder level</Label>
                    <Input type="number" min="0" step="1" value={form.reorder_level} onChange={e => setForm({ ...form, reorder_level: e.target.value })} />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button type="submit" variant="brand" disabled={busy}>{busy ? "Saving..." : editing ? "Save changes" : "Add product"}</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card className="shadow-card border-border/60">
        <div className="p-4 border-b border-border flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[180px] max-w-sm">
            <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name or SKU" className="pl-9" />
          </div>
          <SearchableSelect
            value={categoryFilter}
            onValueChange={setCategoryFilter}
            className="w-40"
            placeholder="Category"
            options={[
              { value: "all", label: "All categories" },
              ...categories.map(c => ({ value: c, label: c })),
            ]}
          />
          <SearchableSelect
            value={statusFilter}
            onValueChange={setStatusFilter}
            className="w-36"
            placeholder="Status"
            options={[
              { value: "all", label: "All statuses" },
              { value: "in_stock", label: "In stock" },
              { value: "low_stock", label: "Low stock" },
              { value: "out_of_stock", label: "Out of stock" },
            ]}
          />
          <div className="text-sm text-muted-foreground ml-auto">{filtered.length} of {items.length}</div>
        </div>

        {filtered.length === 0 ? (
          <div className="p-12 text-center">
            <div className="size-14 rounded-2xl bg-brand-light text-brand grid place-items-center mx-auto mb-4">
              <Package className="size-6" />
            </div>
            <h3 className="font-display text-lg font-semibold text-brand-dark">No products yet</h3>
            <p className="text-muted-foreground text-sm mt-1 mb-4">Add your first product or import a CSV.</p>
            <Button variant="brand" onClick={openAdd} disabled={atProductLimit}><Plus className="size-4" /> Add product</Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3 text-right">Stock</th>
                  <th className="px-4 py-3 text-right">Price</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paged.map(p => {
                  const s = statusOf(p);
                  return (
                    <tr key={p.id} className="border-b border-border/50 hover:bg-secondary/40 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-brand-dark">{p.name}</div>
                        {p.sku && <div className="text-xs text-muted-foreground">{p.sku}</div>}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{p.category || "Uncategorized"}</td>
                      <td className="px-4 py-3 text-right font-medium">{Number(p.stock_quantity)} <span className="text-xs text-muted-foreground">{p.unit}</span></td>
                      <td className="px-4 py-3 text-right font-display font-semibold text-brand-dark">{fmt(p.selling_price)}</td>
                      <td className="px-4 py-3"><Badge variant="outline" className={s.className}>{s.label}</Badge></td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <Button variant="ghost" size="icon" title="Adjust stock" onClick={() => setAdjustTarget(p)}><SlidersHorizontal className="size-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => openEdit(p)}><Pencil className="size-4" /></Button>
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

      <StockAdjustDialog
        open={!!adjustTarget}
        onOpenChange={(v) => !v && setAdjustTarget(null)}
        target={adjustTarget ? { kind: "product", id: adjustTarget.id, name: adjustTarget.name, unit: adjustTarget.unit, stock_quantity: Number(adjustTarget.stock_quantity) } : null}
        onSaved={load}
      />
    </div>
  );
}
