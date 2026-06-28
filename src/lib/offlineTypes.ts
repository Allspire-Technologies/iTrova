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
  total: number;
  customerName: string;
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
  cachedAt: number;
}
