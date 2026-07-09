// Shared types for the offline POS layer (IndexedDB-backed). The snake_case product shape mirrors
// what POS reads from Supabase so the cached catalogue is a drop-in for the live one.

export interface CachedProduct {
  id: string;
  business_id: string;
  name: string;
  sku: string | null;
  selling_price: number;
  stock_quantity: number;
  reorder_level: number;
  category: string | null;
  tax_id?: string | null; // so offline sales can resolve the VAT rate from the cached catalogue
}

export interface QueuedSaleItem {
  product_id: string;
  name: string;
  quantity: number;
  unit_price: number;
}

export type QueuedSaleStatus = "pending" | "syncing" | "failed";

export interface QueuedSale {
  saleId: string; // client-generated UUID — also becomes sales.id (idempotency key)
  invoiceId: string; // client-generated UUID — also becomes invoices.id
  invoiceNumber: string; // invoiceFallbackNumber() — collision-proof, kept verbatim on sync
  businessId: string;
  staffId: string | null;
  createdAt: string; // ISO; becomes sales.created_at + invoice issue/created
  paymentMethod: string;
  discount: number;
  subtotal: number;
  tax?: number; // VAT captured offline (optional: sales queued before this shipped default to 0)
  total: number;
  customerName: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  notes?: string | null;
  items: QueuedSaleItem[];
  status: QueuedSaleStatus;
  attempts: number;
  lastError?: string;
}

export interface ReviewSale extends QueuedSale {
  reviewReason: string;
  movedAt: string;
}

// A loose snapshot of whatever the Dashboard/Inventory read-only views need; shaped in P1.
export type DashboardSnapshot = Record<string, unknown>;

export interface CachedSession {
  businessId: string;
  business: unknown;
  profile: unknown;
  staffId: string | null;
  role: string | null;
  planModules: string[] | null; // resolved plan modules, so hasModule() works offline
  // RBAC (optional so pre-existing cached blobs still parse): the member's role map + override,
  // so can() resolves offline the same way it did on the last online load.
  roleMap?: Record<string, string[]> | null;
  permissionOverride?: Record<string, string[]> | null;
  cachedAt: number;
}

// ---- offline deposits against server invoices (v2) --------------------------

/** Snapshot of a manual invoice that can take a deposit (issued/partial). `local` rows were
 *  created offline and aren't on the server yet — they survive the wholesale cache replace. */
export interface CachedInvoice {
  id: string;
  business_id: string;
  invoice_number: string;
  customer_name: string;
  total: number;
  amount_paid: number;
  status: string; // issued | partial | paid (locally optimistic until next sync)
  cachedAt: number;
  local?: boolean; // created offline, awaiting commit_offline_invoice
}

export type QueuedPaymentStatus = "pending" | "syncing" | "failed";

export interface QueuedInvoiceItem {
  description: string;
  quantity: number;
  unit_price: number;
}

/** A manual invoice created offline, replayed through commit_offline_invoice on reconnect. */
export interface QueuedInvoice {
  invoiceId: string; // client-generated UUID — becomes invoices.id (idempotency key)
  businessId: string;
  invoiceNumber: string; // invoiceFallbackNumber() — collision-proof, kept verbatim on sync
  customerName: string;
  customerPhone: string | null;
  customerEmail: string | null;
  dueDate: string | null;
  notes: string | null;
  items: QueuedInvoiceItem[];
  subtotal: number;
  total: number;
  createdAt: string; // ISO
  status: QueuedPaymentStatus;
  attempts: number;
  lastError?: string;
}

/** A deposit captured offline, replayed through record_invoice_payment on reconnect. */
export interface QueuedPayment {
  paymentId: string; // client-generated UUID — idempotency key for record_invoice_payment
  invoiceId: string;
  invoiceNumber: string; // for display in the queue
  businessId: string;
  amount: number;
  method: string;
  note: string | null;
  createdAt: string; // ISO
  status: QueuedPaymentStatus;
  attempts: number;
  lastError?: string;
}

export interface ReviewPayment extends QueuedPayment {
  reviewReason: string;
  movedAt: string;
}
