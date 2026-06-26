-- Support for the daily "email alerts" GitHub Action (renewal reminders + limit warnings),
-- which runs as service_role and sends via sender.net SMTP. The DB only needs an idempotency
-- log and a snapshot RPC; the selection/threshold logic and sending live in the Action.

create table if not exists public.email_alerts_sent (
  business_id uuid not null references public.businesses(id) on delete cascade,
  alert_key text not null,
  sent_at timestamptz not null default now(),
  primary key (business_id, alert_key)
);
alter table public.email_alerts_sent enable row level security;
-- No policies (RLS-deny for app users); the Action uses service_role, which bypasses RLS.
grant select, insert, delete on public.email_alerts_sent to service_role;

-- One row per business: owner email, plan/renewal, and current counts for each capped resource.
create or replace function public.businesses_alert_snapshot()
returns table (
  business_id uuid,
  business_name text,
  owner_email text,
  subscription_tier text,
  subscription_renews_at timestamptz,
  products int,
  suppliers int,
  raw_materials int,
  purchase_orders int,
  invoices int,
  staff int
)
language sql
security definer
set search_path = public
as $$
  select
    b.id, b.name, u.email, b.subscription_tier, b.subscription_renews_at,
    (select count(*) from public.products        p  where p.business_id  = b.id)::int,
    (select count(*) from public.suppliers       s  where s.business_id  = b.id)::int,
    (select count(*) from public.raw_materials   r  where r.business_id  = b.id)::int,
    (select count(*) from public.purchase_orders po where po.business_id = b.id)::int,
    (select count(*) from public.invoices        i  where i.business_id  = b.id)::int,
    (select count(*) from public.user_roles      ur where ur.business_id = b.id)::int
  from public.businesses b
  join auth.users u on u.id = b.owner_id;
$$;

revoke execute on function public.businesses_alert_snapshot() from public, anon, authenticated;
grant execute on function public.businesses_alert_snapshot() to service_role;
