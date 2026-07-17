import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import SearchableSelect from "@/components/SearchableSelect";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { saveRecipe, validateLines } from "@/lib/production";
import { useCurrency } from "@/hooks/useCurrency";

// Shared recipe (BOM) editor: which raw materials — and how much of each — go into ONE unit of a
// product. Opened from the Production → Recipes tab (by product) and from a Raw Materials row
// ("Link to product", seeded with that material). Shows a live unit-cost estimate from the recipe
// (materials × cost + optional labour/overhead) with one-tap write-back to the product's cost price.

type Line = { raw_material_id: string; quantity: string };

type ProductOpt = { id: string; name: string; unit: string | null; cost_price: number | null };
type MaterialOpt = { id: string; name: string; unit: string | null; cost_per_unit: number | null };

export default function RecipeEditorDialog({
  open, onClose, onSaved, productId, seedMaterialId,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** Editing an existing product's recipe (locks the product select). */
  productId?: string | null;
  /** Pre-adds this material as the first line (Raw Materials entry point). */
  seedMaterialId?: string | null;
}) {
  const { fmt } = useCurrency();
  const [products, setProducts] = useState<ProductOpt[]>([]);
  const [materials, setMaterials] = useState<MaterialOpt[]>([]);
  const [product, setProduct] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [labour, setLabour] = useState(""); // optional labour/overhead per unit
  const [busy, setBusy] = useState(false);
  const [savingCost, setSavingCost] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLabour("");
    (async () => {
      const [p, m] = await Promise.all([
        supabase.from("products").select("id,name,unit,cost_price").order("name"),
        supabase.from("raw_materials").select("id,name,unit,cost_per_unit").order("name"),
      ]);
      setProducts((p.data as ProductOpt[]) ?? []);
      setMaterials((m.data as MaterialOpt[]) ?? []);

      setProduct(productId ?? "");
      if (productId) {
         
        const { data } = await supabase.from("product_materials")
          .select("raw_material_id, quantity_per_unit").eq("product_id", productId);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const existing = ((data ?? []) as any[]).map((r) => ({ raw_material_id: r.raw_material_id, quantity: String(r.quantity_per_unit) }));
        setLines(existing.length ? existing : [{ raw_material_id: seedMaterialId ?? "", quantity: "" }]);
      } else {
        setLines([{ raw_material_id: seedMaterialId ?? "", quantity: "" }]);
      }
    })();
  }, [open, productId, seedMaterialId]);

  const matUnit = (id: string) => materials.find((m) => m.id === id)?.unit || "unit";
  const productLabel = useMemo(() => products.find((p) => p.id === product), [products, product]);

  // Live unit-cost estimate: Σ(qty per unit × material cost) + optional labour/overhead per unit.
  const estimate = useMemo(() => {
    const costById = new Map(materials.map((m) => [m.id, Number(m.cost_per_unit) || 0]));
    const materialsCost = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (costById.get(l.raw_material_id) ?? 0), 0);
    const labourCost = Number(labour) || 0;
    return { materialsCost, labourCost, unitCost: materialsCost + labourCost };
  }, [lines, labour, materials]);

  const setAsCostPrice = async () => {
    if (!product) return toast.error("Pick the product first.");
    if (estimate.unitCost <= 0) return toast.error("Add materials (with costs) to estimate a unit cost.");
    setSavingCost(true);
    const rounded = Math.round(estimate.unitCost * 100) / 100;
    const { error } = await supabase.from("products").update({ cost_price: rounded }).eq("id", product);
    setSavingCost(false);
    if (error) return toast.error(error.message);
    setProducts((prev) => prev.map((p) => (p.id === product ? { ...p, cost_price: rounded } : p)));
    toast.success(`Cost price set to ${fmt(rounded)}`);
  };

  const save = async () => {
    if (!product) return toast.error("Pick the product this recipe makes.");
    const parsed = lines.map((l) => ({ raw_material_id: l.raw_material_id, quantity: Number(l.quantity) }));
    const problems = validateLines(parsed);
    if (problems.length) return toast.error(problems[0]);
    setBusy(true);
    try {
      await saveRecipe(product, parsed.map((l) => ({ raw_material_id: l.raw_material_id, quantity_per_unit: l.quantity })));
      toast.success("Recipe saved");
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save the recipe");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent variant="wide">
        <DialogHeader>
          <DialogTitle className="font-display">{productId ? "Edit recipe" : "Link materials to a product"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Product *</Label>
            <SearchableSelect
              value={product}
              onValueChange={setProduct}
              disabled={!!productId}
              placeholder="Select a product"
              options={products.map((p) => ({ value: p.id, label: p.name }))}
            />
          </div>
          <div className="space-y-2">
            <Label>Materials used per {productLabel?.unit || "unit"} *</Label>
            <div className="space-y-2">
              {lines.map((l, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <SearchableSelect
                      value={l.raw_material_id}
                      onValueChange={(v) => setLines((prev) => prev.map((x, i) => (i === idx ? { ...x, raw_material_id: v } : x)))}
                      placeholder="Material"
                      options={materials.map((m) => ({ value: m.id, label: m.name }))}
                    />
                  </div>
                  <Input
                    type="number" min="0" step="any" placeholder="Qty"
                    className="w-24"
                    aria-label={`Quantity of material ${idx + 1}`}
                    value={l.quantity}
                    onChange={(e) => setLines((prev) => prev.map((x, i) => (i === idx ? { ...x, quantity: e.target.value } : x)))}
                  />
                  <span className="w-10 shrink-0 text-xs text-muted-foreground">{l.raw_material_id ? matUnit(l.raw_material_id) : ""}</span>
                  <Button
                    variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label={`Remove material line ${idx + 1}`}
                    onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, { raw_material_id: "", quantity: "" }])}>
              <Plus className="size-4" /> Add material
            </Button>
            <p className="text-xs text-muted-foreground">
              Quantities are per one {productLabel?.unit || "unit"} of the product — used to guide material requests and production runs.
            </p>
          </div>

          {/* Unit-cost estimator */}
          <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <Label className="text-sm">Estimated unit cost</Label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground whitespace-nowrap">Labour / overhead per unit</span>
                <Input
                  type="number" min="0" step="any" placeholder="0"
                  className="h-8 w-28"
                  aria-label="Labour and overhead per unit"
                  value={labour}
                  onChange={(e) => setLabour(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between text-muted-foreground"><span>Materials</span><span className="tabular-nums">{fmt(estimate.materialsCost)}</span></div>
              {estimate.labourCost > 0 && <div className="flex justify-between text-muted-foreground"><span>Labour / overhead</span><span className="tabular-nums">{fmt(estimate.labourCost)}</span></div>}
              <div className="flex justify-between border-t border-border pt-1 font-medium text-brand-dark">
                <span>Estimated cost per {productLabel?.unit || "unit"}</span>
                <span className="tabular-nums">{fmt(estimate.unitCost)}</span>
              </div>
              {productLabel && productLabel.cost_price != null && (
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Current cost price</span><span className="tabular-nums">{fmt(Number(productLabel.cost_price))}</span>
                </div>
              )}
            </div>
            <Button
              variant="outline" size="sm" className="w-full"
              disabled={savingCost || !product || estimate.unitCost <= 0}
              onClick={setAsCostPrice}
            >
              {savingCost ? "Saving…" : "Set as cost price"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Uses each material's current cost per unit. Setting the cost price updates the product now; recording a production run still recomputes cost from the actual materials used.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="brand" onClick={save} disabled={busy}>{busy ? "Saving..." : "Save recipe"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
