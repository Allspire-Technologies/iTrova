// Shared CSV-import engine (the #79 Inventory treatment, generalised): header aliases,
// currency/comma-tolerant numbers, per-row rejection reasons, duplicate detection and plan-limit
// capping. Each entity declares its columns as FieldSpecs and gets canonicalisation, validation
// and template-keyed values for the "not imported" re-download; the entity-specific planners
// below stay pure — pages perform the writes.

export type CsvRow = Record<string, string | undefined>;

/** A CSV row that couldn't be imported, kept verbatim alongside a human reason for the summary. */
export type RejectedRow = { row: CsvRow; reason: string };

export type FieldSpec = {
  /** Canonical key the planners read. */
  key: string;
  /** Template header, also used in error reasons ("Missing <label>"). */
  label: string;
  /** Accepted raw headers besides key/label (normalised before matching). */
  aliases?: string[];
  required?: boolean;
  /** Non-blank values must parse via parseImportNumber (blank + not required is fine). */
  numeric?: boolean;
};

/** Normalise a CSV header for alias lookup: trim, lowercase, collapse spaces/underscores/hyphens. */
export function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s_-]+/g, " ").trim();
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

/** Re-key a parsed CSV row onto canonical keys via the specs' aliases (first match per field wins). */
export function canonicalize(row: CsvRow, fields: FieldSpec[]): CsvRow {
  const aliasMap: Record<string, string> = {};
  for (const f of fields) {
    for (const a of [f.key, f.label, ...(f.aliases ?? [])]) aliasMap[normalizeHeader(a)] = f.key;
  }
  const out: CsvRow = {};
  for (const [rawKey, value] of Object.entries(row)) {
    const key = aliasMap[normalizeHeader(rawKey)];
    if (key && out[key] === undefined) out[key] = value;
  }
  return out;
}

/** List the column problems in a canonicalised row (empty array = row is valid). */
export function validateRow(canon: CsvRow, fields: FieldSpec[]): string[] {
  const problems: string[] = [];
  for (const f of fields) {
    const val = (canon[f.key] ?? "").trim();
    if (!val) { if (f.required) problems.push(`Missing ${f.label}`); continue; }
    if (f.numeric && Number.isNaN(parseImportNumber(val))) problems.push(`Invalid ${f.label}`);
  }
  return problems;
}

/** Present a row in the template's columns so the re-download is fixable & re-importable. */
export function templateValues(row: CsvRow, fields: FieldSpec[]): Record<string, string> {
  const canon = canonicalize(row, fields);
  const out: Record<string, string> = {};
  for (const f of fields) out[f.label] = (canon[f.key] ?? "").trim();
  return out;
}

export function templateHeaders(fields: FieldSpec[]): string[] {
  return fields.map(f => f.label);
}

const str = (v: string | undefined): string | null => {
  const t = (v ?? "").trim();
  return t || null;
};

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

export const SUPPLIER_FIELDS: FieldSpec[] = [
  { key: "name", label: "Name", aliases: ["supplier", "supplier name", "company", "company name", "business", "vendor"], required: true },
  { key: "contact_name", label: "Contact Name", aliases: ["contact", "contact person"] },
  { key: "phone", label: "Phone", aliases: ["phone number", "tel", "telephone", "mobile", "whatsapp"] },
  { key: "email", label: "Email", aliases: ["email address", "e mail"] },
  { key: "address", label: "Address", aliases: ["location"] },
  { key: "notes", label: "Notes", aliases: ["note", "comment", "comments", "description"] },
  { key: "rating", label: "Rating", aliases: ["stars", "score"], numeric: true },
];

export type SupplierFields = {
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  rating: number | null;
};

export type SupplierImportPlan = {
  inserts: SupplierFields[];
  /** Existing supplier matched by name — only non-blank CSV cells overwrite, so sparse files never wipe data. */
  updates: { id: string; fields: Partial<SupplierFields> }[];
  rejected: RejectedRow[];
};

export function buildSupplierImportPlan(
  rows: CsvRow[],
  existing: { id: string; name: string }[],
  currentCount: number,
  limit: number | null,
): SupplierImportPlan {
  const rejected: RejectedRow[] = [];
  const valid: { raw: CsvRow; canon: CsvRow }[] = [];
  for (const raw of rows) {
    const canon = canonicalize(raw, SUPPLIER_FIELDS);
    const problems = validateRow(canon, SUPPLIER_FIELDS);
    const rating = (canon.rating ?? "").trim() ? parseImportNumber(canon.rating) : null;
    if (rating !== null && !Number.isNaN(rating) && (rating < 1 || rating > 5)) problems.push("Invalid Rating — use 1 to 5");
    if (problems.length) rejected.push({ row: raw, reason: problems.join("; ") });
    else valid.push({ raw, canon });
  }

  // Group by name (case-insensitive): a name duplicated in the file is ambiguous, a name matching
  // an existing supplier updates them instead of creating a duplicate.
  const byName = new Map<string, { raw: CsvRow; canon: CsvRow }[]>();
  for (const v of valid) {
    const key = v.canon.name!.trim().toLowerCase();
    const group = byName.get(key);
    if (group) group.push(v); else byName.set(key, [v]);
  }
  const existingByName = new Map(existing.map(s => [s.name.trim().toLowerCase(), s]));

  const updates: SupplierImportPlan["updates"] = [];
  const allInserts: { insert: SupplierFields; raw: CsvRow }[] = [];
  for (const [key, group] of byName) {
    if (group.length > 1) {
      for (const g of group) rejected.push({ row: g.raw, reason: "Duplicate name in file — keep one row per supplier" });
      continue;
    }
    const { raw, canon } = group[0];
    const rating = (canon.rating ?? "").trim() ? parseImportNumber(canon.rating) : null;
    const fields: SupplierFields = {
      name: canon.name!.trim(),
      contact_name: str(canon.contact_name), phone: str(canon.phone), email: str(canon.email),
      address: str(canon.address), notes: str(canon.notes), rating,
    };
    const ex = existingByName.get(key);
    if (ex) {
      const patch: Partial<SupplierFields> = {};
      for (const [k, val] of Object.entries(fields) as [keyof SupplierFields, SupplierFields[keyof SupplierFields]][]) {
        if (k !== "name" && val !== null) (patch as Record<string, unknown>)[k] = val;
      }
      if (Object.keys(patch).length) updates.push({ id: ex.id, fields: patch });
      else rejected.push({ row: raw, reason: "Supplier already exists — add a column to update their details" });
    } else {
      allInserts.push({ insert: fields, raw });
    }
  }

  return { ...capInserts(allInserts, currentCount, limit, "suppliers", rejected), updates, rejected };
}

// ---------------------------------------------------------------------------
// Raw materials
// ---------------------------------------------------------------------------

export const MATERIAL_FIELDS: FieldSpec[] = [
  { key: "name", label: "Name", aliases: ["material", "material name", "item", "item name"], required: true },
  { key: "sku", label: "SKU", aliases: ["code", "item code", "material code", "barcode"] },
  { key: "unit", label: "Unit", aliases: ["units", "uom", "unit of measure"] },
  { key: "stock_quantity", label: "Stock Quantity", aliases: ["stock", "quantity", "qty", "stock qty", "quantity in stock", "opening stock", "current stock", "in stock"], required: true, numeric: true },
  { key: "reorder_level", label: "Reorder Level", aliases: ["reorder", "reorder point", "reorder qty", "min stock", "minimum stock", "low stock level"], numeric: true },
  { key: "cost_per_unit", label: "Cost Per Unit", aliases: ["cost", "cost price", "unit cost", "unit price", "price", "buying price", "purchase price"], required: true, numeric: true },
  { key: "supplier", label: "Supplier", aliases: ["supplier name", "vendor"] },
  { key: "notes", label: "Notes", aliases: ["note", "comment", "comments", "description"] },
];

export type MaterialFields = {
  name: string;
  sku: string | null;
  unit: string;
  reorder_level: number;
  cost_per_unit: number;
  supplier_id: string | null;
  notes: string | null;
};

export type MaterialImportPlan = {
  inserts: (MaterialFields & { stock_quantity: number })[];
  /** SKU matched an existing material: restock (existing + CSV qty) and refresh the fields. */
  updates: { id: string; fields: MaterialFields; stock: number }[];
  rejected: RejectedRow[];
};

export function buildMaterialImportPlan(
  rows: CsvRow[],
  existing: { id: string; sku: string | null; stock_quantity: number }[],
  suppliers: { id: string; name: string }[],
  currentCount: number,
  limit: number | null,
): MaterialImportPlan {
  const rejected: RejectedRow[] = [];
  const suppliersByName = new Map(suppliers.map(s => [s.name.trim().toLowerCase(), s]));

  const valid: { raw: CsvRow; canon: CsvRow; supplierId: string | null }[] = [];
  for (const raw of rows) {
    const canon = canonicalize(raw, MATERIAL_FIELDS);
    const problems = validateRow(canon, MATERIAL_FIELDS);
    // A named supplier must exist — silently importing with no link loses what the file said.
    let supplierId: string | null = null;
    const supplierName = (canon.supplier ?? "").trim();
    if (supplierName) {
      const match = suppliersByName.get(supplierName.toLowerCase());
      if (match) supplierId = match.id;
      else problems.push(`Supplier "${supplierName}" not found — add them on the Suppliers page first, or clear the column`);
    }
    if (problems.length) rejected.push({ row: raw, reason: problems.join("; ") });
    else valid.push({ raw, canon, supplierId });
  }

  // Rows with a SKU behave like the product import: duplicate SKUs in the file are rejected and a
  // SKU matching an existing material restocks it. Rows without a SKU have no identity to match,
  // so they always insert.
  const bySku = new Map<string, typeof valid>();
  const noSku: typeof valid = [];
  for (const v of valid) {
    const key = (v.canon.sku ?? "").trim().toLowerCase();
    if (!key) { noSku.push(v); continue; }
    const group = bySku.get(key);
    if (group) group.push(v); else bySku.set(key, [v]);
  }
  const existingBySku = new Map(existing.filter(m => m.sku?.trim()).map(m => [m.sku!.trim().toLowerCase(), m]));

  const fieldsFrom = (canon: CsvRow, supplierId: string | null): MaterialFields => ({
    name: canon.name!.trim(),
    sku: str(canon.sku),
    unit: str(canon.unit) ?? "kg",
    reorder_level: (canon.reorder_level ?? "").trim() ? parseImportNumber(canon.reorder_level) : 5,
    cost_per_unit: parseImportNumber(canon.cost_per_unit) || 0,
    supplier_id: supplierId,
    notes: str(canon.notes),
  });

  const updates: MaterialImportPlan["updates"] = [];
  const allInserts: { insert: MaterialFields & { stock_quantity: number }; raw: CsvRow }[] = [];
  for (const [key, group] of bySku) {
    if (group.length > 1) {
      for (const g of group) rejected.push({ row: g.raw, reason: "Duplicate SKU in file — each material needs a unique SKU" });
      continue;
    }
    const { raw, canon, supplierId } = group[0];
    const qty = parseImportNumber(canon.stock_quantity) || 0;
    const ex = existingBySku.get(key);
    if (ex) updates.push({ id: ex.id, fields: fieldsFrom(canon, supplierId), stock: Number(ex.stock_quantity) + qty });
    else allInserts.push({ insert: { ...fieldsFrom(canon, supplierId), stock_quantity: qty }, raw });
  }
  for (const { raw, canon, supplierId } of noSku) {
    allInserts.push({ insert: { ...fieldsFrom(canon, supplierId), stock_quantity: parseImportNumber(canon.stock_quantity) || 0 }, raw });
  }

  return { ...capInserts(allInserts, currentCount, limit, "raw materials", rejected), updates, rejected };
}

// ---------------------------------------------------------------------------
// Purchase orders
// ---------------------------------------------------------------------------

export const PO_FIELDS: FieldSpec[] = [
  { key: "order_ref", label: "Order Ref", aliases: ["ref", "po ref", "po number", "order number", "order id", "order", "group"] },
  { key: "supplier_name", label: "Supplier", aliases: ["supplier name", "vendor"] },
  { key: "expected_date", label: "Expected Date", aliases: ["expected", "delivery date", "eta", "due date"] },
  { key: "description", label: "Description", aliases: ["item", "item name", "product", "material", "line item"], required: true },
  { key: "quantity", label: "Quantity", aliases: ["qty"], required: true, numeric: true },
  { key: "unit_cost", label: "Unit Cost", aliases: ["cost", "unit price", "cost price", "price"], required: true, numeric: true },
  { key: "notes", label: "Notes", aliases: ["note", "comment", "comments"] },
];

export type PoLine = { description: string; quantity: number; unit_cost: number; line_total: number };
export type PlannedPo = {
  supplier_id: string | null;
  expected_date: string | null;
  notes: string | null;
  items: PoLine[];
  total_amount: number;
  /** The raw file rows behind this PO, template-keyed on failure re-download. */
  raws: CsvRow[];
};

export type PoImportPlan = { pos: PlannedPo[]; rejected: RejectedRow[] };

/**
 * Rows that share a non-blank Order Ref become one multi-line PO (supplier/date/notes read from the
 * group's first non-blank cells; two different suppliers under one ref is ambiguous → rejected).
 * Rows without a ref each become their own single-line PO, like the old importer.
 */
export function buildPoImportPlan(
  rows: CsvRow[],
  suppliers: { id: string; name: string }[],
  currentCount: number,
  limit: number | null,
): PoImportPlan {
  const rejected: RejectedRow[] = [];
  const suppliersByName = new Map(suppliers.map(s => [s.name.trim().toLowerCase(), s]));

  type ValidRow = { raw: CsvRow; canon: CsvRow };
  const valid: ValidRow[] = [];
  for (const raw of rows) {
    const canon = canonicalize(raw, PO_FIELDS);
    const problems = validateRow(canon, PO_FIELDS);
    const qty = parseImportNumber(canon.quantity);
    if (!Number.isNaN(qty) && qty <= 0) problems.push("Invalid Quantity — must be above zero");
    const expected = (canon.expected_date ?? "").trim();
    if (expected && !/^\d{4}-\d{2}-\d{2}$/.test(expected)) problems.push("Invalid Expected Date — use YYYY-MM-DD");
    const supplierName = (canon.supplier_name ?? "").trim();
    if (supplierName && !suppliersByName.has(supplierName.toLowerCase())) {
      problems.push(`Supplier "${supplierName}" not found — add them on the Suppliers page first, or clear the column`);
    }
    if (problems.length) rejected.push({ row: raw, reason: problems.join("; ") });
    else valid.push({ raw, canon });
  }

  const groups = new Map<string, ValidRow[]>();
  let singleton = 0;
  for (const v of valid) {
    const ref = (v.canon.order_ref ?? "").trim().toLowerCase();
    const key = ref || `~row-${singleton++}`; // blank ref = its own PO
    const group = groups.get(key);
    if (group) group.push(v); else groups.set(key, [v]);
  }

  const allPos: PlannedPo[] = [];
  for (const group of groups.values()) {
    const supplierNames = [...new Set(group.map(g => (g.canon.supplier_name ?? "").trim().toLowerCase()).filter(Boolean))];
    if (supplierNames.length > 1) {
      for (const g of group) rejected.push({ row: g.raw, reason: "Conflicting suppliers under one Order Ref — one order, one supplier" });
      continue;
    }
    const supplier = supplierNames.length ? suppliersByName.get(supplierNames[0])! : null;
    const items: PoLine[] = group.map(({ canon }) => {
      const quantity = parseImportNumber(canon.quantity);
      const unit_cost = parseImportNumber(canon.unit_cost) || 0;
      return { description: canon.description!.trim(), quantity, unit_cost, line_total: quantity * unit_cost };
    });
    allPos.push({
      supplier_id: supplier?.id ?? null,
      expected_date: group.map(g => (g.canon.expected_date ?? "").trim()).find(Boolean) || null,
      notes: group.map(g => (g.canon.notes ?? "").trim()).find(Boolean) || null,
      items,
      total_amount: items.reduce((s, i) => s + i.line_total, 0),
      raws: group.map(g => g.raw),
    });
  }

  // The plan limit counts purchase orders, not lines.
  let pos = allPos;
  if (limit !== null) {
    const capacity = Math.max(0, limit - currentCount);
    if (allPos.length > capacity) {
      pos = allPos.slice(0, capacity);
      for (const over of allPos.slice(capacity)) {
        for (const raw of over.raws) rejected.push({ row: raw, reason: "Plan limit reached — upgrade to add more purchase orders" });
      }
    }
  }

  return { pos, rejected };
}

// ---------------------------------------------------------------------------
// Team invitations
// ---------------------------------------------------------------------------

export const TEAM_FIELDS: FieldSpec[] = [
  { key: "email", label: "Email", aliases: ["email address", "e mail", "mail"], required: true },
  { key: "role", label: "Role", aliases: ["team role", "app role", "position"], required: true },
];

export type TeamImportPlan = {
  invites: { email: string; role: "manager" | "cashier" }[];
  rejected: RejectedRow[];
};

export function buildTeamImportPlan(
  rows: CsvRow[],
  memberEmails: string[],
  pendingInviteEmails: string[],
  currentCount: number,
  limit: number | null,
): TeamImportPlan {
  const rejected: RejectedRow[] = [];
  const members = new Set(memberEmails.map(e => e.trim().toLowerCase()).filter(Boolean));
  const pending = new Set(pendingInviteEmails.map(e => e.trim().toLowerCase()).filter(Boolean));
  const seen = new Set<string>();

  const allInvites: { invite: TeamImportPlan["invites"][number]; raw: CsvRow }[] = [];
  // First pass so an email duplicated in the file rejects every copy, not just the later ones.
  const counts = new Map<string, number>();
  for (const raw of rows) {
    const email = (canonicalize(raw, TEAM_FIELDS).email ?? "").trim().toLowerCase();
    if (email) counts.set(email, (counts.get(email) ?? 0) + 1);
  }

  for (const raw of rows) {
    const canon = canonicalize(raw, TEAM_FIELDS);
    const problems = validateRow(canon, TEAM_FIELDS);
    const email = (canon.email ?? "").trim().toLowerCase();
    const role = (canon.role ?? "").trim().toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problems.push("Invalid Email");
    if (role && role !== "manager" && role !== "cashier") problems.push("Invalid Role — use manager or cashier");
    if (email && (counts.get(email) ?? 0) > 1) problems.push("Duplicate email in file");
    else if (email && members.has(email)) problems.push("Already a team member");
    else if (email && pending.has(email)) problems.push("An invitation for this email is already pending");
    if (problems.length) { rejected.push({ row: raw, reason: problems.join("; ") }); continue; }
    if (seen.has(email)) continue; // unreachable safety: duplicates were rejected above
    seen.add(email);
    allInvites.push({ invite: { email, role: role as "manager" | "cashier" }, raw });
  }

  let invites = allInvites;
  if (limit !== null) {
    const capacity = Math.max(0, limit - currentCount);
    if (allInvites.length > capacity) {
      invites = allInvites.slice(0, capacity);
      for (const over of allInvites.slice(capacity)) {
        rejected.push({ row: over.raw, reason: "Plan limit reached — upgrade to add more team members" });
      }
    }
  }

  return { invites: invites.map(i => i.invite), rejected };
}

// ---------------------------------------------------------------------------
// Expenses (insert-only — an expense can legitimately repeat, so no dedup/update)
// ---------------------------------------------------------------------------

export const EXPENSE_FIELDS: FieldSpec[] = [
  { key: "expense_date", label: "Date", aliases: ["expense date", "date paid", "day"], required: true },
  { key: "category", label: "Category", aliases: ["type", "expense category"], required: true },
  { key: "amount", label: "Amount", aliases: ["cost", "value", "total", "price"], required: true, numeric: true },
  { key: "payment_method", label: "Payment Method", aliases: ["method", "paid via", "payment"] },
  { key: "payee", label: "Payee", aliases: ["paid to", "vendor", "supplier", "recipient"] },
  { key: "description", label: "Description", aliases: ["note", "notes", "memo", "details"] },
  { key: "status", label: "Status", aliases: ["paid", "state"] },
  { key: "due_date", label: "Due Date", aliases: ["due", "pay by"] },
];

export type ExpenseImportFields = {
  expense_date: string; category: string; amount: number; payment_method: string | null;
  payee: string | null; description: string | null; status: "paid" | "pending"; due_date: string | null;
};

export type ExpenseImportPlan = { inserts: ExpenseImportFields[]; rejected: RejectedRow[] };

/** Parse a spreadsheet date to YYYY-MM-DD (accepts anything Date understands); null if unparseable. */
function parseImportDate(v: string | undefined): string | null {
  const t = (v ?? "").trim();
  if (!t) return null;
  const ms = Date.parse(t);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString().slice(0, 10);
}

export function buildExpenseImportPlan(rows: CsvRow[]): ExpenseImportPlan {
  const rejected: RejectedRow[] = [];
  const inserts: ExpenseImportFields[] = [];
  for (const raw of rows) {
    const canon = canonicalize(raw, EXPENSE_FIELDS);
    const problems = validateRow(canon, EXPENSE_FIELDS);
    const date = parseImportDate(canon.expense_date);
    if ((canon.expense_date ?? "").trim() && !date) problems.push("Invalid Date");
    const statusRaw = (canon.status ?? "").trim().toLowerCase();
    const status: "paid" | "pending" = statusRaw === "pending" ? "pending" : "paid";
    if (statusRaw && statusRaw !== "paid" && statusRaw !== "pending") problems.push("Invalid Status — use paid or pending");
    const due = parseImportDate(canon.due_date);
    if ((canon.due_date ?? "").trim() && !due) problems.push("Invalid Due Date");
    if (problems.length) { rejected.push({ row: raw, reason: problems.join("; ") }); continue; }
    inserts.push({
      expense_date: date!, category: canon.category!.trim(),
      amount: parseImportNumber(canon.amount) || 0,
      payment_method: str(canon.payment_method), payee: str(canon.payee),
      description: str(canon.description), status, due_date: status === "pending" ? due : null,
    });
  }
  return { inserts, rejected };
}

// ---------------------------------------------------------------------------

function capInserts<T>(
  allInserts: { insert: T; raw: CsvRow }[],
  currentCount: number,
  limit: number | null,
  noun: string,
  rejected: RejectedRow[],
): { inserts: T[] } {
  let allowed = allInserts;
  if (limit !== null) {
    const capacity = Math.max(0, limit - currentCount);
    if (allInserts.length > capacity) {
      allowed = allInserts.slice(0, capacity);
      for (const over of allInserts.slice(capacity)) {
        rejected.push({ row: over.raw, reason: `Plan limit reached — upgrade to add more ${noun}` });
      }
    }
  }
  return { inserts: allowed.map(i => i.insert) };
}
