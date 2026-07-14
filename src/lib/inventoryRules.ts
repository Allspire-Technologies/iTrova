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
  /** Optional tax mapping. undefined = Tax column absent (unchanged on update); null = Exempt. */
  tax_id?: string | null;
  /** Optional per-unit weight. undefined = column absent (unchanged); null = cleared. */
  weight?: number | null;
};

type CsvRow = Record<string, string | undefined>;
type ExistingProduct = { id: string; sku: string | null; stock_quantity: number };

// The row shape the import expects, keyed by our canonical field names.
type CanonicalRow = {
  name?: string; category?: string; sku?: string; unit?: string;
  selling_price?: string; cost_price?: string; stock_quantity?: string;
  reorder_level?: string; expiry_date?: string; tax?: string; weight?: string;
};

// Import CSVs are hand-edited in spreadsheets, so headers vary in case, spacing and wording. Map the
// common ways people label each column onto our canonical field names — keyed by the normalised
// header (lowercase, and spaces/underscores/hyphens collapsed to a single space). Without this,
// "Cost Price"/"cost price" miss the exact-match `cost_price` key and silently import as 0.
const HEADER_ALIASES: Record<string, keyof CanonicalRow> = {
  "name": "name", "product": "name", "product name": "name", "item": "name", "item name": "name",
  "category": "category", "cat": "category", "type": "category", "group": "category",
  "sku": "sku", "code": "sku", "product code": "sku", "item code": "sku", "barcode": "sku",
  "unit": "unit", "units": "unit", "uom": "unit", "unit of measure": "unit",
  "selling price": "selling_price", "sell price": "selling_price", "sale price": "selling_price",
  "sales price": "selling_price", "price": "selling_price", "unit price": "selling_price",
  "retail price": "selling_price", "selling": "selling_price",
  "cost price": "cost_price", "cost": "cost_price", "buy price": "cost_price",
  "buying price": "cost_price", "purchase price": "cost_price", "cost per unit": "cost_price",
  "stock quantity": "stock_quantity", "stock": "stock_quantity", "quantity": "stock_quantity",
  "qty": "stock_quantity", "stock qty": "stock_quantity", "quantity in stock": "stock_quantity",
  "opening stock": "stock_quantity", "current stock": "stock_quantity", "in stock": "stock_quantity",
  "reorder level": "reorder_level", "reorder": "reorder_level", "reorder point": "reorder_level",
  "reorder qty": "reorder_level", "min stock": "reorder_level", "minimum stock": "reorder_level",
  "low stock level": "reorder_level",
  "expiry date": "expiry_date", "expiry": "expiry_date", "expiration date": "expiry_date",
  "expiration": "expiry_date", "best before": "expiry_date", "exp date": "expiry_date", "expires": "expiry_date",
  "tax": "tax", "vat": "tax", "tax name": "tax", "tax type": "tax",
  "weight": "weight", "unit weight": "weight", "weight per unit": "weight", "kg": "weight",
};

// The generic header/number helpers moved to csvImport.ts (shared by every import surface);
// re-exported here so existing imports keep working.
import { normalizeHeader, parseImportNumber } from "./csvImport";
export { normalizeHeader, parseImportNumber };

/** Re-key a parsed CSV row onto canonical field names via HEADER_ALIASES (first match per field wins). */
export function canonicalizeRow(row: CsvRow): CanonicalRow {
  const out: CanonicalRow = {};
  for (const [rawKey, value] of Object.entries(row)) {
    const key = HEADER_ALIASES[normalizeHeader(rawKey)];
    if (key && out[key] === undefined) out[key] = value;
  }
  return out;
}

/** A CSV row that couldn't be imported, kept verbatim alongside a human reason for the summary. */
export type RejectedRow = { row: CsvRow; reason: string };

export type ImportPlan = {
  inserts: (ProductFields & { stock_quantity: number })[];
  updates: { id: string; fields: ProductFields; stock: number }[];
  rejected: RejectedRow[];
};

/**
 * Columns every product row must supply. Category, unit and expiry date are optional (unit defaults
 * to "pcs"). `numeric` fields must additionally parse to a number (commas/currency are tolerated —
 * see parseImportNumber), so "1,000" and "800.00" are accepted while blanks and text are rejected.
 */
const REQUIRED_FIELDS: { field: keyof CanonicalRow; label: string; numeric?: boolean }[] = [
  { field: "name", label: "Name" },
  { field: "sku", label: "SKU" },
  { field: "selling_price", label: "Selling Price", numeric: true },
  { field: "cost_price", label: "Cost Price", numeric: true },
  { field: "stock_quantity", label: "Stock Quantity", numeric: true },
  { field: "reorder_level", label: "Reorder Level", numeric: true },
];

/** List the required-column problems in a canonicalised row (empty array = row is valid). */
export function validateImportRow(r: CanonicalRow): string[] {
  const problems: string[] = [];
  for (const { field, label, numeric } of REQUIRED_FIELDS) {
    const val = (r[field] ?? "").trim();
    if (!val) { problems.push(`Missing ${label}`); continue; }
    if (numeric && Number.isNaN(parseImportNumber(val))) problems.push(`Invalid ${label}`);
  }
  return problems;
}

export type TaxRef = { id: string; name: string };

/**
 * Resolve a row's Tax column against the catalogue (by name, case-insensitive).
 *   column absent            → {} (leave the product's tax unchanged on update)
 *   blank / exempt / none    → { tax_id: null } (Exempt)
 *   matches a catalogue tax  → { tax_id }
 *   unknown name             → { error } (caller rejects the row)
 * Only called when tax is enabled (taxes provided); otherwise the column is ignored entirely.
 */
export function resolveTax(canon: CanonicalRow, taxes: TaxRef[]): { tax_id?: string | null } | { error: string } {
  if (!("tax" in canon)) return {};
  const val = (canon.tax ?? "").trim();
  if (!val || /^(exempt|none|no|n\/a|na|nil)$/i.test(val)) return { tax_id: null };
  const match = taxes.find(t => t.name.trim().toLowerCase() === val.toLowerCase());
  if (!match) return { error: `Unknown tax "${val}" — add it under Settings → Tax or leave the column blank for Exempt` };
  return { tax_id: match.id };
}

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

function fieldsFromRow(r: CanonicalRow): ProductFields {
  return {
    name: (r.name ?? "").trim(),
    category: r.category?.trim() || null,
    sku: (r.sku ?? "").trim(),
    unit: r.unit?.trim() || "pcs",
    selling_price: parseImportNumber(r.selling_price) || 0,
    cost_price: parseImportNumber(r.cost_price) || 0,
    reorder_level: parseImportNumber(r.reorder_level) || 5,
    // Only touch expiry when the column is present, so importing an old CSV never wipes it.
    expiry_date: "expiry_date" in r ? ((r.expiry_date ?? "").trim() || null) : undefined,
    weight: "weight" in r ? (parseImportNumber(r.weight) || null) : undefined,
  };
}

/**
 * Decide how a CSV import maps onto existing products: rows are validated against the required
 * columns, aggregated by SKU (case-insensitive), matched against existing products to restock, and
 * the plan limit caps only genuinely new products. Rows that fail validation or overflow the plan
 * limit come back in `rejected` (with the original row + a reason) so the caller can summarise them
 * and offer a re-download. Pure — the caller performs the writes.
 */
export function buildImportPlan(
  rows: CsvRow[],
  existing: ExistingProduct[],
  currentCount: number,
  limit: number | null,
  taxes?: TaxRef[], // provided only when tax is enabled; enables the Tax column (by name)
): ImportPlan {
  const rejected: RejectedRow[] = [];

  // Re-key every row onto canonical field names first (varied header casing/wording still maps),
  // then require every mandatory column. A row missing any is rejected with a specific reason.
  const valid: { raw: CsvRow; canon: CanonicalRow }[] = [];
  for (const raw of rows) {
    const canon = canonicalizeRow(raw);
    const problems = validateImportRow(canon);
    if (problems.length) rejected.push({ row: raw, reason: problems.join("; ") });
    else valid.push({ raw, canon });
  }

  // Group valid rows by SKU (case-insensitive). A SKU that appears more than once in the file is
  // ambiguous — two products must not share a SKU — so every row with a duplicated SKU is flagged
  // as failed rather than silently merged. A SKU matching an existing product still restocks it.
  const bySku = new Map<string, { raw: CsvRow; canon: CanonicalRow }[]>();
  for (const v of valid) {
    const key = v.canon.sku!.trim().toLowerCase();
    const group = bySku.get(key);
    if (group) group.push(v); else bySku.set(key, [v]);
  }

  const existingBySku = new Map(existing.filter(p => p.sku).map(p => [p.sku!.trim().toLowerCase(), p]));

  const updates: ImportPlan["updates"] = [];
  const allInserts: { insert: ProductFields & { stock_quantity: number }; raw: CsvRow }[] = [];
  for (const [key, group] of bySku) {
    if (group.length > 1) {
      for (const g of group) rejected.push({ row: g.raw, reason: "Duplicate SKU in file — each product needs a unique SKU" });
      continue;
    }
    const { raw, canon } = group[0];
    const fields = fieldsFromRow(canon);
    if (taxes) {
      const t = resolveTax(canon, taxes);
      if ("error" in t) { rejected.push({ row: raw, reason: t.error }); continue; }
      if ("tax_id" in t) fields.tax_id = t.tax_id;
    }
    const qty = parseImportNumber(canon.stock_quantity) || 0;
    const ex = existingBySku.get(key);
    if (ex) updates.push({ id: ex.id, fields, stock: Number(ex.stock_quantity) + qty });
    else allInserts.push({ insert: { ...fields, stock_quantity: qty }, raw });
  }

  let allowedInserts = allInserts;
  if (limit !== null) {
    const capacity = Math.max(0, limit - currentCount);
    if (allInserts.length > capacity) {
      allowedInserts = allInserts.slice(0, capacity);
      for (const over of allInserts.slice(capacity)) {
        rejected.push({ row: over.raw, reason: "Plan limit reached — upgrade to add more products" });
      }
    }
  }

  return { inserts: allowedInserts.map(i => i.insert), updates, rejected };
}

export type ProductProfitStats = {
  costTotal: number; // cost price × stock on hand
  profitTotal: number; // (selling − cost) × stock on hand
  /** Markup on cost: (selling − cost) ÷ cost, as a percent. null when cost is unknown (≤ 0). */
  markupPct: number | null;
};

/**
 * Inventory valuation for one product row: what the stock on hand cost, the profit it will yield
 * if sold at the current price, and the markup on cost. Markup is quantity-independent, so it's the
 * same whether figured per unit or on the totals. Returns a null `markupPct` (and treats cost as
 * unknown) when the cost price is ≤ 0 — e.g. not entered, or absent from the offline cache.
 */
export function productProfitStats(
  p: { selling_price: number; cost_price: number; stock_quantity: number },
): ProductProfitStats {
  const cost = Number(p.cost_price) || 0;
  const selling = Number(p.selling_price) || 0;
  const qty = Number(p.stock_quantity) || 0;
  const known = cost > 0;
  return {
    costTotal: cost * qty,
    profitTotal: (selling - cost) * qty,
    markupPct: known ? ((selling - cost) / cost) * 100 : null,
  };
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
