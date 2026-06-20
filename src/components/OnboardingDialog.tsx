import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Store, Package, Truck, Sparkles } from "lucide-react";
import { getCurrencySymbol, CURRENCY_OPTIONS } from "@/lib/format";
import SearchableSelect from "@/components/SearchableSelect";

export default function OnboardingDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { business, user, profile, refresh } = useAuth();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);

  const [bizName, setBizName] = useState(business?.name || "");
  const [currency, setCurrency] = useState(business?.currency || "NGN");

  const [pName, setPName] = useState("");
  const [pPrice, setPPrice] = useState("");
  const [pStock, setPStock] = useState("");

  const [sName, setSName] = useState("");
  const [sPhone, setSPhone] = useState("");

  const total = 4;
  const pct = Math.round((step / (total - 1)) * 100);

  const next = async () => {
    if (!business || !user) return;
    setBusy(true);
    try {
      if (step === 0) {
        if (bizName !== business.name || currency !== business.currency) {
          const { error } = await supabase.from("businesses").update({ name: bizName, currency }).eq("id", business.id);
          if (error) throw error;
        }
      } else if (step === 1) {
        if (pName.trim()) {
          const { error } = await supabase.from("products").insert({
            business_id: business.id, name: pName.trim(),
            selling_price: Number(pPrice) || 0, cost_price: 0,
            stock_quantity: Number(pStock) || 0, reorder_level: 5, unit: "pcs",
          });
          if (error) throw error;
        }
      } else if (step === 2) {
        if (sName.trim()) {
          const { error } = await supabase.from("suppliers").insert({
            business_id: business.id, name: sName.trim(), phone: sPhone || null,
          });
          if (error) throw error;
        }
      } else if (step === 3) {
        const { error } = await supabase.from("profiles").update({ onboarded: true }).eq("id", user.id);
        if (error) throw error;
        await refresh();
        onClose();
        toast.success("You're all set!");
        return;
      }
      setStep(step + 1);
    } catch (e: any) {
      toast.error(e.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const skip = async () => {
    if (step < 3) setStep(step + 1);
    else await next();
  };

  return (
    <Dialog open={open} onOpenChange={() => { /* modal */ }}>
      <DialogContent className="max-w-lg" onPointerDownOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
        <DialogHeader>
          <div className="size-12 rounded-xl bg-gradient-brand grid place-items-center text-brand-foreground mx-auto mb-2">
            {step === 0 ? <Store className="size-5" /> : step === 1 ? <Package className="size-5" /> : step === 2 ? <Truck className="size-5" /> : <Sparkles className="size-5" />}
          </div>
          <DialogTitle className="font-display text-center text-2xl">
            {step === 0
              ? `Welcome, ${profile?.owner_name?.split(" ")[0] || "there"}!`
              : step === 1
              ? "Add your first product"
              : step === 2
              ? "Add your first supplier"
              : "You're ready!"}
          </DialogTitle>
          <p className="text-center text-sm text-muted-foreground">Step {Math.min(step + 1, total)} of {total}</p>
        </DialogHeader>

        <Progress value={pct} className="h-1" />

        {step === 0 && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground text-center">Let's confirm your business details.</p>
            <div className="space-y-2"><Label>Business name</Label><Input value={bizName} onChange={(e) => setBizName(e.target.value)} placeholder="My Business" /></div>
            <div className="space-y-2"><Label>Currency</Label><SearchableSelect value={currency} onValueChange={setCurrency} options={CURRENCY_OPTIONS} placeholder="Select currency" /></div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground text-center">Add one item you sell — you can add more later.</p>
            <div className="space-y-2"><Label>Product name</Label><Input value={pName} onChange={(e) => setPName(e.target.value)} placeholder="e.g. Garri (50kg)" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Selling price ({getCurrencySymbol(currency)})</Label><Input type="number" min="0" placeholder="0" value={pPrice} onChange={(e) => setPPrice(e.target.value)} /></div>
              <div className="space-y-2"><Label>Stock quantity</Label><Input type="number" min="0" placeholder="0" value={pStock} onChange={(e) => setPStock(e.target.value)} /></div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground text-center">Add someone you buy stock from — optional but useful.</p>
            <div className="space-y-2"><Label>Supplier name</Label><Input value={sName} onChange={(e) => setSName(e.target.value)} placeholder="e.g. Olu Farms" /></div>
            <div className="space-y-2"><Label>Phone</Label><Input value={sPhone} onChange={(e) => setSPhone(e.target.value)} placeholder="+234..." /></div>
          </div>
        )}

        {step === 3 && (
          <div className="text-center space-y-2 py-2">
            <p className="text-sm text-muted-foreground">Your account is set up. From here you can record sales, track stock and manage suppliers — everything updates in real time.</p>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-2">
          <Button variant="ghost" onClick={skip} disabled={busy}>{step === 3 ? "" : "Skip"}</Button>
          <Button variant="brand" onClick={next} disabled={busy || (step === 0 && !bizName.trim())}>
            {busy ? "Saving..." : step === 3 ? "Start using iTrova" : "Continue"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
