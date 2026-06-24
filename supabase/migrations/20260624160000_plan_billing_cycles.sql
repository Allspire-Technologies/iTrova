-- Custom (per-business) plans + plan-level promo, and per-cycle pricing.

-- A plan with business_id set is a custom plan only that business can see/adopt;
-- business_id null = the shared catalogue. promo_* is an optional discount layered
-- on top of any cycle price.
alter table public.plans add column if not exists business_id uuid references public.businesses(id) on delete cascade;
alter table public.plans add column if not exists promo_percent numeric not null default 0;
alter table public.plans add column if not exists promo_label text;
alter table public.plans add column if not exists promo_until timestamptz;

drop policy if exists "plans readable by authenticated users" on public.plans;
drop policy if exists "plans readable" on public.plans;
create policy "plans readable" on public.plans for select to authenticated
  using (business_id is null or business_id = public.current_business_id());

-- One row per (plan, billing cycle). discount_percent is the saving vs paying monthly.
create table if not exists public.plan_prices (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  cycle text not null check (cycle in ('monthly','quarterly','biannual','annual')),
  price_amount numeric not null default 0,
  discount_percent numeric not null default 0,
  is_active boolean not null default true,
  sort_order int not null default 0,
  unique (plan_id, cycle)
);

alter table public.plan_prices enable row level security;
drop policy if exists "plan_prices readable" on public.plan_prices;
create policy "plan_prices readable" on public.plan_prices for select to authenticated
  using (exists (
    select 1 from public.plans p
    where p.id = plan_prices.plan_id
      and (p.business_id is null or p.business_id = public.current_business_id())
  ));

-- Seed cycles for the catalogue plans.
insert into public.plan_prices (plan_id, cycle, price_amount, discount_percent, sort_order)
select id, 'monthly', 0, 0, 1 from public.plans where key = 'free'
on conflict (plan_id, cycle) do nothing;

insert into public.plan_prices (plan_id, cycle, price_amount, discount_percent, sort_order)
select pl.id, c.cycle, c.price, c.disc, c.ord
from public.plans pl, (values
  ('monthly', 5000, 0, 1),
  ('quarterly', 13500, 10, 2),
  ('biannual', 25500, 15, 3),
  ('annual', 48000, 20, 4)
) as c(cycle, price, disc, ord)
where pl.key = 'pro'
on conflict (plan_id, cycle) do nothing;

insert into public.plan_prices (plan_id, cycle, price_amount, discount_percent, sort_order)
select pl.id, c.cycle, c.price, c.disc, c.ord
from public.plans pl, (values
  ('monthly', 15000, 0, 1),
  ('quarterly', 40500, 10, 2),
  ('biannual', 76500, 15, 3),
  ('annual', 144000, 20, 4)
) as c(cycle, price, disc, ord)
where pl.key = 'business'
on conflict (plan_id, cycle) do nothing;
