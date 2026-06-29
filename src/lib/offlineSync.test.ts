import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteDB } from "idb";
import { DB_NAME, __resetDbForTests } from "./offlineDb";
import { enqueueInvoice, enqueuePayment, enqueueSale, listPaymentReviews, listQueuedInvoices, listQueuedPayments, listQueuedSales, listReviewSales } from "./offlineStore";
import { classifyError, drainInvoices, drainInvoicing, drainPayments, drainQueue, syncOne, syncOnePayment } from "./offlineSync";
import type { QueuedInvoice, QueuedPayment, QueuedSale } from "./offlineTypes";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

const BIZ = "biz-1";
const sale = (saleId: string): QueuedSale => ({
  saleId,
  invoiceId: `inv-${saleId}`,
  invoiceNumber: `260628-${saleId}`,
  businessId: BIZ,
  staffId: "staff-1",
  createdAt: `2026-06-28T0${saleId}:00:00Z`,
  paymentMethod: "cash",
  discount: 0,
  subtotal: 100,
  total: 100,
  customerName: "Walk-in Customer",
  items: [{ product_id: "p1", name: "Garri", quantity: 1, unit_price: 100 }],
  status: "pending",
  attempts: 0,
});

const payment = (paymentId: string): QueuedPayment => ({
  paymentId,
  invoiceId: "inv-1",
  invoiceNumber: "260629-1",
  businessId: BIZ,
  amount: 4000,
  method: "cash",
  note: null,
  createdAt: `2026-06-29T0${paymentId}:00:00Z`,
  status: "pending",
  attempts: 0,
});

const invoice = (invoiceId: string): QueuedInvoice => ({
  invoiceId,
  businessId: BIZ,
  invoiceNumber: `off-${invoiceId}`,
  customerName: "Mrs. Bola",
  customerPhone: null,
  customerEmail: null,
  dueDate: null,
  notes: null,
  items: [{ description: "Item", quantity: 1, unit_price: 5000 }],
  subtotal: 5000,
  total: 5000,
  createdAt: `2026-06-29T0${invoiceId}:00:00Z`,
  status: "pending",
  attempts: 0,
});

beforeEach(async () => {
  await __resetDbForTests();
  await deleteDB(DB_NAME);
  rpc.mockReset();
});

describe("classifyError", () => {
  it("routes NEEDS_REVIEW to review and everything else to transient", () => {
    expect(classifyError("NEEDS_REVIEW:Garri 50kg")).toBe("review");
    expect(classifyError("Failed to fetch")).toBe("transient");
    expect(classifyError(undefined)).toBe("transient");
  });
});

describe("syncOne", () => {
  it("commits and removes the sale from the queue", async () => {
    await enqueueSale(sale("1"));
    rpc.mockResolvedValue({ data: { status: "committed" }, error: null });
    const out = await syncOne(sale("1"));
    expect(out.result).toBe("committed");
    expect(await listQueuedSales(BIZ)).toHaveLength(0);
  });

  it("treats a duplicate (ack-loss) as success and removes it", async () => {
    await enqueueSale(sale("1"));
    rpc.mockResolvedValue({ data: { status: "duplicate" }, error: null });
    const out = await syncOne(sale("1"));
    expect(out.result).toBe("duplicate");
    expect(await listQueuedSales(BIZ)).toHaveLength(0);
  });

  it("moves a NEEDS_REVIEW sale to the review queue", async () => {
    await enqueueSale(sale("1"));
    rpc.mockResolvedValue({ data: null, error: { message: "NEEDS_REVIEW:Garri 50kg" } });
    const out = await syncOne(sale("1"));
    expect(out).toMatchObject({ result: "review", reason: "Garri 50kg" });
    expect(await listQueuedSales(BIZ)).toHaveLength(0);
    expect(await listReviewSales(BIZ)).toHaveLength(1);
  });

  it("keeps a transient failure in the queue", async () => {
    await enqueueSale(sale("1"));
    rpc.mockResolvedValue({ data: null, error: { message: "Failed to fetch" } });
    const out = await syncOne(sale("1"));
    expect(out.result).toBe("transient");
    const [row] = await listQueuedSales(BIZ);
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(1);
  });
});

describe("drainQueue", () => {
  it("commits every queued sale in order", async () => {
    await enqueueSale(sale("1"));
    await enqueueSale(sale("2"));
    rpc.mockResolvedValue({ data: { status: "committed" }, error: null });
    const outcomes = await drainQueue(BIZ);
    expect(outcomes.map((o) => o.result)).toEqual(["committed", "committed"]);
    expect(await listQueuedSales(BIZ)).toHaveLength(0);
  });

  it("stops on a transient failure and leaves the rest queued", async () => {
    await enqueueSale(sale("1"));
    await enqueueSale(sale("2"));
    rpc.mockResolvedValue({ data: null, error: { message: "network down" } });
    const outcomes = await drainQueue(BIZ);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].result).toBe("transient");
    expect(await listQueuedSales(BIZ)).toHaveLength(2); // both still queued
  });
});

describe("syncOnePayment", () => {
  it("commits a deposit and removes it from the queue", async () => {
    await enqueuePayment(payment("1"));
    rpc.mockResolvedValue({ data: { status: "committed" }, error: null });
    const out = await syncOnePayment(payment("1"));
    expect(out.result).toBe("committed");
    expect(await listQueuedPayments(BIZ)).toHaveLength(0);
  });

  it("treats a duplicate replay as success (idempotent)", async () => {
    await enqueuePayment(payment("1"));
    rpc.mockResolvedValue({ data: { status: "duplicate" }, error: null });
    const out = await syncOnePayment(payment("1"));
    expect(out.result).toBe("duplicate");
    expect(await listQueuedPayments(BIZ)).toHaveLength(0);
  });

  it("moves a NEEDS_REVIEW deposit (overpay/balance shrank) to review", async () => {
    await enqueuePayment(payment("1"));
    rpc.mockResolvedValue({ data: null, error: { message: "NEEDS_REVIEW:260629-1" } });
    const out = await syncOnePayment(payment("1"));
    expect(out).toMatchObject({ result: "review", reason: "260629-1" });
    expect(await listQueuedPayments(BIZ)).toHaveLength(0);
    expect(await listPaymentReviews(BIZ)).toHaveLength(1);
  });

  it("keeps a transient failure queued for retry", async () => {
    await enqueuePayment(payment("1"));
    rpc.mockResolvedValue({ data: null, error: { message: "Failed to fetch" } });
    const out = await syncOnePayment(payment("1"));
    expect(out.result).toBe("transient");
    const [row] = await listQueuedPayments(BIZ);
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(1);
  });
});

describe("drainPayments", () => {
  it("commits every queued deposit in order", async () => {
    await enqueuePayment(payment("1"));
    await enqueuePayment(payment("2"));
    rpc.mockResolvedValue({ data: { status: "committed" }, error: null });
    const outcomes = await drainPayments(BIZ);
    expect(outcomes.map((o) => o.result)).toEqual(["committed", "committed"]);
    expect(await listQueuedPayments(BIZ)).toHaveLength(0);
  });

  it("stops on a transient failure and leaves the rest queued", async () => {
    await enqueuePayment(payment("1"));
    await enqueuePayment(payment("2"));
    rpc.mockResolvedValue({ data: null, error: { message: "network down" } });
    const outcomes = await drainPayments(BIZ);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].result).toBe("transient");
    expect(await listQueuedPayments(BIZ)).toHaveLength(2);
  });
});

describe("drainInvoices", () => {
  it("commits a queued offline invoice and removes it", async () => {
    await enqueueInvoice(invoice("1"));
    rpc.mockResolvedValue({ data: { status: "committed" }, error: null });
    const outcomes = await drainInvoices(BIZ);
    expect(outcomes.map((o) => o.result)).toEqual(["committed"]);
    expect(await listQueuedInvoices(BIZ)).toHaveLength(0);
  });

  it("keeps a transient failure queued", async () => {
    await enqueueInvoice(invoice("1"));
    rpc.mockResolvedValue({ data: null, error: { message: "network down" } });
    const outcomes = await drainInvoices(BIZ);
    expect(outcomes[0].result).toBe("transient");
    expect(await listQueuedInvoices(BIZ)).toHaveLength(1);
  });
});

describe("drainInvoicing (invoices before deposits)", () => {
  it("syncs the invoice first, then its deposit", async () => {
    await enqueueInvoice(invoice("1"));
    await enqueuePayment(payment("1"));
    rpc.mockResolvedValue({ data: { status: "committed" }, error: null });
    const outcomes = await drainInvoicing(BIZ);
    expect(outcomes.map((o) => o.result)).toEqual(["committed", "committed"]);
    // The invoice RPC must run before the payment RPC.
    expect(rpc.mock.calls[0][0]).toBe("commit_offline_invoice");
    expect(rpc.mock.calls[1][0]).toBe("record_invoice_payment");
    expect(await listQueuedInvoices(BIZ)).toHaveLength(0);
    expect(await listQueuedPayments(BIZ)).toHaveLength(0);
  });

  it("holds deposits when the invoice can't sync (avoids orphan NEEDS_REVIEW)", async () => {
    await enqueueInvoice(invoice("1"));
    await enqueuePayment(payment("1"));
    rpc.mockResolvedValue({ data: null, error: { message: "network down" } });
    const outcomes = await drainInvoicing(BIZ);
    expect(outcomes.map((o) => o.result)).toEqual(["transient"]);
    expect(rpc).toHaveBeenCalledTimes(1); // never attempted the deposit
    expect(await listQueuedPayments(BIZ)).toHaveLength(1);
  });
});
