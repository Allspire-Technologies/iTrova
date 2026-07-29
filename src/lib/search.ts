import { supabase } from "@/integrations/supabase/client";
import type { NavGrants } from "@/lib/nav";

// Global "search anything" data. Each table is RLS-scoped to the current business, so no explicit
// business_id filter is needed. Records with no detail route (products, suppliers, invoices) deep-link
// to their list filtered by ?q=; export invoices have a real detail route.

export type SearchKind = "product" | "supplier" | "invoice" | "export_invoice";

export type SearchHit = {
  id: string;
  kind: SearchKind;
  title: string;
  subtitle?: string;
  to: string;
};

export const KIND_LABEL: Record<SearchKind, string> = {
  product: "Products",
  supplier: "Suppliers",
  invoice: "Invoices",
  export_invoice: "Export invoices",
};

// PostgREST .or() takes a comma/paren-delimited filter string and `*` as the ilike wildcard, so strip
// characters that would break the expression before interpolating the user's text.
const term = (q: string) => q.replace(/[,()*%]/g, " ").trim();
const q = encodeURIComponent;

async function run<T>(builder: PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  try {
    const { data } = await builder;
    return data ?? [];
  } catch {
    return [];
  }
}

async function products(t: string): Promise<SearchHit[]> {
  const rows = await run<Record<string, unknown>>(
    supabase.from("products").select("id,name,sku,category").is("archived_at", null)
      .or(`name.ilike.*${t}*,sku.ilike.*${t}*,category.ilike.*${t}*`).limit(6),
  );
  return rows.map((p) => ({
    id: String(p.id), kind: "product", title: String(p.name),
    subtitle: [p.sku, p.category].filter(Boolean).map(String).join(" · ") || undefined,
    to: `/inventory?q=${q(String(p.name))}`,
  }));
}

async function suppliers(t: string): Promise<SearchHit[]> {
  const rows = await run<Record<string, unknown>>(
    supabase.from("suppliers").select("id,name,contact_name,phone,email")
      .or(`name.ilike.*${t}*,contact_name.ilike.*${t}*,phone.ilike.*${t}*,email.ilike.*${t}*`).limit(6),
  );
  return rows.map((s) => ({
    id: String(s.id), kind: "supplier", title: String(s.name),
    subtitle: [s.contact_name, s.phone].filter(Boolean).map(String).join(" · ") || undefined,
    to: `/suppliers?q=${q(String(s.name))}`,
  }));
}

async function invoices(t: string): Promise<SearchHit[]> {
  const rows = await run<Record<string, unknown>>(
    supabase.from("invoices").select("id,invoice_number,customer_name,total,status")
      .or(`invoice_number.ilike.*${t}*,customer_name.ilike.*${t}*,customer_phone.ilike.*${t}*`).limit(6),
  );
  return rows.map((i) => ({
    id: String(i.id), kind: "invoice", title: String(i.invoice_number),
    subtitle: [i.customer_name, i.status].filter(Boolean).map(String).join(" · ") || undefined,
    to: `/invoices?q=${q(String(i.invoice_number))}`,
  }));
}

async function exportInvoices(t: string): Promise<SearchHit[]> {
  const rows = await run<Record<string, unknown>>(
    supabase.from("export_invoices").select("id,invoice_number,buyer_name")
      .or(`invoice_number.ilike.*${t}*,buyer_name.ilike.*${t}*`).limit(6),
  );
  return rows.map((e) => ({
    id: String(e.id), kind: "export_invoice", title: String(e.invoice_number),
    subtitle: e.buyer_name ? String(e.buyer_name) : undefined,
    to: `/export-invoice/${String(e.id)}`,
  }));
}

/** Search every record type the user can access. Returns [] for a too-short query. */
export async function searchRecords(query: string, g: NavGrants): Promise<SearchHit[]> {
  const t = term(query);
  if (t.length < 2) return [];
  const enabled: Array<Promise<SearchHit[]>> = [];
  const on = (mod: string) => g.hasModule(mod) && g.can(mod, "view");
  if (on("inventory")) enabled.push(products(t));
  if (on("suppliers")) enabled.push(suppliers(t));
  if (on("invoices")) enabled.push(invoices(t));
  if (on("export_invoices")) enabled.push(exportInvoices(t));
  const results = await Promise.all(enabled);
  return results.flat();
}
