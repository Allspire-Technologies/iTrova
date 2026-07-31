import { useCallback, useEffect, useMemo, useState } from "react";
import Hint from "@/components/Hint";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
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
import { TablePageSkeleton } from "@/components/Skeletons";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useDateFormat } from "@/hooks/useDateFormat";
import { Plus, Pencil, Trash2, MoreHorizontal, ClipboardList, PackagePlus } from "lucide-react";
import {
  listRequisitions, listRuns,
  createRequisition, updateRequisition, deleteRequisition, recordProductionRun,
  validateLines, friendlyProductionError, canTransition,
  REQUISITION_STATUS_LABEL, REQUISITION_STATUS_CLASS,
  type Requisition, type Run,
} from "@/lib/production";
import { outputUnitCosts } from "@/lib/productionCost";

// Recipes (product↔material links) live on the Raw Materials page ("Link to product"); Production
// itself is just the Request → Run → Inventory mechanism.
const TABS = [{ key: "requests", label: "Requests" }, { key: "runs", label: "Runs" }] as const;
type TabKey = (typeof TABS)[number]["key"];

type MaterialRow = { id: string; name: string; unit: string | null; stock_quantity: number; cost_per_unit: number | null };
type ProductRow = { id: string; name: string; unit: string | null; cost_price: number | null; selling_price: number | null };
type QtyLine = { key_id: string; quantity: string; waste?: string; cost?: string; issued?: string };

export default function Production() {
  const { business, user, can } = useAuth();
  const { fmtDate } = useDateFormat();
  const [searchParams] = useSearchParams();
  const initialTab = (searchParams.get("tab") as TabKey | null) ?? "requests";
  const [tab, setTab] = useState<TabKey>(TABS.some(t => t.key === initialTab) ? initialTab : "requests");
  const [loading, setLoading] = useState(true);

  const [requisitions, setRequisitions] = useState<Requisition[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [materials, setMaterials] = useState<MaterialRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);

  // dialogs
  const [requestOpen, setRequestOpen] = useState(false);
  const [editingReq, setEditingReq] = useState<Requisition | null>(null);
  const [deletingReq, setDeletingReq] = useState<Requisition | null>(null);
  const [reqLines, setReqLines] = useState<QtyLine[]>([{ key_id: "", quantity: "" }]);
  const [reqNotes, setReqNotes] = useState("");
  const [runOpen, setRunOpen] = useState(false);
  const [runReq, setRunReq] = useState("");           // "" = direct run
  const [runOutputs, setRunOutputs] = useState<QtyLine[]>([{ key_id: "", quantity: "" }]);
  const [runMaterials, setRunMaterials] = useState<QtyLine[]>([]);
  const [runNotes, setRunNotes] = useState("");
  const [labourOverhead, setLabourOverhead] = useState("");
  const [shipping, setShipping] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!business) return;
    try {
      const [req, rn, mat, prod] = await Promise.all([
        listRequisitions(), listRuns(),
        supabase.from("raw_materials").select("id,name,unit,stock_quantity,cost_per_unit").order("name"),
        supabase.from("products").select("id,name,unit,cost_price,selling_price").is("archived_at", null).order("name"),
      ]);
      setRequisitions(req); setRuns(rn);
      setMaterials((mat.data as MaterialRow[]) ?? []);
      setProducts((prod.data as ProductRow[]) ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't load production data");
    } finally {
      setLoading(false);
    }
  }, [business]);

  useEffect(() => { load(); }, [load]);

  const matName = (id: string) => materials.find(m => m.id === id)?.name ?? "Material";
  const matUnit = (id: string) => materials.find(m => m.id === id)?.unit || "";
  const approvedReqs = useMemo(() => requisitions.filter(r => r.status === "approved"), [requisitions]);

  // Live auto-cost per output: (materials used+wasted × cost) + labour/overhead, allocated by selling value.
  const runUnitCosts = useMemo(() => {
    const mats = runMaterials.filter(l => l.key_id).map(l => {
      const m = materials.find(x => x.id === l.key_id);
      return { quantity_used: Number(l.quantity) || 0, quantity_wasted: Number(l.waste) || 0, cost_per_unit: m?.cost_per_unit ?? 0 };
    });
    const outs = runOutputs.map(l => {
      const p = products.find(x => x.id === l.key_id);
      return { quantity: Number(l.quantity) || 0, selling_price: p?.selling_price ?? 0, cost_price_override: (l.cost != null && l.cost !== "") ? Number(l.cost) : null };
    });
    return outputUnitCosts(outs, mats, Number(labourOverhead) || 0, Number(shipping) || 0);
  }, [runMaterials, runOutputs, labourOverhead, shipping, materials, products]);

  // The trail shown on a request: what was actually issued (when reduced at approval) and — once
  // production ran against it — which raw materials the run consumed.
  const issuedTrail = (r: Requisition): string | null => {
    if (r.status !== "approved" && r.status !== "completed") return null;
    const reduced = r.production_requisition_items.filter(i => i.quantity_issued != null && Number(i.quantity_issued) !== Number(i.quantity_requested));
    if (!reduced.length) return null;
    return "Issued: " + r.production_requisition_items
      .map(i => `${i.raw_materials?.name ?? "Material"} × ${Number(i.quantity_issued ?? i.quantity_requested)}`)
      .join(" · ");
  };
  const usageTrail = (r: Requisition): string | null => {
    if (r.status !== "completed") return null;
    const used = runs.filter(run => run.requisition_id === r.id).flatMap(run => run.production_run_materials);
    if (!used.length) return null;
    return "Used in production: " + used
      .map(m => `${m.raw_materials?.name ?? matName(m.raw_material_id)} × ${Number(m.quantity_used)}${m.raw_materials?.unit ? ` ${m.raw_materials.unit}` : ""}${Number(m.quantity_wasted) > 0 ? ` (+${Number(m.quantity_wasted)} waste)` : ""}`)
      .join(" · ");
  };

  // ------------------------------------------------ requests
  const openNewRequest = () => {
    setEditingReq(null);
    setReqLines([{ key_id: "", quantity: "" }]);
    setReqNotes("");
    setRequestOpen(true);
  };

  const openEditRequest = (r: Requisition) => {
    setEditingReq(r);
    setReqLines(r.production_requisition_items.map(i => ({ key_id: i.raw_material_id, quantity: String(i.quantity_requested) })));
    setReqNotes(r.notes ?? "");
    setRequestOpen(true);
  };

  const submitRequest = async () => {
    if (!business) return;
    const parsed = reqLines.map(l => ({ raw_material_id: l.key_id, quantity: Number(l.quantity) }));
    const problems = validateLines(parsed);
    if (problems.length) return toast.error(problems[0]);
    setBusy(true);
    try {
      if (editingReq) {
        await updateRequisition(editingReq.id, parsed, reqNotes);
        toast.success("Request updated");
      } else {
        await createRequisition(business.id, parsed, reqNotes);
        toast.success("Materials request sent for approval");
      }
      setRequestOpen(false); setEditingReq(null); setReqLines([{ key_id: "", quantity: "" }]); setReqNotes("");
      load();
    } catch (e) {
      toast.error(friendlyProductionError(e instanceof Error ? e.message : undefined, "Couldn't save the request"));
    } finally {
      setBusy(false);
    }
  };

  const doDeleteRequest = async () => {
    if (!deletingReq) return;
    try {
      await deleteRequisition(deletingReq.id);
      toast.success("Request deleted");
      load();
    } catch (e) {
      toast.error(friendlyProductionError(e instanceof Error ? e.message : undefined, "Couldn't delete the request"));
    }
  };

  // ------------------------------------------------ runs
  // Production is always recorded against an APPROVED materials request — default to the first one
  // (or the one whose "Produce" button was clicked).
  const materialsFromReq = (id: string) => {
    const req = approvedReqs.find(r => r.id === id);
    return req ? req.production_requisition_items.map(i => {
      const issued = String(i.quantity_issued ?? i.quantity_requested);
      return { key_id: i.raw_material_id, quantity: issued, waste: "", issued };
    }) : [];
  };
  const openRun = (requisitionId?: string) => {
    const id = requisitionId ?? approvedReqs[0]?.id ?? "";
    setRunReq(id);
    setRunOutputs([{ key_id: "", quantity: "" }]);
    setRunNotes("");
    setLabourOverhead("");
    setShipping("");
    setRunMaterials(materialsFromReq(id));
    setRunOpen(true);
  };

  const onRunReqChange = (id: string) => {
    setRunReq(id);
    setRunMaterials(materialsFromReq(id));
  };

  const submitRun = async () => {
    if (!business) return;
    if (!runReq) return toast.error("Pick an approved materials request to produce from.");
    const outputs = runOutputs.map(l => {
      const line: { product_id: string; quantity: number; cost_price?: number } = { product_id: l.key_id, quantity: Number(l.quantity) };
      // Only send a cost when the manager typed one — otherwise the product keeps its current cost.
      if (l.cost != null && l.cost !== "" && Number(l.cost) >= 0) line.cost_price = Number(l.cost);
      return line;
    });
    if (outputs.length === 0 || outputs.some(o => !o.product_id || !(o.quantity > 0))) {
      return toast.error("Add at least one produced product with a quantity above zero.");
    }
    const mats = runMaterials
      .filter(l => l.key_id)
      .map(l => ({ raw_material_id: l.key_id, quantity_used: Number(l.quantity) || 0, quantity_wasted: Number(l.waste) || 0 }));
    setBusy(true);
    try {
      await recordProductionRun({
        businessId: business.id,
        requisitionId: runReq,
        outputs,
        materials: mats,
        notes: runNotes,
        labourOverhead: Number(labourOverhead) || 0,
        shipping: Number(shipping) || 0,
      });
      toast.success("Production recorded — product stock updated");
      setRunOpen(false);
      load();
    } catch (e) {
      toast.error(friendlyProductionError(e instanceof Error ? e.message : undefined, "Couldn't record the production run"));
    } finally {
      setBusy(false);
    }
  };

  const qtyLineEditor = (
    lines: QtyLine[], setLines: (f: (prev: QtyLine[]) => QtyLine[]) => void,
    options: { value: string; label: string }[], placeholder: string, unitOf?: (id: string) => string,
  ) => (
    <div className="space-y-2">
      {lines.map((l, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <SearchableSelect
              value={l.key_id}
              onValueChange={(v) => setLines(prev => prev.map((x, i) => i === idx ? { ...x, key_id: v } : x))}
              placeholder={placeholder}
              options={options}
            />
          </div>
          <Input
            type="number" min="0" step="any" placeholder="Qty" className="w-24"
            aria-label={`${placeholder} quantity ${idx + 1}`}
            value={l.quantity}
            onChange={(e) => setLines(prev => prev.map((x, i) => i === idx ? { ...x, quantity: e.target.value } : x))}
          />
          {unitOf && <span className="w-10 shrink-0 text-xs text-muted-foreground">{l.key_id ? unitOf(l.key_id) : ""}</span>}
          <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-destructive"
            aria-label={`Remove ${placeholder.toLowerCase()} line ${idx + 1}`}
            onClick={() => setLines(prev => prev.filter((_, i) => i !== idx))}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => setLines(prev => [...prev, { key_id: "", quantity: "" }])}>
        <Plus className="size-4" /> Add line
      </Button>
    </div>
  );

  // Run materials editor — like qtyLineEditor but with a second "Waste" column for material
  // spoiled/lost during the run. Waste is consumed from stock alongside what's used.
  const runMaterialsEditor = () => (
    <div className="space-y-2">
      <div className="hidden sm:flex items-center gap-2 px-1 text-xs text-muted-foreground">
        <span className="flex-1">Material</span>
        <span className="w-20 text-center">Used</span>
        <span className="w-20 text-center">Waste</span>
        <span className="w-10" /><span className="size-10 shrink-0" />
      </div>
      {runMaterials.map((l, idx) => (
        <div key={idx} className="rounded-lg border border-border/60 p-2 space-y-2 sm:border-0 sm:p-0 sm:space-y-0 sm:flex sm:items-center sm:gap-2">
          <div className="flex-1 min-w-0">
            <SearchableSelect
              value={l.key_id}
              onValueChange={(v) => setRunMaterials(prev => prev.map((x, i) => i === idx ? { ...x, key_id: v } : x))}
              placeholder="Material"
              options={materials.map(m => ({ value: m.id, label: m.name }))}
            />
          </div>
          <div className="flex items-center gap-2 sm:contents">
            <Input
              type="number" min="0" step="any" placeholder="Used" className="flex-1 sm:w-20 sm:flex-none"
              aria-label={`Material used quantity ${idx + 1}`}
              value={l.quantity}
              onChange={(e) => setRunMaterials(prev => prev.map((x, i) => i === idx ? { ...x, quantity: e.target.value } : x))}
            />
            <Input
              type="number" min="0" step="any" placeholder="Waste" className="flex-1 sm:w-20 sm:flex-none"
              aria-label={`Material wasted quantity ${idx + 1}`}
              value={l.waste ?? ""}
              onChange={(e) => {
                const w = e.target.value;
                setRunMaterials(prev => prev.map((x, i) => {
                  if (i !== idx) return x;
                  // For a requisition-issued line, waste comes out of what was issued (already deducted
                  // at approval), so reduce Used to keep used + waste ≤ issued — no double deduction.
                  if (x.issued == null || x.issued === "") return { ...x, waste: w };
                  const used = Math.max(0, (Number(x.issued) || 0) - (Number(w) || 0));
                  return { ...x, waste: w, quantity: String(used) };
                }));
              }}
            />
            <span className="w-10 shrink-0 text-xs text-muted-foreground">{l.key_id ? matUnit(l.key_id) : ""}</span>
            <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-destructive"
              aria-label={`Remove material line ${idx + 1}`}
              onClick={() => setRunMaterials(prev => prev.filter((_, i) => i !== idx))}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => setRunMaterials(prev => [...prev, { key_id: "", quantity: "", waste: "" }])}>
        <Plus className="size-4" /> Add line
      </Button>
    </div>
  );

  // Run outputs editor — product + quantity + an optional new cost price per unit. Leaving cost blank
  // keeps the product's current cost; entering one updates it (production cost drifts batch to batch).
  const runOutputsEditor = () => (
    <div className="space-y-2">
      <div className="hidden sm:flex items-center gap-2 px-1 text-xs text-muted-foreground">
        <span className="flex-1">Product</span>
        <span className="w-20 text-center">Qty</span>
        <span className="w-10" />
        <span className="w-24 text-center">Cost/unit</span>
        <span className="size-10 shrink-0" />
      </div>
      {runOutputs.map((l, idx) => {
        const prod = products.find(p => p.id === l.key_id);
        return (
          <div key={idx} className="rounded-lg border border-border/60 p-2 space-y-2 sm:border-0 sm:p-0 sm:space-y-0 sm:flex sm:items-center sm:gap-2">
            <div className="flex-1 min-w-0">
              <SearchableSelect
                value={l.key_id}
                onValueChange={(v) => setRunOutputs(prev => prev.map((x, i) => i === idx ? { ...x, key_id: v } : x))}
                placeholder="Product"
                options={products.map(p => ({ value: p.id, label: p.name }))}
              />
            </div>
            <div className="flex items-center gap-2 sm:contents">
              <Input
                type="number" min="0" step="any" placeholder="Qty" className="flex-1 sm:w-20 sm:flex-none"
                aria-label={`Product quantity ${idx + 1}`}
                value={l.quantity}
                onChange={(e) => setRunOutputs(prev => prev.map((x, i) => i === idx ? { ...x, quantity: e.target.value } : x))}
              />
              <span className="w-10 shrink-0 text-xs text-muted-foreground">{prod?.unit || ""}</span>
              <Input
                type="number" min="0" step="any" className="flex-1 sm:w-24 sm:flex-none"
                placeholder={runUnitCosts[idx] ? String(runUnitCosts[idx]) : (prod && prod.cost_price != null ? String(prod.cost_price) : "Cost")}
                aria-label={`Product cost price ${idx + 1}`}
                value={l.cost ?? ""}
                onChange={(e) => setRunOutputs(prev => prev.map((x, i) => i === idx ? { ...x, cost: e.target.value } : x))}
              />
              <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-destructive"
                aria-label={`Remove product line ${idx + 1}`}
                onClick={() => setRunOutputs(prev => prev.filter((_, i) => i !== idx))}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>
        );
      })}
      <Button variant="outline" size="sm" onClick={() => setRunOutputs(prev => [...prev, { key_id: "", quantity: "" }])}>
        <Plus className="size-4" /> Add line
      </Button>
      <p className="px-1 text-xs text-muted-foreground">Cost/unit is auto-calculated from the materials used (+ waste) plus any labour/overhead and shipping, split across products by selling value. Type a figure to override.</p>
    </div>
  );

  if (loading) return <TablePageSkeleton />;

  return (
    <div className="space-y-6 w-full">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl lg:text-4xl font-bold text-brand-dark">Production</h1>
          <p className="text-muted-foreground mt-1">Request raw materials, then record production runs that turn them into product stock.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {tab === "requests" && can("production", "request") && (
            <Button variant="hero" onClick={openNewRequest}><ClipboardList className="size-4" /> Request materials</Button>
          )}
          {tab === "runs" && can("production", "produce") && (
            <Hint label={approvedReqs.length === 0 ? "Get a materials request approved first" : undefined} wrap><Button variant="hero" onClick={() => openRun()} disabled={approvedReqs.length === 0}><PackagePlus className="size-4" /> Record production</Button></Hint>
          )}
        </div>
      </div>

      <div className="flex border-b border-border">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors", tab === t.key ? "border-brand text-brand-dark" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ------------------------------------------------ Requests */}
      {tab === "requests" && (
        <Card className="shadow-card border-border/60">
          {requisitions.length === 0 ? (
            <div className="p-12 text-center">
              <div className="size-14 rounded-2xl bg-brand-light text-brand grid place-items-center mx-auto mb-4"><ClipboardList className="size-6" /></div>
              <h3 className="font-display text-lg font-semibold text-brand-dark">No material requests yet</h3>
              <p className="text-muted-foreground text-sm mt-1 mb-4">Request the raw materials you need — a manager approves and the stock is issued.</p>
              {can("production", "request") && (
                <Button variant="brand" onClick={openNewRequest}><ClipboardList className="size-4" /> Request materials</Button>
              )}
            </div>
          ) : (
            <>
              <div className="hidden sm:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead><TableHead>Materials</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {requisitions.map(r => (
                      <TableRow key={r.id}>
                        <TableCell className="whitespace-nowrap">{fmtDate(r.created_at)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {r.production_requisition_items.map(i => `${i.raw_materials?.name ?? "Material"} × ${i.quantity_requested}${i.raw_materials?.unit ? ` ${i.raw_materials.unit}` : ""}`).join(" · ")}
                          {r.notes ? <span className="block text-xs">{r.notes}</span> : null}
                          {r.status === "rejected" && r.decision_note ? <span className="block text-xs text-danger">Reason: {r.decision_note}</span> : null}
                          {issuedTrail(r) && <span className="block text-xs text-brand-dark">{issuedTrail(r)}</span>}
                          {usageTrail(r) && <span className="block text-xs text-brand-dark">{usageTrail(r)}</span>}
                        </TableCell>
                        <TableCell><Badge variant="outline" className={REQUISITION_STATUS_CLASS[r.status]}>{REQUISITION_STATUS_LABEL[r.status]}</Badge></TableCell>
                        <TableCell className="text-right"><RequestActions r={r} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="sm:hidden divide-y">
                {requisitions.map(r => (
                  <div key={r.id} className="p-4 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-brand-dark">{fmtDate(r.created_at)}</p>
                      <Badge variant="outline" className={REQUISITION_STATUS_CLASS[r.status]}>{REQUISITION_STATUS_LABEL[r.status]}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {r.production_requisition_items.map(i => `${i.raw_materials?.name ?? "Material"} × ${i.quantity_requested}`).join(" · ")}
                    </p>
                    {issuedTrail(r) && <p className="text-xs text-brand-dark">{issuedTrail(r)}</p>}
                    {usageTrail(r) && <p className="text-xs text-brand-dark">{usageTrail(r)}</p>}
                    <RequestActions r={r} />
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      )}

      {/* ------------------------------------------------ Runs */}
      {tab === "runs" && (
        <Card className="shadow-card border-border/60">
          {runs.length === 0 ? (
            <div className="p-12 text-center">
              <div className="size-14 rounded-2xl bg-brand-light text-brand grid place-items-center mx-auto mb-4"><PackagePlus className="size-6" /></div>
              <h3 className="font-display text-lg font-semibold text-brand-dark">No production recorded yet</h3>
              <p className="text-muted-foreground text-sm mt-1 mb-4">
                {approvedReqs.length === 0
                  ? "Once a materials request is approved, record what you produced from it here."
                  : "Record what you produced from an approved materials request to add it to product stock."}
              </p>
              {can("production", "produce") && (
                <Hint label={approvedReqs.length === 0 ? "Get a materials request approved first" : undefined} wrap><Button variant="brand" onClick={() => openRun()} disabled={approvedReqs.length === 0}><PackagePlus className="size-4" /> Record production</Button></Hint>
              )}
            </div>
          ) : (
            <>
              <div className="hidden sm:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead><TableHead>Produced</TableHead><TableHead>Materials used</TableHead><TableHead>Source</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.map(r => (
                      <TableRow key={r.id}>
                        <TableCell className="whitespace-nowrap">{fmtDate(r.created_at)}</TableCell>
                        <TableCell className="text-sm font-medium text-brand-dark">
                          {r.production_run_outputs.map(o => `${o.products?.name ?? "Product"} +${o.quantity}`).join(" · ")}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {r.production_run_materials.length
                            ? r.production_run_materials.map(m => `${m.raw_materials?.name ?? "Material"} × ${m.quantity_used}${Number(m.quantity_wasted) > 0 ? ` (+${m.quantity_wasted} waste)` : ""}`).join(" · ")
                            : "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={r.requisition_id ? "bg-brand-light text-brand-dark border-brand/20" : "bg-muted text-muted-foreground border-border"}>
                            {r.requisition_id ? "From request" : "Direct"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="sm:hidden divide-y">
                {runs.map(r => (
                  <div key={r.id} className="p-4 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-brand-dark">{fmtDate(r.created_at)}</p>
                      <Badge variant="outline" className={r.requisition_id ? "bg-brand-light text-brand-dark border-brand/20" : "bg-muted text-muted-foreground border-border"}>
                        {r.requisition_id ? "From request" : "Direct"}
                      </Badge>
                    </div>
                    <p className="text-sm text-brand-dark">{r.production_run_outputs.map(o => `${o.products?.name ?? "Product"} +${o.quantity}`).join(" · ")}</p>
                    {r.production_run_materials.length > 0 && (
                      <p className="text-xs text-muted-foreground">{r.production_run_materials.map(m => `${m.raw_materials?.name ?? "Material"} × ${m.quantity_used}${Number(m.quantity_wasted) > 0 ? ` (+${m.quantity_wasted} waste)` : ""}`).join(" · ")}</p>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      )}

      {/* ------------------------------------------------ dialogs */}
      <Dialog open={requestOpen} onOpenChange={(o) => { if (!o) { setRequestOpen(false); setEditingReq(null); } }}>
        <DialogContent variant="wide">
          <DialogHeader><DialogTitle className="font-display">{editingReq ? "Edit materials request" : "Request materials"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Materials *</Label>
              {qtyLineEditor(reqLines, setReqLines, materials.map(m => ({ value: m.id, label: m.name })), "Material", matUnit)}
            </div>
            <div className="space-y-2">
              <Label>Notes <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Textarea value={reqNotes} onChange={(e) => setReqNotes(e.target.value)} placeholder="What is this for? e.g. Saturday garri batch" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setRequestOpen(false); setEditingReq(null); }}>Cancel</Button>
            <Button variant="brand" onClick={submitRequest} disabled={busy}>
              {busy ? "Saving..." : editingReq ? "Save changes" : "Send request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deletingReq}
        onOpenChange={(o) => !o && setDeletingReq(null)}
        title="Delete this request?"
        description="The request will be removed completely. No stock has moved yet."
        confirmLabel="Delete request"
        onConfirm={doDeleteRequest}
      />

      <Dialog open={runOpen} onOpenChange={(o) => !o && setRunOpen(false)}>
        <DialogContent variant="wide">
          <DialogHeader><DialogTitle className="font-display">Record production</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>From approved request *</Label>
              <SearchableSelect
                value={runReq}
                onValueChange={onRunReqChange}
                placeholder="Select an approved request"
                options={approvedReqs.map(r => ({
                  value: r.id,
                  label: `${fmtDate(r.created_at)} · ${r.production_requisition_items.map(i => i.raw_materials?.name ?? "Material").join(", ")}`,
                }))}
              />
              <p className="text-xs text-muted-foreground">Production is recorded against the materials issued for an approved request.</p>
            </div>
            <div className="space-y-2">
              <Label>Products produced * <span className="font-normal text-muted-foreground">(cost/unit auto-calculated from inputs; type to override)</span></Label>
              {runOutputsEditor()}
            </div>
            <div className="space-y-2">
              <Label>Materials used &amp; wasted <span className="font-normal text-muted-foreground">(issued amounts prefilled — adjust to what was actually used, and record any waste; leftovers restock automatically)</span></Label>
              {runMaterialsEditor()}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 max-w-md">
              <div className="space-y-2">
                <Label>Labour / overhead <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <Input type="number" min="0" step="any" placeholder="0" value={labourOverhead} onChange={(e) => setLabourOverhead(e.target.value)} aria-label="Labour and overhead" />
              </div>
              <div className="space-y-2">
                <Label>Shipping / transport <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <Input type="number" min="0" step="any" placeholder="0" value={shipping} onChange={(e) => setShipping(e.target.value)} aria-label="Shipping and transport" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Notes <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Textarea value={runNotes} onChange={(e) => setRunNotes(e.target.value)} placeholder="Batch details" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRunOpen(false)}>Cancel</Button>
            <Button variant="brand" onClick={submitRun} disabled={busy}>{busy ? "Recording..." : "Record production"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  // Row actions for a requisition — the requester's view. Approval lives on the Raw Materials page
  // (the custodian who owns stock decides); here the requester produces from an approved request
  // and edits/deletes their own pending ones.
  function RequestActions({ r }: { r: Requisition }) {
    const isRequester = r.requested_by === user?.id;
    const showProduce = can("production", "produce") && canTransition(r.status, "produce");
    const showEdit = isRequester && can("production", "request") && canTransition(r.status, "edit");
    const showDelete = isRequester && can("production", "request") && canTransition(r.status, "delete");
    if (!showProduce && !showEdit && !showDelete) return null;

    return (
      <div className="flex gap-1 justify-end">
        {showProduce && (
          <Button variant="ghost" size="sm" onClick={() => openRun(r.id)}><PackagePlus className="size-4" /> Produce</Button>
        )}
        {showEdit && (
          <Button variant="ghost" size="sm" onClick={() => openEditRequest(r)}><Pencil className="size-4" /> Edit</Button>
        )}
        {showDelete && (
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={() => setDeletingReq(r)}><Trash2 className="size-4" /> Delete</Button>
        )}
      </div>
    );
  }
}
