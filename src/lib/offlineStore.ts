import { getDb } from "./offlineDb";
import type { CachedInvoice, CachedProduct, CachedSession, DashboardSnapshot, QueuedInvoice, QueuedPayment, QueuedSale, QueuedSaleItem, ReviewPayment, ReviewSale } from "./offlineTypes";

// Typed business-logic API over IndexedDB — the offline equivalent of heldSales.ts. POS, AuthContext
// and the sync engine consume these; nothing else touches offlineDb directly.

/** Client-generated UUID for an offline sale/invoice (same fallback shape POS already uses). */
export function newOfflineSaleId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ---- meta: last successful sync timestamp (per business) --------------------
export async function setLastSync(businessId: string, ts: number): Promise<void> {
  const db = await getDb();
  await db.put("meta", { key: `lastSync:${businessId}`, value: ts, updatedAt: Date.now() });
}
export async function getLastSync(businessId: string): Promise<number | null> {
  const db = await getDb();
  return ((await db.get("meta", `lastSync:${businessId}`))?.value as number | undefined) ?? null;
}

// ---- session (business + staff snapshot for offline render) -----------------
export async function cacheSession(s: CachedSession): Promise<void> {
  const db = await getDb();
  await db.put("session", s);
}

/** Most recent cached session, or the one for a specific business when known. */
export async function readCachedSession(businessId?: string): Promise<CachedSession | null> {
  const db = await getDb();
  if (businessId) return (await db.get("session", businessId)) ?? null;
  const all = await db.getAll("session");
  if (all.length === 0) return null;
  return all.reduce((latest, s) => (s.cachedAt > latest.cachedAt ? s : latest));
}

// ---- products (catalogue snapshot + local stock guidance) -------------------
export async function cacheProducts(businessId: string, products: CachedProduct[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("products", "readwrite");
  // Replace this business's snapshot wholesale so deleted/out-of-stock products drop out.
  for (const p of await tx.store.index("by-business").getAllKeys(businessId)) await tx.store.delete(p);
  for (const p of products) await tx.store.put({ ...p, business_id: businessId });
  await tx.done;
}

export async function readCachedProducts(businessId: string): Promise<CachedProduct[]> {
  const db = await getDb();
  return db.getAllFromIndex("products", "by-business", businessId);
}

/** Decrement the cached snapshot after an offline sale (guidance only; clamped at 0). */
export async function applyLocalStockDelta(businessId: string, items: QueuedSaleItem[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("products", "readwrite");
  for (const item of items) {
    const p = await tx.store.get(item.product_id);
    if (p && p.business_id === businessId) {
      await tx.store.put({ ...p, stock_quantity: Math.max(0, Number(p.stock_quantity) - Number(item.quantity)) });
    }
  }
  await tx.done;
}

// ---- dashboard snapshot (read-only offline views) --------------------------
export async function cacheDashboard(businessId: string, snapshot: DashboardSnapshot): Promise<void> {
  const db = await getDb();
  await db.put("dashboard", { businessId, snapshot, updatedAt: Date.now() });
}

export async function readCachedDashboard(businessId: string): Promise<DashboardSnapshot | null> {
  const db = await getDb();
  return (await db.get("dashboard", businessId))?.snapshot ?? null;
}

// ---- sale queue ------------------------------------------------------------
export async function enqueueSale(sale: QueuedSale): Promise<void> {
  const db = await getDb();
  await db.put("saleQueue", sale);
}

export async function getQueuedSale(saleId: string): Promise<QueuedSale | null> {
  const db = await getDb();
  return (await db.get("saleQueue", saleId)) ?? null;
}

/** Edit a queued (not-yet-synced) offline invoice in place. */
export async function updateQueuedSale(saleId: string, patch: Partial<QueuedSale>): Promise<void> {
  const db = await getDb();
  const existing = await db.get("saleQueue", saleId);
  if (existing) await db.put("saleQueue", { ...existing, ...patch });
}

export async function listQueuedSales(businessId: string): Promise<QueuedSale[]> {
  const db = await getDb();
  const rows = await db.getAllFromIndex("saleQueue", "by-business", businessId);
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function countPending(businessId: string): Promise<number> {
  return (await listQueuedSales(businessId)).length;
}

async function patchSale(saleId: string, patch: Partial<QueuedSale>): Promise<void> {
  const db = await getDb();
  const existing = await db.get("saleQueue", saleId);
  if (existing) await db.put("saleQueue", { ...existing, ...patch });
}

export const markSaleSyncing = (saleId: string) => patchSale(saleId, { status: "syncing" });
export const markSaleFailed = (saleId: string, error: string) =>
  patchSale(saleId, { status: "failed", lastError: error });

export async function bumpAttempt(saleId: string): Promise<void> {
  const db = await getDb();
  const existing = await db.get("saleQueue", saleId);
  if (existing) await db.put("saleQueue", { ...existing, attempts: existing.attempts + 1 });
}

export async function removeQueuedSale(saleId: string): Promise<void> {
  const db = await getDb();
  await db.delete("saleQueue", saleId);
}

// ---- review queue (server rejected: insufficient stock) ---------------------
export async function moveToReview(saleId: string, reason: string): Promise<void> {
  const db = await getDb();
  const sale = await db.get("saleQueue", saleId);
  if (!sale) return;
  const tx = db.transaction(["saleQueue", "reviewQueue"], "readwrite");
  await tx.objectStore("reviewQueue").put({ ...sale, reviewReason: reason, movedAt: new Date().toISOString() } as ReviewSale);
  await tx.objectStore("saleQueue").delete(saleId);
  await tx.done;
}

export async function listReviewSales(businessId: string): Promise<ReviewSale[]> {
  const db = await getDb();
  const rows = await db.getAllFromIndex("reviewQueue", "by-business", businessId);
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function discardReviewSale(saleId: string): Promise<void> {
  const db = await getDb();
  await db.delete("reviewQueue", saleId);
}

/** Move a reviewed sale back to the pending queue to retry the sync. */
export async function retryReviewSale(saleId: string): Promise<void> {
  const db = await getDb();
  const review = await db.get("reviewQueue", saleId);
  if (!review) return;
  const { reviewReason: _r, movedAt: _m, ...sale } = review;
  void _r;
  void _m;
  const tx = db.transaction(["saleQueue", "reviewQueue"], "readwrite");
  await tx.objectStore("saleQueue").put({ ...sale, status: "pending", lastError: undefined });
  await tx.objectStore("reviewQueue").delete(saleId);
  await tx.done;
}

// ============================================================================
// Offline deposits (v2): cached server invoices + a queue of payments to replay
// ============================================================================

// ---- cached server invoices (so deposits can be recorded offline) -----------
export async function cacheInvoices(businessId: string, invoices: CachedInvoice[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("invoicesCache", "readwrite");
  // Replace the server snapshot wholesale (paid/voided invoices drop out), but keep `local` rows —
  // invoices created offline that haven't synced yet would otherwise be wiped before they commit.
  for (const k of await tx.store.index("by-business").getAllKeys(businessId)) {
    const row = await tx.store.get(k);
    if (row && !row.local) await tx.store.delete(k);
  }
  for (const inv of invoices) await tx.store.put({ ...inv, business_id: businessId });
  await tx.done;
}

/** Insert/replace a single cached invoice (used for invoices created offline). */
export async function putCachedInvoice(invoice: CachedInvoice): Promise<void> {
  const db = await getDb();
  await db.put("invoicesCache", invoice);
}

export async function readCachedInvoices(businessId: string): Promise<CachedInvoice[]> {
  const db = await getDb();
  return db.getAllFromIndex("invoicesCache", "by-business", businessId);
}

/** Optimistically apply an offline deposit to the cached invoice (guidance until next sync). */
export async function applyLocalPaymentDelta(invoiceId: string, amount: number): Promise<void> {
  const db = await getDb();
  const inv = await db.get("invoicesCache", invoiceId);
  if (!inv) return;
  const amount_paid = Number(inv.amount_paid) + Number(amount);
  const status = amount_paid >= Number(inv.total) ? "paid" : "partial";
  await db.put("invoicesCache", { ...inv, amount_paid, status });
}

// ---- payment queue ----------------------------------------------------------
export async function enqueuePayment(payment: QueuedPayment): Promise<void> {
  const db = await getDb();
  await db.put("paymentQueue", payment);
}

export async function listQueuedPayments(businessId: string): Promise<QueuedPayment[]> {
  const db = await getDb();
  const rows = await db.getAllFromIndex("paymentQueue", "by-business", businessId);
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function countPendingPayments(businessId: string): Promise<number> {
  return (await listQueuedPayments(businessId)).length;
}

async function patchPayment(paymentId: string, patch: Partial<QueuedPayment>): Promise<void> {
  const db = await getDb();
  const existing = await db.get("paymentQueue", paymentId);
  if (existing) await db.put("paymentQueue", { ...existing, ...patch });
}

export const markPaymentSyncing = (paymentId: string) => patchPayment(paymentId, { status: "syncing" });
export const markPaymentFailed = (paymentId: string, error: string) =>
  patchPayment(paymentId, { status: "failed", lastError: error });

export async function bumpPaymentAttempt(paymentId: string): Promise<void> {
  const db = await getDb();
  const existing = await db.get("paymentQueue", paymentId);
  if (existing) await db.put("paymentQueue", { ...existing, attempts: existing.attempts + 1 });
}

export async function removeQueuedPayment(paymentId: string): Promise<void> {
  const db = await getDb();
  await db.delete("paymentQueue", paymentId);
}

// ---- payment review queue (server rejected: balance shrank / overpay) --------
export async function movePaymentToReview(paymentId: string, reason: string): Promise<void> {
  const db = await getDb();
  const payment = await db.get("paymentQueue", paymentId);
  if (!payment) return;
  const tx = db.transaction(["paymentQueue", "paymentReviewQueue"], "readwrite");
  await tx.objectStore("paymentReviewQueue").put({ ...payment, reviewReason: reason, movedAt: new Date().toISOString() } as ReviewPayment);
  await tx.objectStore("paymentQueue").delete(paymentId);
  await tx.done;
}

export async function listPaymentReviews(businessId: string): Promise<ReviewPayment[]> {
  const db = await getDb();
  const rows = await db.getAllFromIndex("paymentReviewQueue", "by-business", businessId);
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function discardPaymentReview(paymentId: string): Promise<void> {
  const db = await getDb();
  await db.delete("paymentReviewQueue", paymentId);
}

// ---- invoice queue (manual invoices created offline) ------------------------
export async function enqueueInvoice(invoice: QueuedInvoice): Promise<void> {
  const db = await getDb();
  await db.put("invoiceQueue", invoice);
}

export async function listQueuedInvoices(businessId: string): Promise<QueuedInvoice[]> {
  const db = await getDb();
  const rows = await db.getAllFromIndex("invoiceQueue", "by-business", businessId);
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function countPendingInvoices(businessId: string): Promise<number> {
  return (await listQueuedInvoices(businessId)).length;
}

async function patchInvoice(invoiceId: string, patch: Partial<QueuedInvoice>): Promise<void> {
  const db = await getDb();
  const existing = await db.get("invoiceQueue", invoiceId);
  if (existing) await db.put("invoiceQueue", { ...existing, ...patch });
}

export const markInvoiceSyncing = (invoiceId: string) => patchInvoice(invoiceId, { status: "syncing" });
export const markInvoiceFailed = (invoiceId: string, error: string) =>
  patchInvoice(invoiceId, { status: "failed", lastError: error });

export async function bumpInvoiceAttempt(invoiceId: string): Promise<void> {
  const db = await getDb();
  const existing = await db.get("invoiceQueue", invoiceId);
  if (existing) await db.put("invoiceQueue", { ...existing, attempts: existing.attempts + 1 });
}

/** Remove a synced offline invoice from both the queue and the local cache row. */
export async function removeQueuedInvoice(invoiceId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(["invoiceQueue", "invoicesCache"], "readwrite");
  await tx.objectStore("invoiceQueue").delete(invoiceId);
  const cached = await tx.objectStore("invoicesCache").get(invoiceId);
  if (cached?.local) await tx.objectStore("invoicesCache").delete(invoiceId); // server copy re-caches on next load
  await tx.done;
}
