import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useDateFormat } from "@/hooks/useDateFormat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import ConfirmDialog from "@/components/ConfirmDialog";
import { toast } from "sonner";
import { Check, X, ClipboardList, RotateCcw } from "lucide-react";
import {
  listRequisitions, approveRequisition, rejectRequisition, cancelRequisition,
  friendlyProductionError, REQUISITION_STATUS_LABEL, REQUISITION_STATUS_CLASS,
  type Requisition,
} from "@/lib/production";

type MaterialRow = { id: string; name: string; unit: string | null; stock_quantity: number };

// The approval leg of the production flow, surfaced on the Raw Materials page: the person who owns
// raw-material stock (raw_materials.adjust_stock) sees incoming material requests here and approves
// (issuing stock, optionally reduced), rejects, or cancels an approved one (restocking). Requesters
// raise and track their requests on the Production page.
export default function MaterialApprovals({ onChanged, onPendingCount }: {
  onChanged?: () => void;
  onPendingCount?: (n: number) => void;
}) {
  const { business, can } = useAuth();
  const { fmtDate } = useDateFormat();
  const canApprove = can("raw_materials", "approve_requests");
  const canReject = can("raw_materials", "reject_requests");
  const canCancel = can("raw_materials", "adjust_stock");
  const [reqs, setReqs] = useState<Requisition[]>([]);
  const [materials, setMaterials] = useState<MaterialRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState<Requisition | null>(null);
  const [approveQtys, setApproveQtys] = useState<Record<string, string>>({});
  const [rejecting, setRejecting] = useState<Requisition | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [cancelling, setCancelling] = useState<Requisition | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!business) return;
    try {
      const [rs, mat] = await Promise.all([
        listRequisitions(),
        supabase.from("raw_materials").select("id,name,unit,stock_quantity").order("name"),
      ]);
      setReqs(rs);
      setMaterials((mat.data as MaterialRow[]) ?? []);
      onPendingCount?.(rs.filter(r => r.status === "pending").length);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't load material requests");
    } finally {
      setLoading(false);
    }
  }, [business, onPendingCount]);

  useEffect(() => { load(); }, [load]);

  const refresh = () => { load(); onChanged?.(); };

  const openApprove = (r: Requisition) => {
    setApproving(r);
    setApproveQtys(Object.fromEntries(r.production_requisition_items.map(i => [i.raw_material_id, String(i.quantity_requested)])));
  };

  const doApprove = async () => {
    if (!approving) return;
    const items = approving.production_requisition_items.map(i => ({
      raw_material_id: i.raw_material_id,
      quantity: Number(approveQtys[i.raw_material_id]),
    }));
    if (items.some(i => !(i.quantity > 0))) return toast.error("Approved quantities must be above zero.");
    if (approving.production_requisition_items.some(i => Number(approveQtys[i.raw_material_id]) > Number(i.quantity_requested))) {
      return toast.error("Approved quantities can't exceed what was requested.");
    }
    setBusy(true);
    try {
      await approveRequisition(approving.id, items);
      toast.success("Approved — materials issued");
      setApproving(null);
      refresh();
    } catch (e) {
      toast.error(friendlyProductionError(e instanceof Error ? e.message : undefined, "Couldn't approve"));
    } finally {
      setBusy(false);
    }
  };

  const doReject = async () => {
    if (!rejecting) return;
    setBusy(true);
    try {
      await rejectRequisition(rejecting.id, rejectReason);
      toast.success("Request rejected");
      setRejecting(null); setRejectReason("");
      refresh();
    } catch (e) {
      toast.error(friendlyProductionError(e instanceof Error ? e.message : undefined, "Couldn't reject"));
    } finally {
      setBusy(false);
    }
  };

  const doCancel = async () => {
    if (!cancelling) return;
    try {
      await cancelRequisition(cancelling.id);
      toast.success("Cancelled — issued materials returned to stock");
      setCancelling(null);
      refresh();
    } catch (e) {
      toast.error(friendlyProductionError(e instanceof Error ? e.message : undefined, "Couldn't cancel"));
    }
  };

  const materialsSummary = (r: Requisition) =>
    r.production_requisition_items.map(i => `${i.raw_materials?.name ?? "Material"} × ${i.quantity_requested}${i.raw_materials?.unit ? ` ${i.raw_materials.unit}` : ""}`).join(" · ");
  const issuedSummary = (r: Requisition) => {
    const reduced = r.production_requisition_items.some(i => i.quantity_issued != null && Number(i.quantity_issued) !== Number(i.quantity_requested));
    if (!reduced) return null;
    return "Issued: " + r.production_requisition_items.map(i => `${i.raw_materials?.name ?? "Material"} × ${Number(i.quantity_issued ?? i.quantity_requested)}`).join(" · ");
  };

  const Actions = ({ r }: { r: Requisition }) => {
    if (r.status === "pending") {
      return (
        <div className="flex gap-1 justify-end">
          {canApprove && <Button variant="ghost" size="sm" onClick={() => openApprove(r)}><Check className="size-4" /> Approve</Button>}
          {canReject && <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={() => setRejecting(r)}><X className="size-4" /> Reject</Button>}
        </div>
      );
    }
    if (r.status === "approved" && canCancel) {
      return (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={() => setCancelling(r)}><RotateCcw className="size-4" /> Cancel & restock</Button>
        </div>
      );
    }
    return null;
  };

  if (loading) return <Card className="shadow-card border-border/60 p-8 text-center text-sm text-muted-foreground">Loading material requests…</Card>;

  return (
    <Card className="shadow-card border-border/60">
      {reqs.length === 0 ? (
        <div className="p-12 text-center">
          <div className="size-14 rounded-2xl bg-brand-light text-brand grid place-items-center mx-auto mb-4"><ClipboardList className="size-6" /></div>
          <h3 className="font-display text-lg font-semibold text-brand-dark">No material requests</h3>
          <p className="text-muted-foreground text-sm mt-1">When the production team requests materials, they'll appear here for you to approve or reject.</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden sm:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead><TableHead>Materials</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reqs.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">{fmtDate(r.created_at)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {materialsSummary(r)}
                      {r.notes ? <span className="block text-xs">{r.notes}</span> : null}
                      {r.status === "rejected" && r.decision_note ? <span className="block text-xs text-danger">Reason: {r.decision_note}</span> : null}
                      {issuedSummary(r) && <span className="block text-xs text-brand-dark">{issuedSummary(r)}</span>}
                    </TableCell>
                    <TableCell><Badge variant="outline" className={REQUISITION_STATUS_CLASS[r.status]}>{REQUISITION_STATUS_LABEL[r.status]}</Badge></TableCell>
                    <TableCell className="text-right"><Actions r={r} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {/* Mobile cards */}
          <div className="sm:hidden divide-y">
            {reqs.map(r => (
              <div key={r.id} className="p-4 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-brand-dark">{fmtDate(r.created_at)}</p>
                  <Badge variant="outline" className={REQUISITION_STATUS_CLASS[r.status]}>{REQUISITION_STATUS_LABEL[r.status]}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">{materialsSummary(r)}</p>
                {issuedSummary(r) && <p className="text-xs text-brand-dark">{issuedSummary(r)}</p>}
                <Actions r={r} />
              </div>
            ))}
          </div>
        </>
      )}

      {/* Approve: reduce quantities before issuing. */}
      <Dialog open={!!approving} onOpenChange={(o) => !o && setApproving(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="font-display">Approve and issue materials</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Approved quantities are deducted from raw-material stock immediately. Reduce any line to issue less than requested.
            </p>
            {approving?.production_requisition_items.map((i, idx) => {
              const stock = materials.find(m => m.id === i.raw_material_id);
              const short = stock && Number(stock.stock_quantity) < Number(approveQtys[i.raw_material_id] || 0);
              return (
                <div key={i.id} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-brand-dark truncate">{i.raw_materials?.name ?? "Material"}</p>
                    <p className={`text-xs ${short ? "text-danger" : "text-muted-foreground"}`}>
                      Requested {i.quantity_requested}{i.raw_materials?.unit ? ` ${i.raw_materials.unit}` : ""} · {Number(stock?.stock_quantity ?? 0)} in stock
                    </p>
                  </div>
                  <Input
                    type="number" min="0" max={Number(i.quantity_requested)} step="any" className="w-24"
                    aria-label={`Approve quantity ${idx + 1}`}
                    value={approveQtys[i.raw_material_id] ?? ""}
                    onChange={(e) => setApproveQtys(prev => ({ ...prev, [i.raw_material_id]: e.target.value }))}
                  />
                  <span className="w-10 shrink-0 text-xs text-muted-foreground">{i.raw_materials?.unit ?? ""}</span>
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setApproving(null)}>Cancel</Button>
            <Button variant="brand" onClick={doApprove} disabled={busy}>{busy ? "Approving..." : "Approve & issue"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject with an optional reason. */}
      <Dialog open={!!rejecting} onOpenChange={(o) => { if (!o) { setRejecting(null); setRejectReason(""); } }}>
        <DialogContent variant="compact" className="max-w-sm">
          <DialogHeader><DialogTitle className="font-display">Reject this request?</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>Reason <span className="font-normal text-muted-foreground">(optional, shown to the requester)</span></Label>
            <Textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="e.g. Not enough flour until Friday's delivery" />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setRejecting(null); setRejectReason(""); }}>Cancel</Button>
            <Button variant="destructive" onClick={doReject} disabled={busy}>{busy ? "Rejecting..." : "Reject request"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!cancelling}
        onOpenChange={(o) => !o && setCancelling(null)}
        title="Cancel this approved request?"
        description="The issued materials will be returned to raw-material stock."
        confirmLabel="Cancel & restock"
        onConfirm={doCancel}
      />
    </Card>
  );
}
