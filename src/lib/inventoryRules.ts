export type ProductFields = {
  name: string;
  category: string | null;
  sku: string;
  unit: string;
  selling_price: number;
  cost_price: number;
  reorder_level: number;
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
