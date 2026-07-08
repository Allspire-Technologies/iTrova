-- Extend the bell's sync_notifications with an Expenditure alert:
--   * expense_overdue — owners/managers: a Pending bill is past its due date.
-- Gated by a new notification preference `expense_alerts` (defaults on). Full CREATE OR REPLACE of
-- the function from 20260707130000 with the one new block (mirrors the invoice `overdue` pattern).
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
  want_store boolean;
  want_production boolean;
  want_expense boolean;
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

  select notification_prefs into prefs from public.profiles where id = uid;
  want_low := coalesce((prefs->>'low_stock_alerts')::boolean, true);
  want_overdue := coalesce((prefs->>'overdue_invoice_alerts')::boolean, true);
  want_expiry := coalesce((prefs->>'expiry_alerts')::boolean, true);
  want_store := coalesce((prefs->>'general_store_alerts')::boolean, true);
  want_production := coalesce((prefs->>'production_alerts')::boolean, true);
  want_expense := coalesce((prefs->>'expense_alerts')::boolean, true);

  -- Production — the requester's own decided requests (any role). Runs BEFORE the manager gate.
  if want_production then
    delete from public.notifications n
      where n.recipient_id = uid and n.type = 'production_decided'
        and not exists (
          select 1 from public.production_requisitions r
          where r.id = n.entity_id and r.business_id = biz and r.requested_by = uid
            and r.status in ('approved','rejected','completed')
            and r.approved_at >= now() - interval '14 days'
        );
    insert into public.notifications (business_id, recipient_id, type, title, body, entity_type, entity_id, link)
    select biz, uid, 'production_decided',
           case when r.status = 'rejected' then 'Materials request rejected' else 'Materials request approved' end,
           case when r.status = 'rejected'
                then coalesce('Reason: ' || r.decision_note, 'Ask a manager for details.')
                else 'Your materials have been issued.' end,
           'production_requisition', r.id, '/production?tab=requests'
    from public.production_requisitions r
    where r.business_id = biz and r.requested_by = uid
      and r.status in ('approved','rejected','completed')
      and r.approved_at >= now() - interval '14 days'
      and not exists (
        select 1 from public.notifications n
        where n.recipient_id = uid and n.entity_id = r.id and n.type = 'production_decided'
      );
  else
    delete from public.notifications where recipient_id = uid and type = 'production_decided';
  end if;

  if not is_mgr then
    delete from public.notifications
      where recipient_id = uid and type in ('low_stock','out_of_stock','overdue','expiring','plan_expiring','plan_expired','store_low_stock','store_out_of_stock','store_overdue','production_request','expense_overdue');
    return;
  end if;

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

  -- Expenditure — unpaid bills past their due date (owners/managers).
  if want_expense then
    delete from public.notifications n
      where n.recipient_id = uid and n.type = 'expense_overdue'
        and not exists (
          select 1 from public.expenses e
          where e.id = n.entity_id and e.business_id = biz
            and e.status = 'pending' and e.due_date is not null and e.due_date < today_local
        );
    insert into public.notifications (business_id, recipient_id, type, title, body, entity_type, entity_id, link)
    select biz, uid, 'expense_overdue',
           coalesce(nullif(e.payee, ''), e.category) || ' · ' || e.category,
           'Bill overdue since ' || to_char(e.due_date, 'DD Mon YYYY'),
           'expense', e.id, '/expenditure?status=pending'
    from public.expenses e
    where e.business_id = biz and e.status = 'pending'
      and e.due_date is not null and e.due_date < today_local
      and not exists (
        select 1 from public.notifications n
        where n.recipient_id = uid and n.entity_id = e.id and n.type = 'expense_overdue'
      );
  else
    delete from public.notifications where recipient_id = uid and type = 'expense_overdue';
  end if;

  -- General Store — low/out of stock items. One per item at/under its reorder level.
  if want_store then
    delete from public.notifications n
      where n.recipient_id = uid and n.type in ('store_low_stock','store_out_of_stock')
        and not exists (
          select 1 from public.store_items s
          where s.id = n.entity_id and s.business_id = biz
            and s.stock_quantity <= s.reorder_level
            and n.type = (case when s.stock_quantity <= 0 then 'store_out_of_stock' else 'store_low_stock' end)
        );
    insert into public.notifications (business_id, recipient_id, type, title, body, entity_type, entity_id, link)
    select biz, uid,
           case when s.stock_quantity <= 0 then 'store_out_of_stock' else 'store_low_stock' end,
           s.name,
           case when s.stock_quantity <= 0
                then 'Out of stock in the General Store'
                else 'Low stock — ' || s.stock_quantity || coalesce(' ' || s.unit, '')
                     || ' left (reorder at ' || s.reorder_level || ')' end,
           'store_item', s.id, '/general-store'
    from public.store_items s
    where s.business_id = biz and s.stock_quantity <= s.reorder_level
      and not exists (
        select 1 from public.notifications n
        where n.recipient_id = uid and n.entity_id = s.id
          and n.type = (case when s.stock_quantity <= 0 then 'store_out_of_stock' else 'store_low_stock' end)
      );

    -- General Store — overdue borrows (still out past the due date).
    delete from public.notifications n
      where n.recipient_id = uid and n.type = 'store_overdue'
        and not exists (
          select 1 from public.store_transactions t
          where t.id = n.entity_id and t.business_id = biz
            and t.kind = 'borrow' and t.status in ('out','partially_returned')
            and t.due_date is not null and t.due_date < today_local
        );
    insert into public.notifications (business_id, recipient_id, type, title, body, entity_type, entity_id, link)
    select biz, uid, 'store_overdue',
           coalesce(si.name, 'Item') || coalesce(' · ' || ss.name, ''),
           'Overdue since ' || to_char(t.due_date, 'DD Mon YYYY'),
           'store_transaction', t.id, '/general-store'
    from public.store_transactions t
    left join public.store_items si on si.id = t.item_id
    left join public.store_staff ss on ss.id = t.staff_id
    where t.business_id = biz and t.kind = 'borrow' and t.status in ('out','partially_returned')
      and t.due_date is not null and t.due_date < today_local
      and not exists (
        select 1 from public.notifications n
        where n.recipient_id = uid and n.entity_id = t.id and n.type = 'store_overdue'
      );
  else
    delete from public.notifications where recipient_id = uid and type in ('store_low_stock','store_out_of_stock','store_overdue');
  end if;

  -- Production — requisitions awaiting a decision (owners/managers).
  if want_production then
    delete from public.notifications n
      where n.recipient_id = uid and n.type = 'production_request'
        and not exists (
          select 1 from public.production_requisitions r
          where r.id = n.entity_id and r.business_id = biz and r.status = 'pending'
        );
    insert into public.notifications (business_id, recipient_id, type, title, body, entity_type, entity_id, link)
    select biz, uid, 'production_request',
           'Materials request · ' || coalesce(pr.owner_name, 'Team member'),
           (select count(*) from public.production_requisition_items i where i.requisition_id = r.id)
             || ' material(s) requested — awaiting approval',
           'production_requisition', r.id, '/production?tab=requests'
    from public.production_requisitions r
    left join public.profiles pr on pr.id = r.requested_by
    where r.business_id = biz and r.status = 'pending'
      and not exists (
        select 1 from public.notifications n
        where n.recipient_id = uid and n.entity_id = r.id and n.type = 'production_request'
      );
  else
    delete from public.notifications where recipient_id = uid and type = 'production_request';
  end if;

  -- Product expiry — owners/managers. One notification per product expiring within 30 days.
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

  -- Plan expiry — owners only.
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

notify pgrst, 'reload schema';
