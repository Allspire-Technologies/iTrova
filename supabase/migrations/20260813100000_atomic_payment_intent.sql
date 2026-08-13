-- Creating a payment intent must be atomic with reading the credit it claims.
-- APPLIES TO THE SHARED iTrova SUPABASE PROJECT (wnuyzsjhijhnhkpcnnqu).
--
-- 20260811100000 stops one balance being spent twice by HOLDING credit against pending intents.
-- That guards the second payment — but only once the first intent exists. create-payment read the
-- balance and inserted the intent as two separate statements, so two payments started at the same
-- moment both read the full balance, both sized their credit against it, and both inserted a hold:
-- the classic read-then-write race, and the floor at zero then hid the overdraw.
--
-- The read and the insert now happen inside ONE function, behind a lock on the business row —
-- the same discipline activate_subscription_with_credit already used. Concurrent starts serialise:
-- the second sees the first one's hold and sizes its credit against what's actually left.
--
-- Activation deliberately does NOT re-check the balance. Once a provider has confirmed money, the
-- plan must activate; refusing it would take the customer's cash and give them nothing. The lock
-- here is what makes that safe, because an intent can no longer over-claim in the first place.

create or replace function public.create_payment_intent(
  p_business_id  uuid,
  p_plan_key     text,
  p_cycle        text,
  p_method       text,
  p_provider     text,
  p_use_credit   boolean,
  p_our_reference text,
  p_actor        uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_price numeric; v_cur text; v_credit numeric := 0; v_applied numeric; v_due numeric;
begin
  if p_business_id is null or p_plan_key is null or p_cycle is null or p_our_reference is null then
    return jsonb_build_object('ok', false, 'error', 'business, plan, cycle and reference are required');
  end if;

  -- Serialises concurrent payment starts for this business. The balance is derived, so the row
  -- lock is what makes read-then-write safe.
  perform 1 from public.businesses where id = p_business_id for update;

  select amount, currency into v_price, v_cur
    from public.quote_subscription_price(p_business_id, p_plan_key, p_cycle);
  if coalesce(v_price, 0) <= 0 then
    return jsonb_build_object('ok', false, 'error', 'that plan has no payable price');
  end if;

  if coalesce(p_use_credit, false) then
    v_credit := public._referral_credit(p_business_id);
  end if;
  v_applied := least(v_credit, v_price);
  v_due     := v_price - v_applied;

  -- Fully covered: no intent, no provider. The caller routes to
  -- activate_subscription_with_credit, which re-checks price and balance under its own lock.
  if v_due <= 0 then
    return jsonb_build_object('ok', true, 'fully_covered', true,
                              'amount', v_price, 'credit_applied', v_applied, 'due', 0,
                              'currency', coalesce(v_cur, 'NGN'));
  end if;

  -- amount = the CASH the provider is asked for; credit_applied carries the rest of the price and
  -- holds that credit against further payments until this one completes or goes stale.
  insert into public.billing_payment
    (business_id, plan_key, cycle, amount, credit_applied, currency, method, provider,
     our_reference, created_by)
  values
    (p_business_id, p_plan_key, p_cycle, v_due, v_applied, coalesce(v_cur, 'NGN'),
     p_method, p_provider, p_our_reference, p_actor);

  return jsonb_build_object('ok', true, 'fully_covered', false,
                            'amount', v_price, 'credit_applied', v_applied, 'due', v_due,
                            'currency', coalesce(v_cur, 'NGN'));
end $$;
revoke all on function public.create_payment_intent(uuid, text, text, text, text, boolean, text, uuid)
  from public, anon, authenticated;
-- Only create-payment (service_role) may open an intent; nothing the browser reaches can size its
-- own credit. Granted explicitly rather than relying on default privileges (see 20260810120000).
grant execute on function public.create_payment_intent(uuid, text, text, text, text, boolean, text, uuid)
  to service_role;

notify pgrst, 'reload schema';
