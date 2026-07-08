import { supabase } from "@/integrations/supabase/client";

// The taxes table postdates the generated Supabase types, so cast the client once (same pattern as
// generalStore.ts / expenditure.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export type Tax = {
  id: string;
  business_id: string;
  name: string;
  rate: number; // percent, e.g. 7.5
  is_default: boolean;
  active: boolean;
  created_at: string;
};

// ---------------------------------------------------------------- pure helpers (unit-tested)

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** The VAT rate (percent) that applies to a product, or null when it's exempt / the tax is inactive. */
export function productRate(taxId: string | null | undefined, taxes: Pick<Tax, "id" | "rate" | "active">[]): number | null {
  if (!taxId) return null;
  const t = taxes.find(x => x.id === taxId);
  return t && t.active && Number(t.rate) > 0 ? Number(t.rate) : null;
}

/** Split one line into net base + tax + gross. `ratePct` null/0 = exempt. */
export function lineTax(unitPrice: number, qty: number, ratePct: number | null, inclusive: boolean): { base: number; tax: number; gross: number } {
  const gross = (Number(unitPrice) || 0) * (Number(qty) || 0);
  const r = (Number(ratePct) || 0) / 100;
  if (r <= 0) return { base: gross, tax: 0, gross };
  if (inclusive) { const base = gross / (1 + r); return { base, tax: gross - base, gross }; }
  const tax = gross * r;
  return { base: gross, tax, gross: gross + tax };
}

export type CartTaxLine = { unitPrice: number; qty: number; ratePct: number | null };
export type CartTax = { subtotal: number; discount: number; taxableBase: number; exemptBase: number; taxTotal: number; total: number };

/**
 * Summarise a cart's tax. `subtotal` = Σ price×qty (gross when inclusive, net when exclusive). The
 * discount is clamped to the subtotal and allocated pro-rata across lines BEFORE tax (Nigerian VAT is
 * on the actual consideration). Tax is rounded to 2dp (kobo) per line. Inclusive → total is unchanged
 * (tax is embedded); exclusive → tax is added on top.
 */
export function summariseCart(lines: CartTaxLine[], discount: number, inclusive: boolean): CartTax {
  const grosses = lines.map(l => (Number(l.unitPrice) || 0) * (Number(l.qty) || 0));
  const subtotal = grosses.reduce((a, b) => a + b, 0);
  const disc = Math.min(Math.max(Number(discount) || 0, 0), subtotal);
  let taxableBase = 0, exemptBase = 0, taxTotal = 0;
  for (let i = 0; i < lines.length; i++) {
    const alloc = subtotal > 0 ? disc * (grosses[i] / subtotal) : 0;
    const amt = grosses[i] - alloc; // discounted line amount (gross if inclusive, net if exclusive)
    const r = (Number(lines[i].ratePct) || 0) / 100;
    if (r <= 0) { exemptBase += amt; continue; }
    if (inclusive) { const tax = round2(amt - amt / (1 + r)); taxTotal += tax; taxableBase += amt - tax; }
    else { const tax = round2(amt * r); taxTotal += tax; taxableBase += amt; }
  }
  const total = inclusive ? subtotal - disc : subtotal - disc + taxTotal;
  return {
    subtotal: round2(subtotal), discount: round2(disc), taxableBase: round2(taxableBase),
    exemptBase: round2(exemptBase), taxTotal: round2(taxTotal), total: round2(total),
  };
}

/** Net VAT payable to the tax authority = output VAT (on sales) − input VAT (on purchases). */
export function netVat(outputVat: number, inputVat: number): number {
  return round2((Number(outputVat) || 0) - (Number(inputVat) || 0));
}

export function formatRate(rate: number): string {
  return `${Number(rate) % 1 === 0 ? Number(rate) : Number(rate).toFixed(1)}%`;
}

// ---------------------------------------------------------------- data access

export async function listTaxes(): Promise<Tax[]> {
  const { data, error } = await sb.from("taxes").select("*").order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as Tax[];
}

export async function saveTax(businessId: string, id: string | null, fields: { name: string; rate: number; is_default: boolean; active: boolean }): Promise<void> {
  // Only one default at a time — clear the others when this becomes the default.
  if (fields.is_default) await sb.from("taxes").update({ is_default: false }).eq("business_id", businessId).neq("id", id ?? "00000000-0000-0000-0000-000000000000");
  const { error } = id
    ? await sb.from("taxes").update(fields).eq("id", id)
    : await sb.from("taxes").insert({ ...fields, business_id: businessId });
  if (error) throw new Error(error.message);
}

export async function deleteTax(id: string): Promise<void> {
  const { error } = await sb.from("taxes").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
