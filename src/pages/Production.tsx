import { useCallback, useEffect, useMemo, useState } from "react";
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
import RecipeEditorDialog from "@/components/RecipeEditorDialog";
import { TablePageSkeleton } from "@/components/Skeletons";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useDateFormat } from "@/hooks/useDateFormat";
import { Factory, Plus, Pencil, Trash2, MoreHorizontal, ClipboardList, PackagePlus } from "lucide-react";
import {
  listRecipes, listRequisitions, listRuns, saveRecipe,
  createRequisition, updateRequisition, deleteRequisition, recordProductionRun,
  validateLines, friendlyProductionError, canTransition,
  REQUISITION_STATUS_LABEL, REQUISITION_STATUS_CLASS,
  type Recipe, type Requisition, type Run,
} from "@/lib/production";

const TABS = [{ key: "recipes", label: "Recipes" }, { key: "requests", label: "Requests" }, { key: "runs", label: "Runs" }] as const;
type TabKey = (typeof TABS)[number]["key"];

type MaterialRow = { id: string; name: string; unit: string | null; stock_quantity: number };
type ProductRow = { id: string; name: string; unit: string | null };
type QtyLine = { key_id: string; quantity: string };

export default function Production() {
  const { business, user, can } = useAuth();
  const { fmtDate } = useDateFormat();
  const [searchParams] = useSearchParams();
  const initialTab = (searchParams.get("tab") as TabKey | null) ?? "recipes";
  const [tab, setTab] = useState<TabKey>(TABS.some(t => t.key === initialTab) ? initialTab : "recipes");
  const [loading, setLoading] = useState(true);

  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [requisitions, setRequisitions] = useState<Requisition[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [materials, setMaterials] = useState<MaterialRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);

  // dialogs
  const [recipeOpen, setRecipeOpen] = useState(false);
  const [recipeProduct, setRecipeProduct] = useState<string | null>(null);
  const [deleteRecipe, setDeleteRecipe] = useState<Recipe | null>(null);
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
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!business) return;
    try {
      const [rec, req, rn, mat, prod] = await Promise.all([
        listRecipes(), listRequisitions(), listRuns(),
        supabase.from("raw_materials").select("id,name,unit,stock_quantity").order("name"),
        supabase.from("products").select("id,name,unit").order("name"),
      ]);
      setRecipes(rec); setRequisitions(req); setRuns(rn);
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
      .map(m => `${m.raw_materials?.name ?? matName(m.raw_material_id)} × ${Number(m.quantity_used)}${m.raw_materials?.unit ? ` ${m.raw_materials.unit}` : ""}`)
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
  const openRun = (requisitionId = "") => {
    setRunReq(requisitionId);
    setRunOutputs([{ key_id: "", quantity: "" }]);
    setRunNotes("");
    const req = approvedReqs.find(r => r.id === requisitionId);
    setRunMaterials(req
      ? req.production_requisition_items.map(i => ({ key_id: i.raw_material_id, quantity: String(i.quantity_issued ?? i.quantity_requested) }))
      : []);
    setRunOpen(true);
  };

  const onRunReqChange = (id: string) => {
    setRunReq(id);
    const req = approvedReqs.find(r => r.id === id);
    setRunMaterials(req
      ? req.production_requisition_items.map(i => ({ key_id: i.raw_material_id, quantity: String(i.quantity_issued ?? i.quantity_requested) }))
      : []);
  };

  const submitRun = async () => {
    if (!business) return;
    const outputs = runOutputs.map(l => ({ product_id: l.key_id, quantity: Number(l.quantity) }));
    if (outputs.length === 0 || outputs.some(o => !o.product_id || !(o.quantity > 0))) {
      return toast.error("Add at least one produced product with a quantity above zero.");
    }
    const mats = runMaterials
      .filter(l => l.key_id)
      .map(l => ({ raw_material_id: l.key_id, quantity_used: Number(l.quantity) || 0 }));
    setBusy(true);
    try {
      await recordProductionRun({
        businessId: business.id,
        requisitionId: runReq || null,
        outputs,
        materials: mats,
        notes: runNotes,
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

  const removeRecipe = async () => {
    if (!deleteRecipe) return;
    try {
      await saveRecipe(deleteRecipe.product_id, []);
      toast.success("Recipe removed");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't remove the recipe");
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

  if (loading) return <TablePageSkeleton />;

  return (
    <div className="space-y-6 w-full">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl lg:text-4xl font-bold text-brand-dark flex items-center gap-2">
            <Factory className="size-7" /> Production
          </h1>
          <p className="text-muted-foreground mt-1">Recipes, material requests and production runs that turn raw materials into stock.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {tab === "recipes" && can("production", "recipes_manage") && (
            <Button variant="hero" onClick={() => { setRecipeProduct(null); setRecipeOpen(true); }}><Plus className="size-4" /> Add recipe</Button>
          )}
          {tab === "requests" && can("production", "request") && (
            <Button variant="hero" onClick={openNewRequest}><ClipboardList className="size-4" /> Request materials</Button>
          )}
          {tab === "runs" && can("production", "produce") && (
            <Button variant="hero" onClick={() => openRun()}><PackagePlus className="size-4" /> Record production</Button>
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

      {/* ------------------------------------------------ Recipes */}
      {tab === "recipes" && (
        <Card className="shadow-card border-border/60">
          {recipes.length === 0 ? (
            <div className="p-12 text-center">
              <div className="size-14 rounded-2xl bg-brand-light text-brand grid place-items-center mx-auto mb-4"><Factory className="size-6" /></div>
              <h3 className="font-display text-lg font-semibold text-brand-dark">No recipes yet</h3>
              <p className="text-muted-foreground text-sm mt-1 mb-4">Link raw materials to a product to describe what one unit is made of.</p>
              {can("production", "recipes_manage") && (
                <Button variant="brand" onClick={() => { setRecipeProduct(null); setRecipeOpen(true); }}><Plus className="size-4" /> Add recipe</Button>
              )}
            </div>
          ) : (
            <>
              <div className="hidden sm:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead><TableHead>Materials per unit</TableHead><TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recipes.map(r => (
                      <TableRow key={r.product_id}>
                        <TableCell className="font-medium text-brand-dark">{r.product_name}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {r.lines.map(l => `${l.raw_materials?.name ?? "Material"} × ${l.quantity_per_unit}${l.raw_materials?.unit ? ` ${l.raw_materials.unit}` : ""}`).join(" · ")}
                        </TableCell>
                        <TableCell className="text-right">
                          {can("production", "recipes_manage") && (
                            <div className="flex gap-1 justify-end">
                              <Button variant="ghost" size="sm" onClick={() => { setRecipeProduct(r.product_id); setRecipeOpen(true); }}><Pencil className="size-4" /> Edit</Button>
                              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={() => setDeleteRecipe(r)}><Trash2 className="size-4" /> Delete</Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="sm:hidden divide-y">
                {recipes.map(r => (
                  <div key={r.product_id} className="p-4 space-y-1">
                    <p className="font-medium text-brand-dark">{r.product_name}</p>
                    <p className="text-sm text-muted-foreground">
                      {r.lines.map(l => `${l.raw_materials?.name ?? "Material"} × ${l.quantity_per_unit}${l.raw_materials?.unit ? ` ${l.raw_materials.unit}` : ""}`).join(" · ")}
                    </p>
                    {can("production", "recipes_manage") && (
                      <div className="flex gap-1 pt-1">
                        <Button variant="ghost" size="sm" onClick={() => { setRecipeProduct(r.product_id); setRecipeOpen(true); }}><Pencil className="size-4" /> Edit</Button>
                        <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={() => setDeleteRecipe(r)}><Trash2 className="size-4" /> Delete</Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      )}

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
              <p className="text-muted-foreground text-sm mt-1 mb-4">Record a run to add produced quantities to product stock.</p>
              {can("production", "produce") && (
                <Button variant="brand" onClick={() => openRun()}><PackagePlus className="size-4" /> Record production</Button>
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
                            ? r.production_run_materials.map(m => `${m.raw_materials?.name ?? "Material"} × ${m.quantity_used}`).join(" · ")
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
                      <p className="text-xs text-muted-foreground">{r.production_run_materials.map(m => `${m.raw_materials?.name ?? "Material"} × ${m.quantity_used}`).join(" · ")}</p>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      )}

      {/* ------------------------------------------------ dialogs */}
      <RecipeEditorDialog
        open={recipeOpen}
        onClose={() => setRecipeOpen(false)}
        onSaved={load}
        productId={recipeProduct}
      />

      <ConfirmDialog
        open={!!deleteRecipe}
        onOpenChange={(o) => !o && setDeleteRecipe(null)}
        title={`Remove the recipe for ${deleteRecipe?.product_name ?? "this product"}?`}
        description="Past production runs keep their recorded quantities — only the template is removed."
        confirmLabel="Remove recipe"
        onConfirm={removeRecipe}
      />

      <Dialog open={requestOpen} onOpenChange={(o) => { if (!o) { setRequestOpen(false); setEditingReq(null); } }}>
        <DialogContent className="max-w-lg">
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
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="font-display">Record production</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>From approved request <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <SearchableSelect
                value={runReq}
                onValueChange={onRunReqChange}
                placeholder="Direct run — no request"
                options={[
                  { value: "", label: "Direct run — no request" },
                  ...approvedReqs.map(r => ({
                    value: r.id,
                    label: `${fmtDate(r.created_at)} · ${r.production_requisition_items.map(i => i.raw_materials?.name ?? "Material").join(", ")}`,
                  })),
                ]}
              />
            </div>
            <div className="space-y-2">
              <Label>Products produced *</Label>
              {qtyLineEditor(runOutputs, setRunOutputs, products.map(p => ({ value: p.id, label: p.name })), "Product", (id) => products.find(p => p.id === id)?.unit || "")}
            </div>
            <div className="space-y-2">
              <Label>Materials used {runReq ? <span className="font-normal text-muted-foreground">(issued amounts prefilled — adjust to what was actually used; leftovers restock automatically)</span> : <span className="font-normal text-muted-foreground">(deducted from stock now)</span>}</Label>
              {qtyLineEditor(runMaterials, setRunMaterials, materials.map(m => ({ value: m.id, label: m.name })), "Material", matUnit)}
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
