import { getDb } from "./offlineDb";
import type { CachedProduct, CachedSession, DashboardSnapshot, QueuedSale, QueuedSaleItem, ReviewSale } from "./offlineTypes";

// Typed business-logic API over IndexedDB — the offline equivalent of heldSales.ts. POS, AuthContext
// and the sync engine consume these; nothing else touches offlineDb directly.

/** Client-generated UUID for an offline sale/invoice (same fallback shape POS already uses). */
export function newOfflineSaleId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
