-- Store when a paid plan started and its billing cycle; derive subscription_renews_at
-- automatically (start + cycle length). Grant a plan in one statement, e.g.:
--   update public.businesses
--     set subscription_tier = 'pro', subscription_started_at = now(), subscription_cycle = 'monthly'
--     where id = '<business-uuid>';
-- The trigger then sets subscription_renews_at = now() + 1 month.

alter table public.businesses
  add column if not exists subscription_started_at timestamptz,
  add column if not exists subscription_cycle text
    check (subscription_cycle in ('monthly','quarterly','biannual','annual'));

create or replace function public.set_subscription_renews_at()
returns trigger language plpgsql as $$
begin
  if coalesce(new.subscription_tier, 'free') = 'free' then
    -- Free clears any renewal date.
    new.subscription_renews_at := null;
  elsif new.subscription_started_at is not null and new.subscription_cycle is not null then
    new.subscription_renews_at := new.subscription_started_at + case new.subscription_cycle
        when 'monthly'   then interval '1 month'
        when 'quarterly' then interval '3 months'
        when 'biannual'  then interval '6 months'
        when 'annual'    then interval '1 year'
      end;
  end if;
  -- Paid tier without start/cycle: leave subscription_renews_at as-is (manual override).
  return new;
end; $$;

drop trigger if exists trg_set_subscription_renews_at on public.businesses;
create trigger trg_set_subscription_renews_at
  before insert or update of subscription_started_at, subscription_cycle, subscription_tier
  on public.businesses
  for each row execute function public.set_subscription_renews_at();
