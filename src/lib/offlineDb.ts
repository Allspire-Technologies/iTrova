import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type { CachedProduct, CachedSession, DashboardSnapshot, QueuedSale, ReviewSale } from "./offlineTypes";

// IndexedDB bootstrap for the offline POS layer. One database, opened lazily. All stores are
// scoped by businessId so a device that switches business never mixes another tenant's data.

export const DB_NAME = "itrova-offline";
export const DB_VERSION = 1;

interface ItrovaOfflineDB extends DBSchema {
  meta: { key: string; value: { key: string; value: unknown; updatedAt: number } };
  session: { key: string; value: CachedSession }; // keyed by businessId
  products: { key: string; value: CachedProduct; indexes: { "by-business": string } };
  dashboard: { key: string; value: { businessId: string; snapshot: DashboardSnapshot; updatedAt: number } };
  saleQueue: { key: string; value: QueuedSale; indexes: { "by-business": string; "by-status": string } };
  reviewQueue: { key: string; value: ReviewSale; indexes: { "by-business": string } };
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
      upgrade(db) {
        db.createObjectStore("meta", { keyPath: "key" });
        db.createObjectStore("session", { keyPath: "businessId" });
        const products = db.createObjectStore("products", { keyPath: "id" });
        products.createIndex("by-business", "business_id");
        db.createObjectStore("dashboard", { keyPath: "businessId" });
        const saleQueue = db.createObjectStore("saleQueue", { keyPath: "saleId" });
        saleQueue.createIndex("by-business", "businessId");
        saleQueue.createIndex("by-status", "status");
        const reviewQueue = db.createObjectStore("reviewQueue", { keyPath: "saleId" });
        reviewQueue.createIndex("by-business", "businessId");
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
