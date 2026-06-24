-- Subscription plans catalogue. Tiers and their properties (price, features, resource
-- limits) live here so they can be configured without a deploy. Businesses adopt a plan
-- via businesses.subscription_tier = plans.key.
create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  name text not null,
  description text,
  price_amount numeric not null default 0,
  price_currency text not null default 'NGN',
  billing_period text,                            -- 'month' | 'year' | null (free / one-off)
  features jsonb not null default '[]'::jsonb,     -- ["Inventory management", ...]
  limits jsonb not null default '{}'::jsonb,       -- {"products":100,...,"invoices":null}  (null = unlimited)
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.plans enable row level security;

-- Anyone signed in can read the catalogue; writes are service-role only (managed in Supabase).
drop policy if exists "plans readable by authenticated users" on public.plans;
create policy "plans readable by authenticated users"
  on public.plans for select
  to authenticated
  using (true);

insert into public.plans (key, name, description, price_amount, price_currency, billing_period, features, limits, sort_order) values
('free', 'Free', 'Everything to run a small shop', 0, 'NGN', null,
  '["Inventory management","POS & sales","Invoices & purchase orders","Supplier management","Basic reports"]'::jsonb,
  '{"products":100,"suppliers":10,"rawMaterials":50,"purchaseOrders":50,"invoices":300,"staff":3}'::jsonb,
  1),
('pro', 'Pro', 'For growing businesses', 5000, 'NGN', 'month',
  '["Everything in Free","AI Business Insights","Advanced analytics","PDF report exports","Priority support"]'::jsonb,
  '{"products":null,"suppliers":null,"rawMaterials":null,"purchaseOrders":null,"invoices":null,"staff":10}'::jsonb,
  2),
('business', 'Business', 'For multi-branch operations', 15000, 'NGN', 'month',
  '["Everything in Pro","Multi-branch support","API access","Team analytics","Dedicated support"]'::jsonb,
  '{"products":null,"suppliers":null,"rawMaterials":null,"purchaseOrders":null,"invoices":null,"staff":null}'::jsonb,
  3)
on conflict (key) do nothing;
