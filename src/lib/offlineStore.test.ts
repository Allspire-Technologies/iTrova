import { beforeEach, describe, expect, it } from "vitest";
import { deleteDB } from "idb";
import { DB_NAME, __resetDbForTests } from "./offlineDb";
import {
  applyLocalStockDelta,
  cacheProducts,
  cacheSession,
  countPending,
  discardReviewSale,
  enqueueSale,
  listQueuedSales,
  listReviewSales,
  markSaleFailed,
  moveToReview,
  newOfflineSaleId,
  readCachedProducts,
  readCachedSession,
  removeQueuedSale,
  retryReviewSale,
} from "./offlineStore";
import type { CachedProduct, QueuedSale } from "./offlineTypes";

const BIZ = "biz-1";

const product = (id: string, stock: number): CachedProduct => ({
  id,
  business_id: BIZ,
  name: `Product ${id}`,
  sku: null,
  selling_price: 100,
  stock_quantity: stock,
  reorder_level: 5,
  category: null,
});

const sale = (saleId: string, items: QueuedSale["items"] = []): QueuedSale => ({
  saleId,
  invoiceId: `inv-${saleId}`,
  invoiceNumber: `260628-${saleId}`,
  businessId: BIZ,
  staffId: "staff-1",
  createdAt: new Date(2026, 5, 28).toISOString(),
  paymentMethod: "cash",
  discount: 0,
  subtotal: 100,
  total: 100,
  customerName: "Walk-in Customer",
  items,
  status: "pending",
  attempts: 0,
});

beforeEach(async () => {
  await __resetDbForTests();
  await deleteDB(DB_NAME);
});

describe("newOfflineSaleId", () => {
  it("produces unique non-empty ids", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newOfflineSaleId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id.length).toBeGreaterThan(0);
  });
});

describe("products cache", () => {
  it("stores and reads a business catalogue, and replaces it wholesale", async () => {
    await cacheProducts(BIZ, [product("a", 10), product("b", 3)]);
    expect((await readCachedProducts(BIZ)).map((p) => p.id).sort()).toEqual(["a", "b"]);

    // Re-caching drops products no longer present (e.g. went out of stock).
    await cacheProducts(BIZ, [product("a", 8)]);
    const after = await readCachedProducts(BIZ);
    expect(after.map((p) => p.id)).toEqual(["a"]);
    expect(after[0].stock_quantity).toBe(8);
  });

  it("decrements the snapshot on an offline sale, clamped at 0", async () => {
    await cacheProducts(BIZ, [product("a", 5)]);
    await applyLocalStockDelta(BIZ, [{ product_id: "a", name: "A", quantity: 7, unit_price: 100 }]);
    expect((await readCachedProducts(BIZ))[0].stock_quantity).toBe(0);
  });
});

describe("sale queue", () => {
  it("enqueues, counts, lists in createdAt order, and removes", async () => {
    await enqueueSale({ ...sale("s1"), createdAt: new Date(2026, 5, 28, 9).toISOString() });
    await enqueueSale({ ...sale("s2"), createdAt: new Date(2026, 5, 28, 8).toISOString() });
    expect(await countPending(BIZ)).toBe(2);
    expect((await listQueuedSales(BIZ)).map((s) => s.saleId)).toEqual(["s2", "s1"]);

    await removeQueuedSale("s2");
    expect(await countPending(BIZ)).toBe(1);
  });

  it("marks a sale failed with an error", async () => {
    await enqueueSale(sale("s1"));
    await markSaleFailed("s1", "network");
    const [row] = await listQueuedSales(BIZ);
    expect(row.status).toBe("failed");
    expect(row.lastError).toBe("network");
  });
});

describe("review queue", () => {
  it("moves a sale to review, lists it, and retry returns it to pending", async () => {
    await enqueueSale(sale("s1"));
    await moveToReview("s1", "Garri 50kg");
    expect(await countPending(BIZ)).toBe(0);
    const review = await listReviewSales(BIZ);
    expect(review).toHaveLength(1);
    expect(review[0].reviewReason).toBe("Garri 50kg");

    await retryReviewSale("s1");
    expect(await listReviewSales(BIZ)).toHaveLength(0);
    const [back] = await listQueuedSales(BIZ);
    expect(back.status).toBe("pending");
  });

  it("discards a reviewed sale", async () => {
    await enqueueSale(sale("s1"));
    await moveToReview("s1", "reason");
    await discardReviewSale("s1");
    expect(await listReviewSales(BIZ)).toHaveLength(0);
  });
});

describe("session cache", () => {
  it("stores and reads back the most recent session", async () => {
    await cacheSession({ businessId: BIZ, business: { id: BIZ }, profile: null, staffId: "staff-1", role: "owner", planModules: ["pos"], cachedAt: 1 });
    await cacheSession({ businessId: "biz-2", business: { id: "biz-2" }, profile: null, staffId: "staff-2", role: "owner", planModules: null, cachedAt: 2 });
    expect((await readCachedSession())?.businessId).toBe("biz-2"); // most recent
    expect((await readCachedSession(BIZ))?.staffId).toBe("staff-1"); // by id
  });
});
