import { beforeEach, describe, expect, it } from "vitest";
import { deleteDB } from "idb";
import { DB_NAME, __resetDbForTests, getDb } from "./offlineDb";
import {
  applyLocalPaymentDelta,
  applyLocalStockDelta,
  cacheInvoices,
  cacheProducts,
  cacheSession,
  countPending,
  countPendingInvoices,
  countPendingPayments,
  discardPaymentReview,
  discardReviewSale,
  enqueueInvoice,
  enqueuePayment,
  enqueueSale,
  listPaymentReviews,
  listQueuedInvoices,
  listQueuedPayments,
  listQueuedSales,
  listReviewSales,
  markSaleFailed,
  movePaymentToReview,
  moveToReview,
  newOfflineSaleId,
  putCachedInvoice,
  readCachedInvoices,
  readCachedProducts,
  readCachedSession,
  removeQueuedInvoice,
  removeQueuedPayment,
  removeQueuedSale,
  retryReviewSale,
} from "./offlineStore";
import type { CachedInvoice, CachedProduct, QueuedInvoice, QueuedPayment, QueuedSale } from "./offlineTypes";

const BIZ = "biz-1";

const cachedInvoice = (id: string, total: number, paid = 0): CachedInvoice => ({
  id, business_id: BIZ, invoice_number: `260629-${id}`, customer_name: "Mrs. Bola",
  total, amount_paid: paid, status: paid > 0 ? "partial" : "issued", cachedAt: 1,
});

const queuedPayment = (paymentId: string, invoiceId: string, amount: number): QueuedPayment => ({
  paymentId, invoiceId, invoiceNumber: `260629-${invoiceId}`, businessId: BIZ,
  amount, method: "cash", note: null, createdAt: `2026-06-29T0${paymentId}:00:00Z`,
  status: "pending", attempts: 0,
});

const queuedInvoice = (invoiceId: string, total: number): QueuedInvoice => ({
  invoiceId, businessId: BIZ, invoiceNumber: `off-${invoiceId}`,
  customerName: "Mrs. Bola", customerPhone: null, customerEmail: null, dueDate: null, notes: null,
  items: [{ description: "Item", quantity: 1, unit_price: total }],
  subtotal: total, total, createdAt: `2026-06-29T0${invoiceId}:00:00Z`, status: "pending", attempts: 0,
});

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

describe("offline DB schema", () => {
  it("creates every object store (guards against a stale DB missing a store)", async () => {
    const db = await getDb();
    expect([...db.objectStoreNames].sort()).toEqual(
      ["dashboard", "invoiceQueue", "invoicesCache", "meta", "paymentQueue", "paymentReviewQueue", "products", "reviewQueue", "saleQueue", "session"],
    );
  });
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

describe("invoice cache (offline deposits)", () => {
  it("stores and replaces the eligible-invoice snapshot wholesale", async () => {
    await cacheInvoices(BIZ, [cachedInvoice("a", 10000), cachedInvoice("b", 5000, 2000)]);
    expect((await readCachedInvoices(BIZ)).map((i) => i.id).sort()).toEqual(["a", "b"]);
    // Re-caching drops invoices that are no longer eligible (e.g. fully paid online).
    await cacheInvoices(BIZ, [cachedInvoice("a", 10000)]);
    expect((await readCachedInvoices(BIZ)).map((i) => i.id)).toEqual(["a"]);
  });

  it("optimistically applies a deposit: partial, then paid when the balance clears", async () => {
    await cacheInvoices(BIZ, [cachedInvoice("a", 10000)]);
    await applyLocalPaymentDelta("a", 4000);
    let inv = (await readCachedInvoices(BIZ))[0];
    expect(inv.amount_paid).toBe(4000);
    expect(inv.status).toBe("partial");
    await applyLocalPaymentDelta("a", 6000);
    inv = (await readCachedInvoices(BIZ))[0];
    expect(inv.amount_paid).toBe(10000);
    expect(inv.status).toBe("paid");
  });

  it("keeps locally-created invoices when the server snapshot is replaced", async () => {
    await putCachedInvoice({ ...cachedInvoice("local-1", 5000), local: true });
    await cacheInvoices(BIZ, [cachedInvoice("server-1", 8000)]); // wholesale replace of server rows
    expect((await readCachedInvoices(BIZ)).map((i) => i.id).sort()).toEqual(["local-1", "server-1"]);
  });
});

describe("invoice queue (offline-created invoices)", () => {
  it("enqueues, counts, lists in createdAt order, and removes", async () => {
    await enqueueInvoice(queuedInvoice("1", 5000));
    await enqueueInvoice(queuedInvoice("2", 3000));
    expect(await countPendingInvoices(BIZ)).toBe(2);
    expect((await listQueuedInvoices(BIZ)).map((i) => i.invoiceId)).toEqual(["1", "2"]);
    await removeQueuedInvoice("1");
    expect(await countPendingInvoices(BIZ)).toBe(1);
  });

  it("removeQueuedInvoice also drops the local cache row (server copy re-caches later)", async () => {
    await enqueueInvoice(queuedInvoice("1", 5000));
    await putCachedInvoice({ ...cachedInvoice("1", 5000), local: true });
    await removeQueuedInvoice("1");
    expect(await readCachedInvoices(BIZ)).toHaveLength(0);
  });
});

describe("payment queue (offline deposits)", () => {
  it("enqueues, counts, lists in createdAt order, and removes", async () => {
    await enqueuePayment(queuedPayment("1", "a", 4000));
    await enqueuePayment(queuedPayment("2", "a", 6000));
    expect(await countPendingPayments(BIZ)).toBe(2);
    expect((await listQueuedPayments(BIZ)).map((p) => p.paymentId)).toEqual(["1", "2"]);
    await removeQueuedPayment("1");
    expect(await countPendingPayments(BIZ)).toBe(1);
  });

  it("moves a payment to review and discards it", async () => {
    await enqueuePayment(queuedPayment("1", "a", 4000));
    await movePaymentToReview("1", "Balance changed");
    expect(await countPendingPayments(BIZ)).toBe(0);
    const review = await listPaymentReviews(BIZ);
    expect(review).toHaveLength(1);
    expect(review[0].reviewReason).toBe("Balance changed");
    await discardPaymentReview("1");
    expect(await listPaymentReviews(BIZ)).toHaveLength(0);
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
