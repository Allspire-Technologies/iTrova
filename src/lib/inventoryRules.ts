export type ProductFields = {
  name: string;
  category: string | null;
  sku: string;
  unit: string;
  selling_price: number;
  cost_price: number;
  reorder_level: number;
  /** Optional. undefined = column absent (leave unchanged on update); null = explicitly cleared. */
  expiry_date?: string | null;
};

type CsvRow = Record<string, string | undefined>;
type ExistingProduct = { id: string; sku: string | null; stock_quantity: number };

export type ImportPlan = {
  inserts: (ProductFields & { stock_quantity: number })[];
  updates: { id: string; fields: ProductFields; stock: number }[];
  skippedNoSku: number;
  overLimit: number;
};

/** Find another product using the same SKU (case-insensitive), excluding the one being edited. */
export function findSkuConflict<T extends { id: string; sku: string | null }>(
  sku: string,
  products: T[],
  excludeId?: string,
): T | null {
  const norm = sku.trim().toLowerCase();
  if (!norm) return null;
  return products.find(p => p.id !== excludeId && (p.sku ?? "").trim().toLowerCase() === norm) ?? null;
}

function fieldsFromRow(r: CsvRow): ProductFields {
  return {
    name: (r.name ?? "").trim(),
    category: r.category || null,
    sku: (r.sku ?? "").trim(),
    unit: r.unit || "pcs",
    selling_price: Number(r.selling_price) || 0,
    cost_price: Number(r.cost_price) || 0,
    reorder_level: Number(r.reorder_level) || 5,
    // Only touch expiry when the column is present, so importing an old CSV never wipes it.
    expiry_date: "expiry_date" in r ? ((r.expiry_date ?? "").trim() || null) : undefined,
  };
}

/**
 * Decide how a CSV import maps onto existing products: rows are aggregated by SKU
 * (case-insensitive), matched against existing products to restock, and the plan
 * limit caps only genuinely new products. Pure — the caller performs the writes.
 */
export function buildImportPlan(
  rows: CsvRow[],
  existing: ExistingProduct[],
  currentCount: number,
  limit: number | null,
): ImportPlan {
  const usable = rows.filter(r => r.name?.trim() && r.sku?.trim());
  const skippedNoSku = rows.filter(r => r.name?.trim() && !r.sku?.trim()).length;

  const agg = new Map<string, { fields: ProductFields; qty: number }>();
  for (const r of usable) {
    const key = r.sku!.trim().toLowerCase();
    const prev = agg.get(key);
    agg.set(key, { fields: fieldsFromRow(r), qty: (prev?.qty || 0) + (Number(r.stock_quantity) || 0) });
  }

  const existingBySku = new Map(existing.filter(p => p.sku).map(p => [p.sku!.trim().toLowerCase(), p]));

  const updates: ImportPlan["updates"] = [];
  const allInserts: ImportPlan["inserts"] = [];
  for (const [key, a] of agg) {
    const ex = existingBySku.get(key);
    if (ex) updates.push({ id: ex.id, fields: a.fields, stock: Number(ex.stock_quantity) + a.qty });
    else allInserts.push({ ...a.fields, stock_quantity: a.qty });
  }

  let inserts = allInserts;
  let overLimit = 0;
  if (limit !== null) {
    const capacity = Math.max(0, limit - currentCount);
    if (allInserts.length > capacity) {
      overLimit = allInserts.length - capacity;
      inserts = allInserts.slice(0, capacity);
    }
  }

  return { inserts, updates, skippedNoSku, overLimit };
}

export type ExpiryBand = "expired" | "critical" | "warning" | "soon" | "notice";
export type ExpiryAlert = { band: ExpiryBand; daysLeft: number; label: string; className: string };

/**
 * Tiered expiry alert for the inventory list. The badge appears from 90 days out and escalates
 * at 30 / 15 / 3 days, then "Expired". Returns null when there's no date or it's more than 90 days
 * away. `today` is an ISO date (YYYY-MM-DD), already resolved to the business timezone.
 */
export function expiryAlert(expiryDate: string | null | undefined, today: string): ExpiryAlert | null {
  if (!expiryDate) return null;
  const days = Math.round((Date.parse(expiryDate) - Date.parse(today)) / 86_400_000);
  const red = "bg-danger/10 text-danger border-danger/20";
  if (days < 0) return { band: "expired", daysLeft: days, label: "Expired", className: red };
  if (days === 0) return { band: "critical", daysLeft: 0, label: "Expires today", className: red };
  if (days <= 3) return { band: "critical", daysLeft: days, label: `Expires in ${days}d`, className: red };
  if (days <= 15) return { band: "warning", daysLeft: days, label: `Expires in ${days}d`, className: "bg-orange-500/10 text-orange-600 border-orange-500/20" };
  if (days <= 30) return { band: "soon", daysLeft: days, label: `Expires in ${days}d`, className: "bg-warning/10 text-warning border-warning/20" };
  if (days <= 90) return { band: "notice", daysLeft: days, label: `Expires in ${days}d`, className: "bg-muted text-muted-foreground border-border" };
  return null;
}
