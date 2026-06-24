-- 1) RLS controls which rows a role sees, but PostgREST still needs table-level
-- privileges. The plans / plan_prices migrations added RLS policies but not the
-- GRANTs, so authenticated users hit "permission denied for table plans" (42501).
grant select on public.plans to authenticated;
grant select on public.plan_prices to authenticated;

-- 2) Convenience view so plan_prices is readable with the plan's name/key (the base
-- table only stores plan_id). Browse public.plan_prices_view in the dashboard; keep
-- editing prices in plan_prices. security_invoker keeps the caller's RLS in effect.
create or replace view public.plan_prices_view
with (security_invoker = true) as
select
  pp.id,
  pp.plan_id,
  p.key  as plan_key,
  p.name as plan_name,
  pp.cycle,
  pp.price_amount,
  pp.discount_percent,
  pp.is_active,
  pp.sort_order
from public.plan_prices pp
join public.plans p on p.id = pp.plan_id
order by p.sort_order, pp.sort_order;

grant select on public.plan_prices_view to authenticated;
