-- Public pricing feed for the marketing site (itrova.co). The site renders the catalogue from
-- this one read-only function so CRM edits to plans, cycle discounts, promos, limits, modules
-- and the referral percentages show up on the site automatically. Only the shared catalogue
-- (active plans with no business_id) is exposed; per-business custom plans never leave the
-- database. Also adds plans.highlighted so "Most popular" is data, not code.
-- APPLIES TO THE SHARED iTrova SUPABASE PROJECT (staging first, then wnuyzsjhijhnhkpcnnqu).

alter table public.plans add column if not exists highlighted boolean not null default false;
update public.plans set highlighted = (key = 'business') where business_id is null;

create or replace function public.public_pricing()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'plans', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', p.key,
        'name', p.name,
        'description', p.description,
        'monthly', p.price_amount,
        'currency', p.price_currency,
        'limits', coalesce(p.limits, '{}'::jsonb),
        'modules', coalesce(p.modules, '[]'::jsonb),
        'features', coalesce(p.features, '[]'::jsonb),
        'highlighted', coalesce(p.highlighted, false),
        'sort_order', p.sort_order,
        'promo', jsonb_build_object(
          'percent', coalesce(p.promo_percent, 0),
          'label', p.promo_label,
          'until', p.promo_until
        ),
        'prices', coalesce((
          select jsonb_agg(jsonb_build_object(
            'cycle', pp.cycle,
            'list', pp.price_amount,
            'discount_percent', pp.discount_percent
          ) order by pp.sort_order)
          from public.plan_prices pp
          where pp.plan_id = p.id and pp.is_active
        ), '[]'::jsonb)
      ) order by p.sort_order)
      from public.plans p
      where p.is_active and p.business_id is null
    ), '[]'::jsonb),
    'referral', (
      select jsonb_build_object(
        'affiliate_share_percent', c.affiliate_share_percent,
        'business_share_percent', c.business_share_percent,
        'referee_discount_percent', c.referee_discount_percent
      )
      from public.referral_config c
      limit 1
    ),
    'generated_at', now()
  );
$$;

revoke all on function public.public_pricing() from public;
grant execute on function public.public_pricing() to anon, authenticated;

notify pgrst, 'reload schema';
