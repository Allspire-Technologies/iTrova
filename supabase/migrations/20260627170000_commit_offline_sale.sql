-- Idempotent, transactional commit for offline POS sales. APPLIED TO THE iTrova PROJECT.
--
-- When the POS is offline, sales are queued on the device (client-generated UUIDs + a collision-proof
-- fallback invoice number). On reconnect the client replays each via this one RPC, which does the
-- whole thing atomically:
--   * idempotent on the client sale id (re-sending a sale that already committed is a no-op — handles
--     "RPC ran but the ack was lost" without double-charging or double-deducting stock),
--   * validates + deducts stock; if it can't be satisfied it raises NEEDS_REVIEW:<product> so the
--     client moves that sale to a review queue instead of committing it,
--   * inserts sales + sale_items + invoice + invoice_items, stamping the offline created_at.
-- The whole function is one transaction: any raise rolls back stock and every insert.

create or replace function public.commit_offline_sale(_sale jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_id uuid := (_sale->>'business_id')::uuid;
  v_sale_id     uuid := (_sale->>'sale_id')::uuid;
  v_invoice_id  uuid := (_sale->>'invoice_id')::uuid;
  v_created_at  timestamptz := coalesce((_sale->>'created_at')::timestamptz, now());
  v_item        record;
  v_name        text;
begin
  -- 1. Authorise against the caller's business (same gate as deduct_sale_stock / next_invoice_number).
  if v_business_id is null or v_business_id <> public.current_business_id() then
    raise exception 'not authorised for this business';
  end if;

  -- 2. Idempotency: this client sale id already committed -> no-op success.
  if exists (select 1 from public.sales where id = v_sale_id) then
    return jsonb_build_object('status', 'duplicate', 'sale_id', v_sale_id);
  end if;

  -- 3. Validate + deduct stock. Distinct error so the client can route to its review queue.
  for v_item in
    select (e->>'product_id')::uuid as product_id, (e->>'quantity')::numeric as qty
    from jsonb_array_elements(_sale->'items') as e
  loop
    if v_item.qty is null or v_item.qty <= 0 then continue; end if;
    update public.products
       set stock_quantity = stock_quantity - v_item.qty
     where id = v_item.product_id and business_id = v_business_id and stock_quantity >= v_item.qty;
    if not found then
      select name into v_name from public.products where id = v_item.product_id;
      raise exception 'NEEDS_REVIEW:%', coalesce(v_name, 'an item') using errcode = 'check_violation';
    end if;
  end loop;

  -- 4. Sale + items (client UUID + offline timestamp).
  insert into public.sales (id, business_id, staff_id, total_amount, discount_amount, payment_method, created_at)
  values (v_sale_id, v_business_id, (_sale->>'staff_id')::uuid,
          (_sale->>'total')::numeric, (_sale->>'discount')::numeric, _sale->>'payment_method', v_created_at);

  insert into public.sale_items (sale_id, product_id, quantity, unit_price)
  select v_sale_id, (e->>'product_id')::uuid, (e->>'quantity')::numeric, (e->>'unit_price')::numeric
  from jsonb_array_elements(_sale->'items') as e;

  -- 5. Paid invoice + items (keep the offline fallback number — never renumber).
  insert into public.invoices (id, business_id, invoice_number, customer_name, status, subtotal,
                               discount_amount, total, sale_id, created_by, issue_date, created_at)
  values (v_invoice_id, v_business_id, _sale->>'invoice_number',
          coalesce(_sale->>'customer_name', 'Walk-in Customer'), 'paid',
          (_sale->>'subtotal')::numeric, (_sale->>'discount')::numeric, (_sale->>'total')::numeric,
          v_sale_id, (_sale->>'staff_id')::uuid, (v_created_at)::date, v_created_at);

  insert into public.invoice_items (invoice_id, description, quantity, unit_price, line_total)
  select v_invoice_id, e->>'name', (e->>'quantity')::numeric, (e->>'unit_price')::numeric,
         (e->>'quantity')::numeric * (e->>'unit_price')::numeric
  from jsonb_array_elements(_sale->'items') as e;

  return jsonb_build_object('status', 'committed', 'sale_id', v_sale_id, 'invoice_number', _sale->>'invoice_number');
end;
$$;

revoke all on function public.commit_offline_sale(jsonb) from public, anon;
grant execute on function public.commit_offline_sale(jsonb) to authenticated;
