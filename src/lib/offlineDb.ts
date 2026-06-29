import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type { CachedInvoice, CachedProduct, CachedSession, DashboardSnapshot, QueuedInvoice, QueuedPayment, QueuedSale, ReviewPayment, ReviewSale } from "./offlineTypes";

// IndexedDB bootstrap for the offline POS layer. One database, opened lazily. All stores are
// scoped by businessId so a device that switches business never mixes another tenant's data.

export const DB_NAME = "itrova-offline";
export const DB_VERSION = 3;

interface ItrovaOfflineDB extends DBSchema {
  meta: { key: string; value: { key: string; value: unknown; updatedAt: number } };
  session: { key: string; value: CachedSession }; // keyed by businessId
  products: { key: string; value: CachedProduct; indexes: { "by-business": string } };
  dashboard: { key: string; value: { businessId: string; snapshot: DashboardSnapshot; updatedAt: number } };
  saleQueue: { key: string; value: QueuedSale; indexes: { "by-business": string; "by-status": string } };
  reviewQueue: { key: string; value: ReviewSale; indexes: { "by-business": string } };
  // v2 — offline invoicing: create manual invoices + record deposits offline
  invoicesCache: { key: string; value: CachedInvoice; indexes: { "by-business": string } };
  invoiceQueue: { key: string; value: QueuedInvoice; indexes: { "by-business": string } };
  paymentQueue: { key: string; value: QueuedPayment; indexes: { "by-business": string } };
  paymentReviewQueue: { key: string; value: ReviewPayment; indexes: { "by-business": string } };
}

/** True if this browser/context can use IndexedDB (false in private modes / SSR). */
export function isOfflineStorageAvailable(): boolean {
  try {
    return typeof indexedDB !== "undefined";
  } catch {
    return false;
  }
}

let dbPromise: Promise<IDBPDatabase<ItrovaOfflineDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<ItrovaOfflineDB>> {
  if (!isOfflineStorageAvailable()) return Promise.reject(new Error("IndexedDB unavailable"));
  if (!dbPromise) {
    dbPromise = openDB<ItrovaOfflineDB>(DB_NAME, DB_VERSION, {
      // Idempotent: create only stores that don't already exist. A DB left at an intermediate
      // version (from dev rebuilds) thus gains any missing stores instead of silently lacking them.
      upgrade(db) {
        const has = (name: string) => db.objectStoreNames.contains(name as never);
        if (!has("meta")) db.createObjectStore("meta", { keyPath: "key" });
        if (!has("session")) db.createObjectStore("session", { keyPath: "businessId" });
        if (!has("products")) {
          db.createObjectStore("products", { keyPath: "id" }).createIndex("by-business", "business_id");
        }
        if (!has("dashboard")) db.createObjectStore("dashboard", { keyPath: "businessId" });
        if (!has("saleQueue")) {
          const saleQueue = db.createObjectStore("saleQueue", { keyPath: "saleId" });
          saleQueue.createIndex("by-business", "businessId");
          saleQueue.createIndex("by-status", "status");
        }
        if (!has("reviewQueue")) {
          db.createObjectStore("reviewQueue", { keyPath: "saleId" }).createIndex("by-business", "businessId");
        }
        if (!has("invoicesCache")) {
          db.createObjectStore("invoicesCache", { keyPath: "id" }).createIndex("by-business", "business_id");
        }
        if (!has("invoiceQueue")) {
          db.createObjectStore("invoiceQueue", { keyPath: "invoiceId" }).createIndex("by-business", "businessId");
        }
        if (!has("paymentQueue")) {
          db.createObjectStore("paymentQueue", { keyPath: "paymentId" }).createIndex("by-business", "businessId");
        }
        if (!has("paymentReviewQueue")) {
          db.createObjectStore("paymentReviewQueue", { keyPath: "paymentId" }).createIndex("by-business", "businessId");
        }
      },
      // Another tab opened a newer version — close so its upgrade isn't blocked; we reopen lazily.
      blocking() {
        dbPromise?.then((db) => db.close()).catch(() => {/* already closed */});
        dbPromise = null;
      },
    });
  }
  return dbPromise;
}

/** Test helper: close + drop the cached connection so the DB can be deleted/reopened. */
export async function __resetDbForTests(): Promise<void> {
  if (dbPromise) {
    try {
      (await dbPromise).close();
    } catch {
      /* ignore */
    }
    dbPromise = null;
  }
}
