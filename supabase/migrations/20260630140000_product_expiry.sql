-- Optional product expiry date + bell notifications for products nearing/past expiry.
-- The Inventory list badges from 90 days out (client-side); the bell notifies owners/managers
-- from 30 days out (and once expired), gated by a new "expiry_alerts" notification preference.

alter table public.products
  add column if not exists expiry_date date;

create or replace function public.sync_notifications()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
  biz uuid := public.current_business_id();
  is_mgr boolean;
  is_owner boolean;
  prefs jsonb;
  want_low boolean;
  want_overdue boolean;
  want_expiry boolean;
  biz_tz text;
  today_local date;
  renews timestamptz;
  tier text;
  applicable text;
begin
  if uid is null or biz is null then return; end if;

  select coalesce(timezone, 'Africa/Lagos') into biz_tz from public.businesses where id = biz;
  today_local := (now() at time zone biz_tz)::date;

  select exists (
    select 1 from public.user_roles
    where user_id = uid and business_id = biz and role in ('owner','manager')
  ) into is_mgr;

  if not is_mgr then
    delete from public.notifications
      where recipient_id = uid and type in ('low_stock','out_of_stock','overdue','expiring','plan_expiring','plan_expired');
    return;
  end if;

  select notification_prefs into prefs from public.profiles where id = uid;
  want_low := coalesce((prefs->>'low_stock_alerts')::boolean, true);
  want_overdue := coalesce((prefs->>'overdue_invoice_alerts')::boolean, true);
  want_expiry := coalesce((prefs->>'expiry_alerts')::boolean, true);

  if want_low then
    delete from public.notifications n
      where n.recipient_id = uid and n.type in ('low_stock','out_of_stock')
        and not exists (
          select 1 from public.products p
          where p.id = n.entity_id and p.business_id = biz
            and p.stock_quantity <= p.reorder_level
            and n.type = (case when p.stock_quantity <= 0 then 'out_of_stock' else 'low_stock' end)
        );
    insert into public.notifications (business_id, recipient_id, type, title, body, entity_type, entity_id, link)
    select biz, uid,
           case when p.stock_quantity <= 0 then 'out_of_stock' else 'low_stock' end,
           p.name,
           case when p.stock_quantity <= 0
                then 'Out of stock — restock needed'
                else 'Low stock — ' || p.stock_quantity || coalesce(' ' || p.unit, '')
                     || ' left (reorder at ' || p.reorder_level || ')' end,
           'product', p.id, '/inventory'
    from public.products p
    where p.business_id = biz and p.stock_quantity <= p.reorder_level
      and not exists (
        select 1 from public.notifications n
        where n.recipient_id = uid and n.entity_id = p.id
          and n.type = (case when p.stock_quantity <= 0 then 'out_of_stock' else 'low_stock' end)
      );
  else
    delete from public.notifications where recipient_id = uid and type in ('low_stock','out_of_stock');
  end if;

  if want_overdue then
    delete from public.notifications n
      where n.recipient_id = uid and n.type = 'overdue'
        and not exists (
          select 1 from public.invoices i
          where i.id = n.entity_id and i.business_id = biz
            and i.status = 'issued' and i.due_date is not null and i.due_date < today_local
        );
    insert into public.notifications (business_id, recipient_id, type, title, body, entity_type, entity_id, link)
    select biz, uid, 'overdue',
           i.invoice_number || ' · ' || i.customer_name,
           'Overdue since ' || to_char(i.due_date, 'DD Mon YYYY'),
           'invoice', i.id, '/invoices?q=' || i.invoice_number
    from public.invoices i
    where i.business_id = biz and i.status = 'issued'
      and i.due_date is not null and i.due_date < today_local
      and not exists (
        select 1 from public.notifications n
        where n.recipient_id = uid and n.entity_id = i.id and n.type = 'overdue'
      );
  else
    delete from public.notifications where recipient_id = uid and type = 'overdue';
  end if;

  -- Product expiry — owners/managers. One notification per product expiring within 30 days
  -- (or already expired). Body uses the date so it doesn't go stale as the day count changes.
  if want_expiry then
    delete from public.notifications n
      where n.recipient_id = uid and n.type = 'expiring'
        and not exists (
          select 1 from public.products p
          where p.id = n.entity_id and p.business_id = biz
            and p.expiry_date is not null and p.expiry_date <= today_local + 30
        );
    insert into public.notifications (business_id, recipient_id, type, title, body, entity_type, entity_id, link)
    select biz, uid, 'expiring',
           p.name,
           case when p.expiry_date < today_local
                then 'Expired on ' || to_char(p.expiry_date, 'DD Mon YYYY')
                else 'Expires on ' || to_char(p.expiry_date, 'DD Mon YYYY') end,
           'product', p.id, '/inventory'
    from public.products p
    where p.business_id = biz and p.expiry_date is not null and p.expiry_date <= today_local + 30
      and not exists (
        select 1 from public.notifications n
        where n.recipient_id = uid and n.entity_id = p.id and n.type = 'expiring'
      );
  else
    delete from public.notifications where recipient_id = uid and type = 'expiring';
  end if;

  -- Plan expiry — owners only. One notification per business, switching between
  -- expiring (within 7 days) and expired as the renewal date passes.
  select exists (
    select 1 from public.user_roles where user_id = uid and business_id = biz and role = 'owner'
  ) into is_owner;
  select subscription_renews_at, subscription_tier into renews, tier from public.businesses where id = biz;

  applicable := case
    when not is_owner or renews is null or coalesce(tier, 'free') = 'free' then null
    when renews <= now() then 'plan_expired'
    when renews <= now() + interval '7 days' then 'plan_expiring'
    else null
  end;

  delete from public.notifications
    where recipient_id = uid and entity_id = biz
      and type in ('plan_expiring','plan_expired')
      and type is distinct from applicable;

  if applicable = 'plan_expired' then
    insert into public.notifications (business_id, recipient_id, type, title, body, entity_type, entity_id, link)
    select biz, uid, 'plan_expired', 'Subscription expired',
           'Your plan expired on ' || to_char(renews at time zone biz_tz, 'DD Mon YYYY') || ' — now on Free.',
           'plan', biz, '/settings'
    where not exists (
      select 1 from public.notifications n where n.recipient_id = uid and n.entity_id = biz and n.type = 'plan_expired'
    );
  elsif applicable = 'plan_expiring' then
    insert into public.notifications (business_id, recipient_id, type, title, body, entity_type, entity_id, link)
    select biz, uid, 'plan_expiring', 'Plan expiring soon',
           'Your plan expires on ' || to_char(renews at time zone biz_tz, 'DD Mon YYYY') || '.',
           'plan', biz, '/settings'
    where not exists (
      select 1 from public.notifications n where n.recipient_id = uid and n.entity_id = biz and n.type = 'plan_expiring'
    );
  end if;
end;
$$;
