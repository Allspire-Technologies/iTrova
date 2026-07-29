-- Delete inventory products — safely. APPLIES TO THE SHARED iTrova SUPABASE PROJECT.
--
-- A product cannot be blindly hard-deleted: sale_items references it with NO ACTION (delete would
-- FAIL for anything ever sold), and stock_adjustments / production_run_outputs / product_materials
-- CASCADE (deleting would silently wipe audit + history). So "Delete" is hybrid:
--   • never used in a transaction  → true DELETE (its own BOM + stock_adjustments cascade away)
--   • used anywhere transactional  → ARCHIVE (soft-delete): hidden from lists/POS/pickers but kept so
--     sales, invoices, COGS and reports stay intact; reversible via restore_product.
-- Owner-only by default (grantable per member) via the new inventory.delete permission.

alter table public.products add column if not exists archived_at timestamptz;
-- Speeds up the default "active products" lists (archived filtered out).
create index if not exists products_active_idx on public.products (business_id) where archived_at is null;

-- Delete or archive a product. Returns 'deleted' (hard) or 'archived' (soft) so the UI can explain.
create or replace function public.delete_product(_product_id uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare v_biz uuid; v_referenced boolean;
begin
  select business_id into v_biz from public.products where id = _product_id;
  if v_biz is null then raise exception 'product not found'; end if;
  if v_biz <> public.current_business_id() then raise exception 'not authorised for this business'; end if;
  if not public.has_permission(v_biz, 'inventory', 'delete') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- "Used" = referenced by any transactional record. (BOM + stock_adjustments are the product's own
  -- config/audit and cascade with a true delete, so they don't force an archive.)
  select exists (select 1 from public.sale_items            where product_id = _product_id)
      or exists (select 1 from public.invoice_items         where product_id = _product_id)
      or exists (select 1 from public.order_items           where product_id = _product_id)
      or exists (select 1 from public.production_run_outputs where product_id = _product_id)
      or exists (select 1 from public.purchase_order_items  where product_id = _product_id)
    into v_referenced;

  if v_referenced then
    update public.products set archived_at = now() where id = _product_id;
    return 'archived';
  else
    delete from public.products where id = _product_id;
    return 'deleted';
  end if;
end $$;
revoke all on function public.delete_product(uuid) from public, anon;
grant execute on function public.delete_product(uuid) to authenticated;

-- Bring an archived product back into circulation.
create or replace function public.restore_product(_product_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_biz uuid;
begin
  select business_id into v_biz from public.products where id = _product_id;
  if v_biz is null then raise exception 'product not found'; end if;
  if v_biz <> public.current_business_id() then raise exception 'not authorised for this business'; end if;
  if not public.has_permission(v_biz, 'inventory', 'delete') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.products set archived_at = null where id = _product_id;
end $$;
revoke all on function public.restore_product(uuid) from public, anon;
grant execute on function public.restore_product(uuid) to authenticated;

-- Re-point the direct-DELETE RLS policy from inventory.edit to the new inventory.delete permission
-- (defence in depth — the RPC above is SECURITY DEFINER, but a member without delete shouldn't be able
-- to remove a product by any path).
drop policy if exists "rbac delete products" on public.products;
create policy "rbac delete products" on public.products for delete
  using (business_id = public.current_business_id() and public.has_permission(business_id, 'inventory', 'delete'));

notify pgrst, 'reload schema';
