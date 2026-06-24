-- Module entitlements: which app modules/perks a plan grants. This is the single
-- source of truth — it gates access AND drives the features bullet list.

-- Catalogue of grantable modules. path set = a gateable page; null = a non-page perk.
create table if not exists public.app_modules (
  key text primary key,
  label text not null,
  path text,
  sort_order int not null default 0,
  is_active boolean not null default true
);
alter table public.app_modules enable row level security;
drop policy if exists "app_modules readable" on public.app_modules;
create policy "app_modules readable" on public.app_modules for select to authenticated using (true);
grant select on public.app_modules to authenticated;

insert into public.app_modules (key, label, path, sort_order) values
  ('inventory',        'Inventory',          '/inventory',        1),
  ('pos',              'Point of Sale',      '/pos',              2),
  ('suppliers',        'Suppliers',          '/suppliers',        3),
  ('raw_materials',    'Raw materials',      '/raw-materials',    4),
  ('invoices',         'Invoices',           '/invoices',         5),
  ('purchase_orders',  'Purchase orders',    '/purchase-orders',  6),
  ('reports',          'Reports',            '/reports',          7),
  ('team',             'Team management',    '/team',             8),
  ('insights',         'AI Business Insights','/insights',        9),
  ('advanced_analytics','Advanced analytics', null,               10),
  ('priority_support', 'Priority support',   null,                11),
  ('api_access',       'API access',         null,                12),
  ('csv_import',       'CSV Import',          null,               13),
  ('csv_export',       'CSV Export',          null,               14),
  ('dedicated_support','Dedicated support',  null,                15)
on conflict (key) do nothing;

-- plans.modules: array of app_modules keys the plan includes.
alter table public.plans add column if not exists modules jsonb not null default '[]'::jsonb;

-- features is derived from modules: regenerate it whenever modules changes.
create or replace function public.sync_plan_features()
returns trigger language plpgsql as $$
begin
  NEW.features := coalesce((
    select jsonb_agg(m.label order by m.sort_order)
    from public.app_modules m
    where m.is_active and m.key in (select jsonb_array_elements_text(NEW.modules))
  ), '[]'::jsonb);
  return NEW;
end;
$$;

drop trigger if exists plans_sync_features on public.plans;
create trigger plans_sync_features
  before insert or update of modules on public.plans
  for each row execute function public.sync_plan_features();

-- Seed modules for the catalogue plans (this regenerates their features via the trigger).
update public.plans set modules = '["inventory","pos","suppliers","raw_materials","invoices","purchase_orders","reports","team","csv_import","csv_export"]'::jsonb where key = 'free';
update public.plans set modules = '["inventory","pos","suppliers","raw_materials","invoices","purchase_orders","reports","team","csv_import","csv_export","insights","advanced_analytics","priority_support"]'::jsonb where key = 'pro';
update public.plans set modules = '["inventory","pos","suppliers","raw_materials","invoices","purchase_orders","reports","team","csv_import","csv_export","insights","advanced_analytics","priority_support","api_access","dedicated_support"]'::jsonb where key = 'business';

-- Re-key plan limits by module name so a limit can be set per module (inventory caps
-- products, team caps staff, etc.). The app also accepts the legacy resource keys.
update public.plans set limits = '{"inventory":100,"suppliers":10,"raw_materials":50,"purchase_orders":50,"invoices":300,"team":3}'::jsonb where key = 'free';
update public.plans set limits = '{"team":10}'::jsonb where key = 'pro';
update public.plans set limits = '{}'::jsonb where key = 'business';
