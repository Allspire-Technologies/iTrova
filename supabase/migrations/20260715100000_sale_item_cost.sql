-- Accounting / Profit & Loss groundwork: capture each sold item's COST at sale time so historical
-- COGS (and therefore gross/net profit) is accurate going forward, independent of later cost changes.
-- sale_items.unit_cost = the product's cost_price at the moment of sale. Old rows stay NULL; the P&L
-- falls back to the product's current cost for those (a labelled estimate).

alter table public.sale_items add column if not exists unit_cost numeric;

-- Re-declare commit_offline_sale (last set in 20260709110000_tax_commit_sale) — the ONLY change is the
-- sale_items insert now also writes unit_cost from the product's current cost_price. commit_pos_sale
-- (20260706100000) is an unchanged thin wrapper that delegates here, so the online path captures it too.
-- Offline sales capture cost at commit time (when they sync), which is the best available basis.
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
  v_tax         numeric := coalesce((_sale->>'tax')::numeric, 0);
  v_item        record;
  v_name        text;
begin
  if v_business_id is null or v_business_id <> public.current_business_id() then
    raise exception 'not authorised for this business';
  end if;

  if exists (select 1 from public.sales where id = v_sale_id) then
    return jsonb_build_object('status', 'duplicate', 'sale_id', v_sale_id);
  end if;

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

  insert into public.sales (id, business_id, staff_id, total_amount, discount_amount, tax_amount, payment_method, created_at)
  values (v_sale_id, v_business_id, (_sale->>'staff_id')::uuid,
          (_sale->>'total')::numeric, (_sale->>'discount')::numeric, v_tax, _sale->>'payment_method', v_created_at);

  -- Snapshot each line's cost from the product at sale time (COGS source for the P&L).
  insert into public.sale_items (sale_id, product_id, quantity, unit_price, unit_cost)
  select v_sale_id, (e->>'product_id')::uuid, (e->>'quantity')::numeric, (e->>'unit_price')::numeric,
         coalesce(p.cost_price, 0)
  from jsonb_array_elements(_sale->'items') as e
  left join public.products p on p.id = (e->>'product_id')::uuid and p.business_id = v_business_id;

  insert into public.invoices (id, business_id, invoice_number, customer_name, customer_phone,
                               customer_email, notes, status, subtotal, discount_amount, tax, total,
                               sale_id, created_by, issue_date, created_at)
  values (v_invoice_id, v_business_id, _sale->>'invoice_number',
          coalesce(_sale->>'customer_name', 'Walk-in Customer'),
          nullif(_sale->>'customer_phone', ''), nullif(_sale->>'customer_email', ''),
          nullif(_sale->>'notes', ''), 'paid',
          (_sale->>'subtotal')::numeric, (_sale->>'discount')::numeric, v_tax, (_sale->>'total')::numeric,
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

notify pgrst, 'reload schema';
