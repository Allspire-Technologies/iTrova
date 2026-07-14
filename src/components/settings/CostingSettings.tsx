import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "sonner";
import { Scale } from "lucide-react";

const sb = supabase;

/** How purchases (POs + material deliveries) value inventory when they add stock. */
export default function CostingSettings() {
  const { business, refresh } = useAuth();
  const method = business?.valuation_method ?? "moving_average";

  const setMethod = async (v: string) => {
    if (!business || v === method) return;
    const { error } = await sb.from("businesses").update({ valuation_method: v }).eq("id", business.id);
    if (error) { toast.error(error.message); return; }
    await refresh();
    toast.success("Costing method updated");
  };

  const Option = ({ value, title, desc }: { value: string; title: string; desc: string }) => (
    <label htmlFor={`vm-${value}`} className="flex items-start gap-3 rounded-lg border border-border p-3 cursor-pointer hover:bg-muted/40 transition-colors">
      <RadioGroupItem id={`vm-${value}`} value={value} className="mt-0.5" />
      <div>
        <p className="font-medium text-sm text-brand-dark">{title}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
    </label>
  );

  return (
    <Card className="shadow-card border-border/60">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-lg bg-brand-light grid place-items-center text-brand"><Scale className="size-4" /></div>
          <div>
            <CardTitle className="font-display text-lg">Inventory costing</CardTitle>
            <CardDescription>How receiving stock (purchase orders &amp; deliveries) updates each item's cost.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <RadioGroup value={method} onValueChange={setMethod} className="gap-2">
          <Option value="moving_average" title="Moving average" desc="Blend the new purchase's landed cost with the stock already on hand. Smooths price swings — the usual choice." />
          <Option value="last_cost" title="Last cost" desc="Value all stock at the most recent purchase's landed unit cost." />
        </RadioGroup>
      </CardContent>
    </Card>
  );
}
