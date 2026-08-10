-- Paystack as a second payment provider. Which provider serves customers is PLATFORM config,
-- not customer choice — customers keep picking transfer/card; this row decides who fulfils it.
-- APPLIES TO THE SHARED iTrova SUPABASE PROJECT (wnuyzsjhijhnhkpcnnqu).
--
-- Deliberately server-only: create-payment reads it with service_role, the browser never sees
-- or sends a provider, so a tampered request can't route itself. Changed via the SQL editor
-- for now, e.g.:  update public.billing_config set active_provider = 'paystack';
-- (A CRM admin card can layer RLS policies on later, referral_config-style.)

create table if not exists public.billing_config (
  id              boolean primary key default true check (id),   -- single-row guard
  active_provider text not null default 'monnify' check (active_provider in ('monnify', 'paystack')),
  updated_at      timestamptz not null default now()
);
insert into public.billing_config (id) values (true) on conflict (id) do nothing;

alter table public.billing_config enable row level security;
revoke all on public.billing_config from public, anon, authenticated;
grant select, update on public.billing_config to service_role;

notify pgrst, 'reload schema';
