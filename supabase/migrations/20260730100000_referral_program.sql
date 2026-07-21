-- Referral program MVP (strategy: docs/knowledge/iTrova-referral-program.md).
-- Attribution at signup + a business's own shareable code + program config. Rewards are computed
-- in the CRM and applied manually (admins extend subscription_renews_at / pay transfers) — this
-- migration adds NO billing machinery.
--
--   businesses.referred_by_code  — who referred THIS business (free text at signup, upper-cased;
--                                  no FK: codes may be registered in the CRM after the signup lands)
--   businesses.referral_code     — this business's OWN code (null until generated from the
--                                  Refer & earn card; NAMESLUG + last 4 digits of their phone)
--   referral_config              — single-row program numbers (CRM-admin editable, nothing hardcoded)

alter table public.businesses add column if not exists referred_by_code text;
alter table public.businesses add column if not exists referral_code text unique;

-- ---------------------------------------------------------------- program config (single row)
create table if not exists public.referral_config (
  id                       boolean primary key default true check (id), -- single-row guard
  affiliate_share_percent           numeric not null default 25,
  referee_discount_percent          numeric not null default 20,
  business_free_months              int     not null default 1,  -- free months granted per threshold
  business_referrals_per_free_month int     not null default 3,  -- converted referrals needed per grant
  staff_bonus                       jsonb   not null default '{"pro": 2000, "business": 5000, "enterprise": 10000}'::jsonb,
  updated_at               timestamptz not null default now()
);
insert into public.referral_config (id) values (true) on conflict (id) do nothing;
-- Idempotent: adds the column when re-applying over an already-created table (create-table above
-- is a no-op then), so this file can be re-run to pick up later additions.
alter table public.referral_config add column if not exists business_referrals_per_free_month int not null default 3;

alter table public.referral_config enable row level security;
revoke all on public.referral_config from anon;
-- UPDATE is granted at the table level so the admin RLS policy below can take effect — the policy
-- restricts WHO updates (CRM admins); without the privilege even they get "permission denied".
grant select, update on public.referral_config to authenticated;
grant select, update on public.referral_config to service_role;

-- Any signed-in user may read the program numbers (the app shows the referee discount);
-- only CRM admins may change them (cs_my_role() ships with the CRM on this shared project).
drop policy if exists "referral config readable" on public.referral_config;
create policy "referral config readable" on public.referral_config
  for select to authenticated using (true);
-- cs_my_role() is installed by the CRM's migrations on this shared project; guard so this file
-- also applies cleanly on an environment without the CRM (config then stays service-role-only).
do $$
begin
  if to_regproc('public.cs_my_role') is not null then
    drop policy if exists "referral config admin write" on public.referral_config;
    execute 'create policy "referral config admin write" on public.referral_config
      for update to authenticated
      using (public.cs_my_role() = ''admin'') with check (public.cs_my_role() = ''admin'')';
  end if;
end $$;

-- ---------------------------------------------------------------- attribution at signup
-- Re-declare handle_new_user (last set in 20260701150000_business_location_and_other_industry —
-- copied verbatim) with ONE addition: businesses.referred_by_code from the signup metadata.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  new_business_id uuid;
begin
  if new.raw_user_meta_data->>'invite_token' is not null then
    insert into public.profiles (id, owner_name, phone)
    values (
      new.id,
      coalesce(new.raw_user_meta_data->>'full_name', 'Staff'),
      new.raw_user_meta_data->>'phone'
    );
    return new;
  end if;

  insert into public.businesses (name, owner_id, industry, industry_other, city, state, referred_by_code)
  values (
    coalesce(new.raw_user_meta_data->>'business_name', 'My Business'),
    new.id,
    nullif(new.raw_user_meta_data->>'industry', ''),
    nullif(new.raw_user_meta_data->>'industry_other', ''),
    nullif(new.raw_user_meta_data->>'city', ''),
    nullif(new.raw_user_meta_data->>'state', ''),
    nullif(upper(trim(new.raw_user_meta_data->>'referral_code')), '')
  )
  returning id into new_business_id;

  insert into public.profiles (id, owner_name, phone, business_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'owner_name', 'Owner'),
    new.raw_user_meta_data->>'phone',
    new_business_id
  );

  insert into public.user_roles (user_id, business_id, role)
  values (new.id, new_business_id, 'owner')
  on conflict do nothing;

  return new;
end;
$$;

-- ---------------------------------------------------------------- own-code generation
-- Owner-only; idempotent (returns the existing code on later calls). Code = business-name slug
-- (A-Z/0-9, max 10 chars) + last 4 digits of the business's phone (whatsapp_number, falling back
-- to the owner profile's phone). A numeric suffix only on residual collision / missing phone.
create or replace function public.ensure_referral_code()
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_biz     uuid := public.current_business_id();
  v_code    text;
  v_name    text;
  v_phone   text;
  v_slug    text;
  v_last4   text;
  v_try     text;
  v_n       int := 0;
begin
  if v_biz is null then raise exception 'no business'; end if;
  if not public.has_business_role(v_biz, auth.uid(), 'owner') then
    raise exception 'PERMISSION_DENIED: only the owner can create the referral code';
  end if;

  select referral_code, name, whatsapp_number into v_code, v_name, v_phone
    from public.businesses where id = v_biz;
  if v_code is not null then return v_code; end if;

  if v_phone is null or v_phone = '' then
    select phone into v_phone from public.profiles where id = auth.uid();
  end if;

  v_slug  := left(regexp_replace(upper(coalesce(v_name, 'ITROVA')), '[^A-Z0-9]', '', 'g'), 10);
  if v_slug = '' then v_slug := 'ITROVA'; end if;
  v_last4 := right(regexp_replace(coalesce(v_phone, ''), '[^0-9]', '', 'g'), 4);
  v_try   := v_slug || v_last4;

  loop
    begin
      update public.businesses set referral_code = v_try where id = v_biz;
      return v_try;
    exception when unique_violation then
      v_n := v_n + 1;
      v_try := v_slug || v_last4 || lpad((floor(random() * 100))::int::text, 2, '0');
      if v_n > 20 then raise; end if;
    end;
  end loop;
end;
$$;
revoke all on function public.ensure_referral_code() from public, anon;
grant execute on function public.ensure_referral_code() to authenticated;

-- ---------------------------------------------------------------- referrer's own stats
-- How many businesses signed up with THIS business's referral code, and how many have converted to
-- a paid plan. Security definer so a referrer can see their count without read access to other
-- businesses' rows (RLS would otherwise hide them). Scoped to the caller's business.
create or replace function public.my_referral_stats()
returns table (referred_count int, converted_count int)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_biz  uuid := public.current_business_id();
  v_code text;
begin
  if v_biz is null then return; end if;
  select referral_code into v_code from public.businesses where id = v_biz;
  if v_code is null then
    return query select 0, 0; return;
  end if;
  return query
  select count(*)::int,
         count(*) filter (
           where coalesce(b.subscription_tier, 'free') <> 'free'
              or b.subscription_renews_at is not null
         )::int
  from public.businesses b
  where upper(b.referred_by_code) = upper(v_code);
end;
$$;
revoke all on function public.my_referral_stats() from public, anon;
grant execute on function public.my_referral_stats() to authenticated;

notify pgrst, 'reload schema';
