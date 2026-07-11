-- Assets Management module (paid): fixed-asset register + depreciation. Register it in the catalogue
-- (enable per plan via plans.modules) and grant managers the module by default. Re-declares
-- default_role_permissions — keep the JSON byte-compatible with DEFAULT_ROLE_PERMISSIONS in
-- src/lib/permissions.ts (the drift-guard test now parses THIS migration).

insert into public.app_modules (key, label, path, sort_order)
values ('assets', 'Assets', '/assets', 22)
on conflict (key) do nothing;

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
      "raw_materials": ["view","create","edit","record_purchase","adjust_stock","link_product","reorder","approve_requests","reject_requests","csv_import","csv_export"],
      "invoices": ["view","create","edit","status_change","record_payment","delete","print","download","csv_export"],
      "export_invoices": ["view","create","download"],
      "purchase_orders": ["view","create","status_change","receive","delete","download","csv_import","csv_export"],
      "general_store": ["view","item_manage","staff_manage","checkout","return","csv_import"],
      "production": ["view","request","produce"],
      "expenditure": ["view","create","edit","delete","export","csv_import","csv_export"],
      "reports": ["view","export"],
      "accounting": ["view","export","manage"],
      "assets": ["view","create","edit","delete","depreciate"]
    }'::jsonb
    when 'cashier' then '{
      "pos": ["view","orders_manage"],
      "invoices": ["view","create","print"]
    }'::jsonb
    else '{}'::jsonb
  end;
$$;
-- RBAC_DEFAULTS_JSON_END

notify pgrst, 'reload schema';
