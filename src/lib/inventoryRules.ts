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

// The row shape the import expects, keyed by our canonical field names.
type CanonicalRow = {
  name?: string; category?: string; sku?: string; unit?: string;
  selling_price?: string; cost_price?: string; stock_quantity?: string;
  reorder_level?: string; expiry_date?: string;
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
};

/** Normalise a CSV header for alias lookup: trim, lowercase, collapse spaces/underscores/hyphens. */
export function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s_-]+/g, " ").trim();
}

/** Re-key a parsed CSV row onto canonical field names via HEADER_ALIASES (first match per field wins). */
export function canonicalizeRow(row: CsvRow): CanonicalRow {
  const out: CanonicalRow = {};
  for (const [rawKey, value] of Object.entries(row)) {
    const key = HEADER_ALIASES[normalizeHeader(rawKey)];
    if (key && out[key] === undefined) out[key] = value;
  }
  return out;
}

/**
 * Parse a number out of a spreadsheet cell: strip currency symbols, thousands separators and stray
 * spaces so "₦1,500" / "1,500.00" / " 1500 " all read as 1500. Returns NaN for blanks/non-numbers.
 */
export function parseImportNumber(v: string | undefined): number {
  if (v == null) return NaN;
  const cleaned = String(v).replace(/[^0-9.-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === ".") return NaN;
  return Number(cleaned);
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
