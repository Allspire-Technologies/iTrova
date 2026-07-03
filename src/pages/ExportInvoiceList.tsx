import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Plus, FileDown, Ship, Pencil, Trash2, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import ConfirmDialog from "@/components/ConfirmDialog";
import { TablePageSkeleton } from "@/components/Skeletons";
import { useAuth } from "@/contexts/AuthContext";
import { useDateFormat } from "@/hooks/useDateFormat";
import { listExportInvoices, downloadExportInvoicePdf, downloadExportInvoiceDocx, deleteExportInvoice, formatExportMoney, type ExportInvoiceRecord } from "@/lib/exportInvoice";

export default function ExportInvoiceList() {
  const navigate = useNavigate();
  const isOwner = useAuth().role === "owner";
  const { fmtDate } = useDateFormat();
  const [items, setItems] = useState<ExportInvoiceRecord[] | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ExportInvoiceRecord | null>(null);

  useEffect(() => {
    listExportInvoices()
      .then(setItems)
      .catch((e) => { toast.error(e?.message ?? "Couldn't load export invoices"); setItems([]); });
  }, []);

  async function confirmDelete() {
    const inv = pendingDelete;
    if (!inv) return;
    try {
      await deleteExportInvoice(inv.id);
      setItems((list) => (list ?? []).filter((i) => i.id !== inv.id));
      toast.success(`Export invoice ${inv.invoice_number} deleted`);
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? "Couldn't delete the invoice");
    }
  }

  if (items === null) return <TablePageSkeleton />;

  return (
    <div className="space-y-6 w-full">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl lg:text-4xl font-bold text-brand-dark">Export Invoices</h1>
          <p className="text-muted-foreground mt-1">International commercial invoices — creating one depletes the linked product stock.</p>
        </div>
        <Button variant="hero" onClick={() => navigate("/export-invoice/new")}><Plus className="size-4" /> New export invoice</Button>
      </div>

      {items.length === 0 ? (
        <Card className="shadow-card border-border/60">
          <CardContent className="grid place-items-center gap-3 py-16 text-center">
            <div className="size-12 rounded-xl bg-brand-light grid place-items-center text-brand"><Ship className="size-6" /></div>
            <div>
              <p className="font-medium text-brand-dark">No export invoices yet</p>
              <p className="text-sm text-muted-foreground">Create your first international commercial invoice.</p>
            </div>
            <Button variant="brand" onClick={() => navigate("/export-invoice/new")}><Plus className="size-4" /> New export invoice</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((inv) => (
            <div key={inv.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-card p-4">
              <button type="button" onClick={() => navigate(`/export-invoice/${inv.id}`)} className="min-w-0 text-left">
                <p className="font-medium text-brand-dark hover:underline underline-offset-2">{inv.invoice_number}</p>
                <p className="text-sm text-muted-foreground truncate">
                  {inv.buyer.name || "—"} · {fmtDate(inv.invoice_date)} · {inv.total_cartons} cartons
                </p>
              </button>
              <div className="flex items-center gap-2">
                <span className="mr-1 font-medium text-brand-dark">{formatExportMoney(inv.total, inv.currency)}</span>
                <Button variant="ghost" size="sm" onClick={() => navigate(`/export-invoice/${inv.id}`)}>
                  <Eye className="size-4" /> View
                </Button>
                {isOwner && (
                  <Button variant="ghost" size="sm" onClick={() => navigate(`/export-invoice/${inv.id}/edit`)}>
                    <Pencil className="size-4" /> Edit
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => downloadExportInvoicePdf(inv, `${inv.invoice_number.replace(/[^\w.-]+/g, "-")}.pdf`)}>
                  <FileDown className="size-4" /> PDF
                </Button>
                <Button variant="outline" size="sm" onClick={() => downloadExportInvoiceDocx(inv, `${inv.invoice_number.replace(/[^\w.-]+/g, "-")}.docx`)}>
                  <FileDown className="size-4" /> DOCX
                </Button>
                {isOwner && (
                  <Button variant="ghost" size="sm" onClick={() => setPendingDelete(inv)} aria-label={`Delete ${inv.invoice_number}`}>
                    <Trash2 className="size-4 text-danger" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={`Delete ${pendingDelete?.invoice_number ?? ""}?`}
        description="This permanently deletes the invoice and returns the stock it depleted to inventory."
        confirmLabel="Delete"
        onConfirm={confirmDelete}
      />
    </div>
  );
}
