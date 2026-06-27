-- Atomic, oversell-proof stock deduction for POS sales.
--
-- The POS used to deduct stock client-side: it read each product's stock into the
-- cart, then wrote back (snapshot_stock - qty). That snapshot goes stale the moment
-- anything else sells the product — most visibly when a cart is held, the same item
-- is sold on another sale, then the held cart is resumed and checked out: it happily
-- "sold" stock that was already gone, driving quantities negative.
--
-- This function decrements relative to the LIVE value and refuses to go below zero.
-- It runs as a single transaction, so if any line lacks stock it raises and every
-- decrement in the call rolls back — the sale is rejected as a whole, never partially.
create or replace function public.deduct_sale_stock(_business_id uuid, _items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
  v_name text;
begin
  if _business_id is null or _business_id <> public.current_business_id() then
    raise exception 'not authorised for this business';
  end if;

  for v_item in
    select (e->>'product_id')::uuid as product_id,
           (e->>'qty')::numeric     as qty
    from jsonb_array_elements(_items) as e
  loop
    if v_item.qty is null or v_item.qty <= 0 then
      continue;
    end if;

    update public.products
       set stock_quantity = stock_quantity - v_item.qty
     where id = v_item.product_id
       and business_id = _business_id
       and stock_quantity >= v_item.qty;

    if not found then
      select name into v_name from public.products where id = v_item.product_id;
      raise exception 'INSUFFICIENT_STOCK:%', coalesce(v_name, 'this product')
        using errcode = 'check_violation';
    end if;
  end loop;
end;
$$;

-- Reverse a prior deduct_sale_stock, used to compensate if the sale write fails after
-- stock was already taken. Increments are always safe, so this never refuses.
create or replace function public.restock_sale_stock(_business_id uuid, _items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
begin
  if _business_id is null or _business_id <> public.current_business_id() then
    raise exception 'not authorised for this business';
  end if;

  for v_item in
    select (e->>'product_id')::uuid as product_id,
           (e->>'qty')::numeric     as qty
    from jsonb_array_elements(_items) as e
  loop
    if v_item.qty is null or v_item.qty <= 0 then
      continue;
    end if;
    update public.products
       set stock_quantity = stock_quantity + v_item.qty
     where id = v_item.product_id and business_id = _business_id;
  end loop;
end;
$$;

revoke execute on function public.deduct_sale_stock(uuid, jsonb) from public, anon;
revoke execute on function public.restock_sale_stock(uuid, jsonb) from public, anon;
grant execute on function public.deduct_sale_stock(uuid, jsonb) to authenticated;
grant execute on function public.restock_sale_stock(uuid, jsonb) to authenticated;
