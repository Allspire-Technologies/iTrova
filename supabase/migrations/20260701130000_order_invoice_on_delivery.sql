-- Delivering an order now books revenue: it creates a paid invoice (backed by a sale) so the
-- order shows up in Reports/Dashboard and the customer can get a receipt. Stock is NOT touched
-- here — the existing order triggers (deduct_stock_on_ship / restock_on_order_cancel) still own
-- stock. The order links to its invoice via orders.invoice_id, which also makes delivery
-- idempotent (a second call is a no-op).

alter table public.orders
  add column if not exists invoice_id uuid references public.invoices(id) on delete set null;

create or replace function public.deliver_order(_order_id uuid)
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

  -- sale + items (revenue that flows into reports)
  insert into public.sales (id, business_id, staff_id, total_amount, discount_amount, payment_method, created_at)
  values (v_sale_id, v_business_id, v_order.staff_id, v_total, v_discount, v_order.payment_method, now());

  insert into public.sale_items (sale_id, product_id, quantity, unit_price)
  select v_sale_id, product_id, quantity, unit_price from public.order_items where order_id = _order_id;

  -- The sale_items insert fires deduct_raw_on_sale_item, which deducts raw materials (BOM). But the
  -- order lifecycle (deduct_stock_on_ship) already owns raw-material AND product stock for this
  -- order, so undo exactly that one raw-material deduction to avoid double-counting. Products are
  -- untouched by the sale path, so nothing to undo there.
  update public.raw_materials rm
    set stock_quantity = rm.stock_quantity + (pm.quantity_per_unit * oi.quantity)
  from public.order_items oi
  join public.product_materials pm on pm.product_id = oi.product_id
  where oi.order_id = _order_id and pm.raw_material_id = rm.id;

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

  return jsonb_build_object('status', 'committed', 'invoice_id', v_invoice_id,
                            'sale_id', v_sale_id, 'invoice_number', v_number);
end;
$$;

revoke all on function public.deliver_order(uuid) from public, anon;
grant execute on function public.deliver_order(uuid) to authenticated;
