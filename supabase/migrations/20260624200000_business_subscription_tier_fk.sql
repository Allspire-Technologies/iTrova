-- businesses.subscription_tier was capped to ('free','pro','business') by a static CHECK,
-- which rejects newer catalogue tiers like 'enterprise'. Replace it with a foreign key to
-- plans(key) so any catalogue plan is a valid tier and the two stay in sync (renaming a
-- plan key cascades to the businesses on it).

alter table public.businesses
  drop constraint if exists businesses_subscription_tier_check;

alter table public.businesses
  drop constraint if exists businesses_subscription_tier_fkey;

alter table public.businesses
  add constraint businesses_subscription_tier_fkey
  foreign key (subscription_tier) references public.plans(key)
  on update cascade;
