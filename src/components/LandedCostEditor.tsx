import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import SearchableSelect from "@/components/SearchableSelect";
import { Plus, Trash2 } from "lucide-react";
import type { LandedBasis } from "@/lib/landedCost";

export type LandedRow = { label: string; amount: string; basis?: LandedBasis };

/** Seed with Freight (split by weight) + Duty (split by value); users rename / add / remove rows. */
export const defaultLandedRows = (): LandedRow[] => [
  { label: "Freight", amount: "", basis: "weight" },
  { label: "Duty", amount: "", basis: "value" },
];

/** Map DB landed_costs (or empty) to editable string rows, falling back to the Freight/Duty seed. */
export function toLandedRows(lines: { label: string; amount: number; basis?: LandedBasis }[] | null | undefined): LandedRow[] {
  if (lines && lines.length) return lines.map(l => ({ label: l.label, amount: String(l.amount), basis: l.basis ?? "value" }));
  return defaultLandedRows();
}

/** Editable rows → the persisted shape, dropping blanks / non-positive amounts. */
export function fromLandedRows(rows: LandedRow[]): { label: string; amount: number; basis: LandedBasis }[] {
  return rows
    .map(r => ({ label: r.label.trim() || "Landed cost", amount: Number(r.amount) || 0, basis: (r.basis ?? "value") as LandedBasis }))
    .filter(r => r.amount > 0);
}

const BASIS_OPTIONS = [{ value: "value", label: "By value" }, { value: "weight", label: "By weight" }];

export function LandedCostEditor({ value, onChange, fmt, showBasis = false }: {
  value: LandedRow[];
  onChange: (rows: LandedRow[]) => void;
  fmt: (n: number) => string;
  showBasis?: boolean;
}) {
  const set = (i: number, patch: Partial<LandedRow>) => onChange(value.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const total = value.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  return (
    <div className="space-y-2">
      {value.map((r, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input className="flex-1" placeholder="Cost name (e.g. Clearing)" value={r.label} onChange={e => set(i, { label: e.target.value })} />
          {showBasis && (
            <SearchableSelect
              className="w-32 shrink-0"
              value={r.basis ?? "value"}
              onValueChange={(v) => set(i, { basis: v as LandedBasis })}
              options={BASIS_OPTIONS}
            />
          )}
          <Input
            className="w-28 shrink-0" type="number" min="0" step="0.01" placeholder="0"
            aria-label={`${r.label || "Landed cost"} amount`}
            value={r.amount} onChange={e => set(i, { amount: e.target.value })}
          />
          <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-destructive"
            aria-label={`Remove ${r.label || "cost"}`} onClick={() => onChange(value.filter((_, idx) => idx !== i))}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" size="sm" onClick={() => onChange([...value, { label: "", amount: "", basis: "value" }])}>
          <Plus className="size-4 mr-1" /> Add cost
        </Button>
        <div className="text-sm text-muted-foreground">Total landed: <span className="font-semibold text-brand-dark">{fmt(total)}</span></div>
      </div>
    </div>
  );
}
