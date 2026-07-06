-- Experience Roadmap · Phase 3 (F4): POS online checkout used 6 sequential round-trips
-- (deduct stock → sale → sale_items → invoice number → invoice → invoice_items), ~600–1200 ms of
-- "Processing…" on the app's hottest action, with client-side compensation on partial failure.
-- The atomic commit_offline_sale RPC (20260629110000) already performs the whole flow in one
-- transaction with an oversell guard, so online checkout now goes through this thin wrapper.
-- The only online-specific need it adds: assigning the proper sequential invoice number
-- server-side, inside the same call. Offline sales keep sending their collision-proof fallback
-- number, so the assignment only happens when the client sends none.

create or replace function public.commit_pos_sale(_sale jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_id uuid := (_sale->>'business_id')::uuid;
begin
  if v_business_id is null or v_business_id <> public.current_business_id() then
    raise exception 'not authorised for this business';
  end if;

  if coalesce(_sale->>'invoice_number', '') = '' then
    _sale := jsonb_set(_sale, '{invoice_number}', to_jsonb(public.next_invoice_number(v_business_id)));
  end if;

  return public.commit_offline_sale(_sale);
end;
$$;

revoke all on function public.commit_pos_sale(jsonb) from public, anon;
grant execute on function public.commit_pos_sale(jsonb) to authenticated;
