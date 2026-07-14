import { supabase } from "@/integrations/supabase/client";

// fixed_assets + run_depreciation postdate the generated Supabase types, so cast the client once.
const sb = supabase;

export interface FixedAsset {
  id: string;
  business_id: string;
  name: string;
  category: string | null;
  cost: number;
  year_purchased: number | null;
  depreciation_rate: number;
  active: boolean;
  created_at: string;
}

export type AssetInput = {
  name: string; category: string | null; cost: number; year_purchased: number | null; depreciation_rate: number; active: boolean;
};

export async function listAssets(): Promise<FixedAsset[]> {
  const { data, error } = await sb.from("fixed_assets").select("*").order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as FixedAsset[];
}

export async function saveAsset(businessId: string, userId: string | null, id: string | null, input: AssetInput): Promise<void> {
  const { error } = id
    ? await sb.from("fixed_assets").update(input).eq("id", id)
    : await sb.from("fixed_assets").insert({ ...input, business_id: businessId, created_by: userId });
  if (error) throw new Error(error.message);
}

export async function deleteAsset(id: string): Promise<void> {
  const { error } = await sb.from("fixed_assets").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Post straight-line depreciation to date for all assets; returns how many entries were posted. */
export async function runDepreciation(): Promise<number> {
  const { data, error } = await sb.rpc("run_depreciation");
  if (error) throw new Error(error.message);
  return Number((data as { posted?: number })?.posted ?? 0);
}

export function friendlyAssetError(message: string | undefined, fallback: string): string {
  const m = message ?? "";
  if (m.includes("NO_CHART")) return "Set up your Accounting chart of accounts first (open Accounting once).";
  if (m.includes("row-level security") || m.includes("permission") || m.includes("PERMISSION_DENIED"))
    return "You don't have permission to do that.";
  return m || fallback;
}
