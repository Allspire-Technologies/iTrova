-- Orders were left behind by three later financial pipelines. deliver_order_impl (last set in
-- 20260707120000_production_decouples_sales) creates the sale + paid invoice, but:
--   1. no sale_payments row      → order sales missing from the Payment-methods breakdown
--   2. no post_sale_journal call → order revenue never posts to the ledger (P&L / Cash Flow)
--   3. no unit_cost snapshot     → zero COGS for order sales in the ledger
-- Re-declared with all three; plus an idempotent backfill for existing order sales.

create or replace function public.deliver_order_impl(_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order       record;
  v_business_id uuid;
  v_subtotal    numeric := 0;
  v_discount    numeric := 0;
  v_total       numeric := 0;
  v_sale_id     uuid := gen_random_uuid();
  v_invoice_id  uuid := gen_random_uuid();
  v_number      text;
  v_item        record;
  v_name        text;
begin
  select * into v_order from public.orders where id = _order_id;
  if not found then raise exception 'order not found'; end if;
  v_business_id := v_order.business_id;

  -- authorise against the caller's business
  if v_business_id is null or v_business_id <> public.current_business_id() then
    raise exception 'not authorised for this business';
  end if;

  -- idempotency: already invoiced -> no-op success (handles double taps / lost acks)
  if v_order.invoice_id is not null then
    select invoice_number into v_number from public.invoices where id = v_order.invoice_id;
    return jsonb_build_object('status', 'duplicate', 'invoice_id', v_order.invoice_id, 'invoice_number', v_number);
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'cannot deliver a cancelled order';
  end if;

  -- totals from the order lines; discount clamped to [0, subtotal], net into total
  select coalesce(sum(quantity * unit_price), 0) into v_subtotal
    from public.order_items where order_id = _order_id;
  v_discount := least(greatest(coalesce(v_order.discount_amount, 0), 0), v_subtotal);
  v_total := v_subtotal - v_discount;

  -- if stock hasn't been taken yet (pending -> delivered directly), make sure it can be, so the
  -- unconditional deduct trigger fired by the UPDATE below can't drive stock negative.
  if not v_order.stock_deducted then
    for v_item in select product_id, quantity from public.order_items where order_id = _order_id loop
      perform 1 from public.products
        where id = v_item.product_id and business_id = v_business_id and stock_quantity >= v_item.quantity;
      if not found then
        select name into v_name from public.products where id = v_item.product_id;
        raise exception 'NEEDS_REVIEW:%', coalesce(v_name, 'an item') using errcode = 'check_violation';
      end if;
    end loop;
  end if;

  -- sale + items (revenue that flows into reports); unit_cost snapshots the product's cost at
  -- sale time so COGS is accurate even if the cost price changes later (same as POS sales).
  insert into public.sales (id, business_id, staff_id, total_amount, discount_amount, payment_method, created_at)
  values (v_sale_id, v_business_id, v_order.staff_id, v_total, v_discount, v_order.payment_method, now());

  insert into public.sale_items (sale_id, product_id, quantity, unit_price, unit_cost)
  select v_sale_id, oi.product_id, oi.quantity, oi.unit_price, p.cost_price
  from public.order_items oi
  left join public.products p on p.id = oi.product_id
  where oi.order_id = _order_id;

  -- one payment leg per sale (orders take a single method) — powers the payment-methods breakdown
  insert into public.sale_payments (business_id, sale_id, method, amount, created_at)
  values (v_business_id, v_sale_id, coalesce(v_order.payment_method, 'cash'), v_total, now());

  -- paid invoice + items (the shareable receipt)
  v_number := public.next_invoice_number(v_business_id);
  insert into public.invoices (id, business_id, invoice_number, customer_name, customer_phone, status,
                               subtotal, discount_amount, total, amount_paid, sale_id, created_by,
                               issue_date, created_at)
  values (v_invoice_id, v_business_id, v_number, v_order.customer_name, v_order.customer_phone, 'paid',
          v_subtotal, v_discount, v_total, v_total, v_sale_id, v_order.staff_id, current_date, now());

  insert into public.invoice_items (invoice_id, description, quantity, unit_price, line_total)
  select v_invoice_id, coalesce(p.name, 'Item'), oi.quantity, oi.unit_price, oi.quantity * oi.unit_price
  from public.order_items oi
  left join public.products p on p.id = oi.product_id
  where oi.order_id = _order_id;

  -- mark delivered + link the invoice; the orders triggers take care of stock from here
  update public.orders set status = 'delivered', invoice_id = v_invoice_id where id = _order_id;

  -- post to the ledger (Dr Cash|Bank / Cr Sales + COGS pair) — exception-safe so a ledger
  -- problem can never fail a delivery, exactly like commit_offline_sale.
  begin
    perform public.post_sale_journal(v_business_id, v_sale_id);
  exception when others then null;
  end;

  return jsonb_build_object('status', 'committed', 'invoice_id', v_invoice_id,
                            'sale_id', v_sale_id, 'invoice_number', v_number);
end;
$$;
revoke all on function public.deliver_order_impl(uuid) from public, anon, authenticated;

-- ============================================================ backfill existing order sales
-- 1) Payment legs for sales created after the 20260724 split-payments backfill (idempotent).
insert into public.sale_payments (business_id, sale_id, method, amount, created_at)
select s.business_id, s.id, coalesce(s.payment_method, 'cash'), s.total_amount, s.created_at
from public.sales s
where not exists (select 1 from public.sale_payments sp where sp.sale_id = s.id);

-- 2) Ledger entries for un-posted, non-voided sales on businesses that keep books.
--    post_sale_journal is idempotent (source_id guard) and no-ops without a chart.
do $$
declare r record;
begin
  for r in
    select s.id, s.business_id
    from public.sales s
    where s.voided = false
      and exists (select 1 from public.accounts a where a.business_id = s.business_id)
      and not exists (select 1 from public.journal_entries j
                      where j.business_id = s.business_id and j.source = 'sale' and j.source_id = s.id)
  loop
    begin
      perform public.post_sale_journal(r.business_id, r.id);
    exception when others then null;
    end;
  end loop;
end $$;

notify pgrst, 'reload schema';
