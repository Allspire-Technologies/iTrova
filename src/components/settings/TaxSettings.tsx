import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import ConfirmDialog from "@/components/ConfirmDialog";
import { toast } from "sonner";
import { Receipt, Plus, Pencil, Trash2 } from "lucide-react";
import { listTaxes, saveTax, deleteTax, formatRate, type Tax } from "@/lib/tax";
import type { TablesUpdate } from "@/integrations/supabase/types";

const sb = supabase;

export default function TaxSettings() {
  const { business, refresh } = useAuth();
  const enabled = !!business?.tax_enabled;
  const inclusive = business?.prices_include_tax !== false; // default inclusive
  const [tin, setTin] = useState(business?.tin || "");
  const [taxes, setTaxes] = useState<Tax[]>([]);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Tax | null | "new">(null);
  const [form, setForm] = useState({ name: "", rate: "", is_default: false, active: true });
  const [deleting, setDeleting] = useState<Tax | null>(null);

  const load = useCallback(async () => {
    try { setTaxes(await listTaxes()); } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't load taxes"); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setTin(business?.tin || ""); }, [business?.tin]);

  const patchBusiness = async (patch: TablesUpdate<"businesses">) => {
    if (!business) return;
    const { error } = await sb.from("businesses").update(patch).eq("id", business.id);
    if (error) { toast.error(error.message); return; }
    await refresh();
  };

  const openAdd = () => { setForm({ name: "VAT", rate: "7.5", is_default: taxes.length === 0, active: true }); setEditing("new"); };
  const openEdit = (t: Tax) => { setForm({ name: t.name, rate: String(t.rate), is_default: t.is_default, active: t.active }); setEditing(t); };

  const submit = async () => {
    if (!business) return;
    if (!form.name.trim()) return toast.error("Give the tax a name.");
    if (!(Number(form.rate) >= 0)) return toast.error("Enter a valid rate.");
    setBusy(true);
    try {
      await saveTax(business.id, editing === "new" ? null : editing!.id, {
        name: form.name.trim(), rate: Number(form.rate), is_default: form.is_default, active: form.active,
      });
      toast.success(editing === "new" ? "Tax added" : "Tax updated");
      setEditing(null); load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save the tax");
    } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!deleting) return;
    try { await deleteTax(deleting.id); toast.success("Tax removed"); setDeleting(null); load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't remove the tax"); }
  };

  return (
    <Card className="shadow-card border-border/60">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-lg bg-brand-light grid place-items-center text-brand"><Receipt className="size-4" /></div>
          <div>
            <CardTitle className="font-display text-lg">Tax (VAT)</CardTitle>
            <CardDescription>Charge VAT on sales, map it to products, and track what you owe. Off by default.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div><p className="font-medium text-sm">Charge tax</p><p className="text-xs text-muted-foreground">Turn on if your business is VAT-registered.</p></div>
          <Switch checked={enabled} onCheckedChange={(v) => patchBusiness({ tax_enabled: v })} />
        </div>

        {enabled && (
          <>
            <div className="flex items-center justify-between gap-4">
              <div><p className="font-medium text-sm">Prices include tax</p><p className="text-xs text-muted-foreground">{inclusive ? "Your selling prices already include VAT (typical retail)." : "VAT is added on top at checkout."}</p></div>
              <Switch checked={inclusive} onCheckedChange={(v) => patchBusiness({ prices_include_tax: v })} />
            </div>

            <div className="space-y-2 max-w-sm">
              <Label>Tax ID (TIN)</Label>
              <div className="flex gap-2">
                <Input value={tin} onChange={(e) => setTin(e.target.value)} placeholder="e.g. 12345678-0001" />
                <Button variant="outline" onClick={() => patchBusiness({ tin: tin.trim() || null })} disabled={tin === (business?.tin || "")}>Save</Button>
              </div>
              <p className="text-xs text-muted-foreground">Shown on receipts and invoices.</p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="font-medium text-sm">Taxes</p>
                <Button variant="outline" size="sm" onClick={openAdd}><Plus className="size-4" /> Add tax</Button>
              </div>
              {taxes.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-4 text-center">
                  <p className="text-sm text-muted-foreground mb-2">No taxes yet.</p>
                  <Button variant="brand" size="sm" onClick={() => { setForm({ name: "VAT", rate: "7.5", is_default: true, active: true }); setEditing("new"); }}>Add VAT (7.5%)</Button>
                </div>
              ) : (
                <div className="rounded-lg border border-border divide-y">
                  {taxes.map(t => (
                    <div key={t.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-brand-dark flex items-center gap-2">
                          {t.name} <span className="text-muted-foreground font-normal">{formatRate(t.rate)}</span>
                          {t.is_default && <Badge variant="outline" className="text-[10px] bg-brand-light text-brand border-brand/20">Default</Badge>}
                          {!t.active && <Badge variant="outline" className="text-[10px]">Inactive</Badge>}
                        </p>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(t)}><Pencil className="size-4" /> Edit</Button>
                        <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={() => setDeleting(t)}><Trash2 className="size-4" /></Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">Assign a tax (or Exempt) to each product in Inventory. Staple foods are usually VAT-exempt.</p>
            </div>
          </>
        )}
      </CardContent>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent variant="compact" className="max-w-sm">
          <DialogHeader><DialogTitle className="font-display">{editing === "new" ? "Add tax" : "Edit tax"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="VAT" /></div>
            <div className="space-y-2"><Label>Rate (%)</Label><Input type="number" min="0" step="0.1" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} placeholder="7.5" /></div>
            <div className="flex items-center justify-between"><Label className="font-normal">Default for new products</Label><Switch checked={form.is_default} onCheckedChange={(v) => setForm({ ...form, is_default: v })} /></div>
            <div className="flex items-center justify-between"><Label className="font-normal">Active</Label><Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} /></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="brand" onClick={submit} disabled={busy}>{busy ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Remove ${deleting?.name ?? "this tax"}?`}
        description="Products mapped to it become Exempt. Past sales keep their recorded VAT."
        confirmLabel="Remove"
        onConfirm={remove}
      />
    </Card>
  );
}
