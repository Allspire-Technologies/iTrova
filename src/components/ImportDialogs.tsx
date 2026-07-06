import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Download } from "lucide-react";

// Shared CSV-import feedback UI (extracted from the #79 Inventory importer): a non-dismissable
// progress dialog while rows are written, and a results dialog summarising imported vs rejected
// rows (grouped by reason) with a "download the misses" re-export.

/** A row the import couldn't apply — its values keyed by the template columns, plus why it failed. */
export type FailedImportRow = { values: Record<string, string>; reason: string };

export type ImportProgress = { done: number; total: number };

export type ImportOutcome = {
  /** Rows applied successfully. */
  imported: number;
  /** Optional breakdown appended after the count, e.g. "3 added · 2 restocked". */
  detail?: string;
  failed: FailedImportRow[];
};

export function ImportProgressDialog({ progress, noun }: { progress: ImportProgress | null; noun: string }) {
  return (
    <Dialog open={!!progress}>
      <DialogContent variant="compact" className="[&>button]:hidden" onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Importing {noun}…</DialogTitle>
        </DialogHeader>
        {progress && (() => {
          const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
          return (
            <div className="space-y-2">
              <Progress value={pct} />
              <p className="text-sm text-muted-foreground">{pct}% — {progress.done} of {progress.total} steps. Please keep this page open.</p>
            </div>
          );
        })()}
      </DialogContent>
    </Dialog>
  );
}

export function ImportResultDialog({ result, onClose, onDownloadFailed }: {
  result: ImportOutcome | null;
  onClose: () => void;
  onDownloadFailed: () => void;
}) {
  return (
    <Dialog open={!!result} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import results</DialogTitle>
        </DialogHeader>
        {result && (
          <div className="space-y-3 text-sm">
            <p className="font-medium text-success">
              {result.imported} row{result.imported === 1 ? "" : "s"} imported
              {result.detail ? ` · ${result.detail}` : ""}
            </p>
            {result.failed.length === 0 ? (
              <p className="text-muted-foreground">Every row was imported successfully.</p>
            ) : (
              <div className="space-y-2">
                <p className="font-medium text-danger">
                  {result.failed.length} row{result.failed.length === 1 ? "" : "s"} not imported
                </p>
                <ul className="rounded-lg border border-border divide-y divide-border max-h-48 overflow-auto">
                  {Object.entries(
                    result.failed.reduce<Record<string, number>>((m, f) => { m[f.reason] = (m[f.reason] || 0) + 1; return m; }, {}),
                  ).map(([reason, count]) => (
                    <li key={reason} className="flex items-start justify-between gap-3 px-3 py-2">
                      <span className="text-muted-foreground">{reason}</span>
                      <span className="shrink-0 tabular-nums font-medium">{count}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  Download the misses, fix the flagged columns, and re-upload just those rows.
                </p>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          {!!result?.failed.length && (
            <Button variant="outline" onClick={onDownloadFailed}>
              <Download className="size-4 mr-2" /> Download not-imported ({result.failed.length})
            </Button>
          )}
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
