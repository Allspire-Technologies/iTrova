import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Minus, Plus } from "lucide-react";

type Target = {
  kind: "product" | "raw_material";
  id: string;
  name: string;
  unit?: string | null;
  stock_quantity: number;
};

const reasons = ["Damage / breakage", "Loss / theft", "Recount correction", "Customer return", "Production use", "Other"];

export default function StockAdjustDialog({
  target,
  open,
  onOpenChange,
  onSaved,
}: {
  target: Target | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const { business, user } = useAuth();
  const [direction, setDirection] = useState<"add" | "remove">("remove");
  const [qty, setQty] = useState<string>("");
  const [reason, setReason] = useState(reasons[0]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = () => { setDirection("remove"); setQty(""); setReason(reasons[0]); setNotes(""); };

  const save = async () => {
    if (!target || !business) return;
    const n = Number(qty);
    if (!n || n <= 0) return toast.error("Enter a positive quantity");
    const delta = direction === "add" ? n : -n;
    const newStock = Number(target.stock_quantity) + delta;
    if (newStock < 0) return toast.error("Not enough stock");
    setBusy(true);
    const { error: e1 } = await supabase.from("stock_adjustments").insert({
      business_id: business.id,
      product_id: target.kind === "product" ? target.id : null,
      raw_material_id: target.kind === "raw_material" ? target.id : null,
      delta,
      reason,
      notes: notes || null,
      user_id: user?.id,
    });
    if (e1) { setBusy(false); return toast.error(e1.message); }
    const table = target.kind === "product" ? "products" : "raw_materials";
    const { error: e2 } = await supabase.from(table).update({ stock_quantity: newStock }).eq("id", target.id);
    setBusy(false);
    if (e2) return toast.error(e2.message);
    toast.success(`Stock adjusted (${delta > 0 ? "+" : ""}${delta} ${target.unit || ""})`);
    reset();
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Adjust stock{target ? ` — ${target.name}` : ""}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="text-sm text-muted-foreground">Current stock: <span className="font-semibold text-brand-dark">{Number(target?.stock_quantity || 0)} {target?.unit}</span></div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setDirection("remove")} className={`p-3 rounded-lg border text-sm font-medium flex items-center justify-center gap-2 ${direction === "remove" ? "bg-danger/10 border-danger/40 text-danger" : "border-border hover:border-danger/40"}`}>
              <Minus className="size-4" /> Remove
            </button>
            <button type="button" onClick={() => setDirection("add")} className={`p-3 rounded-lg border text-sm font-medium flex items-center justify-center gap-2 ${direction === "add" ? "bg-brand-light border-brand/40 text-brand-dark" : "border-border hover:border-brand/40"}`}>
              <Plus className="size-4" /> Add
            </button>
          </div>
          <div className="space-y-2">
            <Label>Quantity ({target?.unit})</Label>
            <Input type="number" min="0" step="0.01" placeholder="0" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />
          </div>
          <div className="space-y-2">
            <Label>Reason</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{reasons.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Notes (optional)</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything to remember about this adjustment" />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="brand" onClick={save} disabled={busy}>{busy ? "Saving..." : "Save adjustment"}</Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
