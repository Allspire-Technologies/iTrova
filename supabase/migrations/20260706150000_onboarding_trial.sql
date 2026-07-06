-- Onboarding plan picker + 7-day trials.
--
-- New owners now pick the modules they need and their expected scale during onboarding; the app
-- recommends the cheapest catalogue plan covering that selection and can start a one-off 7-day
-- trial of it. This migration adds:
--   1. businesses.onboarding_profile — the raw selection (modules + scale bands), stored for
--      sales follow-up/analytics. Informational only; nothing gates on it.
--   2. businesses.trial_plan / trial_started_at — which plan was trialed and when. A non-null
--      trial_started_at means the business has used its one trial, ever.
--   3. start_plan_trial(_plan_key) — owner-only RPC that puts the business on the plan with
--      subscription_renews_at = now() + 7 days. subscription_cycle stays NULL, which the
--      set_subscription_renews_at trigger treats as "manual override" and leaves the date alone
--      (20260625120000). When the date passes, effectiveTier() already falls back to Free
--      client-side — no new expiry machinery.

alter table public.businesses
  add column if not exists onboarding_profile jsonb,
  add column if not exists trial_plan text,
  add column if not exists trial_started_at timestamptz;

create or replace function public.start_plan_trial(_plan_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_id uuid := public.current_business_id();
  v_now timestamptz := now();
  v_renews timestamptz := now() + interval '7 days';
  v_plan record;
  v_biz record;
begin
  if v_business_id is null then
    raise exception 'not authorised for this business';
  end if;
  if not public.has_business_role(v_business_id, auth.uid(), 'owner') then
    raise exception 'TRIAL_DENIED: only the business owner can start a trial';
  end if;

  select key into v_plan from public.plans
   where key = _plan_key and is_active = true and business_id is null and key <> 'free';
  if not found then
    raise exception 'TRIAL_DENIED: unknown or ineligible plan';
  end if;

  select subscription_tier, subscription_renews_at, trial_started_at into v_biz
    from public.businesses where id = v_business_id;
  if v_biz.trial_started_at is not null then
    raise exception 'TRIAL_DENIED: this business has already used its trial';
  end if;
  -- A live paid subscription (unexpired renewal on a non-free tier) must not be replaced by a trial.
  if coalesce(v_biz.subscription_tier, 'free') <> 'free'
     and (v_biz.subscription_renews_at is null or v_biz.subscription_renews_at > v_now) then
    raise exception 'TRIAL_DENIED: business already has an active paid plan';
  end if;

  update public.businesses
     set subscription_tier = _plan_key,
         subscription_started_at = v_now,
         subscription_cycle = null,          -- trigger leaves renews_at alone when cycle is null
         subscription_renews_at = v_renews,
         trial_plan = _plan_key,
         trial_started_at = v_now
   where id = v_business_id;

  return jsonb_build_object('status', 'started', 'plan', _plan_key, 'ends_at', v_renews);
end;
$$;

revoke all on function public.start_plan_trial(text) from public, anon;
grant execute on function public.start_plan_trial(text) to authenticated;
