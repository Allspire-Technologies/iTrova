-- Production module RBAC:
--   A. default_role_permissions gains the 'production' module for managers (cashiers: none).
--      This re-declaration SUPERSEDES the block in 20260704150000 — the drift-guard unit test
--      (src/lib/permissions.test.ts) now parses THIS file's markers, so this JSON and
--      DEFAULT_ROLE_PERMISSIONS in src/lib/permissions.ts must change together.
--   B. product_materials (recipes — the one production surface written directly by the client)
--      trades its scaffold-era all-members write policies for per-action ones gated on
--      production.recipes_manage, matching the 20260704150000 pattern.

-- ============================================================ A. defaults
-- Keep this JSON byte-identical in spirit to DEFAULT_ROLE_PERMISSIONS in src/lib/permissions.ts.
-- RBAC_DEFAULTS_JSON_START
create or replace function public.default_role_permissions(_role public.app_role)
returns jsonb
language sql immutable
as $$
  select case _role
    when 'manager' then '{
      "inventory": ["view","create","edit","adjust_stock","csv_import","csv_export"],
      "pos": ["view","orders_manage","orders_delete","eod_report","review_offline"],
      "suppliers": ["view","create","edit","delete","csv_import","csv_export"],
      "raw_materials": ["view","create","edit","record_purchase","adjust_stock","csv_import","csv_export"],
      "invoices": ["view","create","edit","status_change","record_payment","delete","csv_export"],
      "export_invoices": ["view","create"],
      "purchase_orders": ["view","create","status_change","receive","delete","csv_export"],
      "general_store": ["view","item_manage","staff_manage","checkout","return","csv_import"],
      "production": ["view","recipes_manage","request","approve","produce"],
      "reports": ["view","export"]
    }'::jsonb
    when 'cashier' then '{
      "pos": ["view","orders_manage"],
      "invoices": ["view","create"]
    }'::jsonb
    else '{}'::jsonb
  end;
$$;
-- RBAC_DEFAULTS_JSON_END

-- ============================================================ B. recipe write policies
-- SELECT stays business-scoped for every member; writes now require production.recipes_manage.

drop policy if exists "biz members view product_materials"   on public.product_materials;
drop policy if exists "biz members insert product_materials" on public.product_materials;
drop policy if exists "biz members update product_materials" on public.product_materials;
drop policy if exists "biz members delete product_materials" on public.product_materials;

create policy "biz members view product_materials" on public.product_materials
  for select using (exists (
    select 1 from public.products p
    where p.id = product_materials.product_id and p.business_id = public.current_business_id()
  ));
create policy "recipe managers insert product_materials" on public.product_materials
  for insert with check (exists (
    select 1 from public.products p
    where p.id = product_materials.product_id and p.business_id = public.current_business_id()
      and public.has_permission(p.business_id, 'production', 'recipes_manage')
  ));
create policy "recipe managers update product_materials" on public.product_materials
  for update using (exists (
    select 1 from public.products p
    where p.id = product_materials.product_id and p.business_id = public.current_business_id()
      and public.has_permission(p.business_id, 'production', 'recipes_manage')
  ));
create policy "recipe managers delete product_materials" on public.product_materials
  for delete using (exists (
    select 1 from public.products p
    where p.id = product_materials.product_id and p.business_id = public.current_business_id()
      and public.has_permission(p.business_id, 'production', 'recipes_manage')
  ));

grant select, insert, update, delete on public.product_materials to authenticated;
grant all on public.product_materials to service_role;
