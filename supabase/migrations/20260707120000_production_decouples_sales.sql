-- Production owns raw-material consumption now — remove the sale-path BOM coupling.
--
-- Since the scaffold, a trigger deducted raw materials (per product_materials recipes) on every
-- sale_items insert, and every sale/order reversal path compensated by re-adding them. But
-- product_materials NEVER had a UI, so no business has recipes and every one of these statements
-- has been a provable no-op over an empty table. With the Production module, materials are
-- consumed when a requisition is approved / a run is recorded — keeping the sale-time deduction
-- would double-deduct the moment someone creates a recipe. This migration removes ALL SIX sites
-- together (leaving any one would create phantom raw-stock movement):
--   1. the sale_items trigger + its helpers,
--   2. deduct_stock_on_ship        (order fulfil: BOM deduction removed),
--   3. restock_on_order_cancel     (order un-fulfil: BOM re-add removed),
--   4. reverse_sale_on_void        (invoice void: BOM re-add removed; delete_invoice reverses
--                                   through this trigger, so it's covered too),
--   5. deliver_order_impl          (its compensating BOM re-add existed only to undo the trigger
--                                   in (1) — kept alone it would INFLATE raw stock every delivery),
--   6. delete_order_impl           (shipped-never-invoiced branch: BOM re-add removed).
-- Product stock logic is byte-identical everywhere. The _impl names come from the 20260704150000
-- rename; their permission wrappers are untouched.

-- ============================================================ 1. sale-time trigger + helpers
drop trigger if exists sale_items_deduct_raw on public.sale_items;
drop function if exists public.deduct_raw_on_sale_item();
drop function if exists public.deduct_raw_materials_for_product(uuid, numeric);

-- ============================================================ 2. deduct_stock_on_ship
CREATE OR REPLACE FUNCTION public.deduct_stock_on_ship()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE item RECORD;
BEGIN
  IF NEW.status IN ('shipped', 'delivered') AND NEW.stock_deducted = false THEN
    FOR item IN SELECT product_id, quantity FROM public.order_items WHERE order_id = NEW.id LOOP
      UPDATE public.products SET stock_quantity = stock_quantity - item.quantity WHERE id = item.product_id;
    END LOOP;
    NEW.stock_deducted := true;
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================ 3. restock_on_order_cancel
CREATE OR REPLACE FUNCTION public.restock_on_order_cancel()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE item RECORD;
BEGIN
  IF NEW.status IN ('pending', 'cancelled') AND COALESCE(OLD.stock_deducted, false) = true THEN
    FOR item IN SELECT product_id, quantity FROM public.order_items WHERE order_id = NEW.id LOOP
      UPDATE public.products
        SET stock_quantity = stock_quantity + item.quantity
        WHERE id = item.product_id;
    END LOOP;
    NEW.stock_deducted := false;
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================ 4. reverse_sale_on_void
CREATE OR REPLACE FUNCTION public.reverse_sale_on_void()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE item RECORD;
BEGIN
  IF NEW.status = 'void' AND COALESCE(OLD.status, '') <> 'void' AND NEW.sale_id IS NOT NULL THEN
    FOR item IN SELECT product_id, quantity FROM public.sale_items WHERE sale_id = NEW.sale_id LOOP
      UPDATE public.products
        SET stock_quantity = stock_quantity + item.quantity
        WHERE id = item.product_id;
    END LOOP;
    UPDATE public.sales SET voided = true WHERE id = NEW.sale_id;
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================ 5. deliver_order_impl
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

  -- sale + items (revenue that flows into reports)
  insert into public.sales (id, business_id, staff_id, total_amount, discount_amount, payment_method, created_at)
  values (v_sale_id, v_business_id, v_order.staff_id, v_total, v_discount, v_order.payment_method, now());

  insert into public.sale_items (sale_id, product_id, quantity, unit_price)
  select v_sale_id, product_id, quantity, unit_price from public.order_items where order_id = _order_id;

  -- (The old compensating raw-material re-add is gone: sale_items no longer deducts BOM
  --  materials, so there is nothing to undo here.)

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
revoke all on function public.deliver_order_impl(uuid) from public, anon, authenticated;

-- ============================================================ 6. delete_order_impl
create or replace function public.delete_order_impl(_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_item  record;
begin
  select * into v_order from public.orders where id = _order_id;
  if not found then raise exception 'order not found'; end if;
  if v_order.business_id is null or v_order.business_id <> public.current_business_id() then
    raise exception 'not authorised for this business';
  end if;

  if v_order.invoice_id is not null then
    -- Delivered: reverse + remove the sale/invoice. delete_invoice restocks per sale_items, which
    -- equals this order's order_items, so the order's deducted stock is returned exactly once.
    perform public.delete_invoice(v_order.invoice_id);
  elsif v_order.stock_deducted then
    -- Shipped, never invoiced: return the products this order took out.
    for v_item in select product_id, quantity from public.order_items where order_id = _order_id loop
      update public.products
        set stock_quantity = stock_quantity + v_item.quantity
        where id = v_item.product_id;
    end loop;
  end if;

  delete from public.orders where id = _order_id; -- order_items cascade
end;
$$;
revoke all on function public.delete_order_impl(uuid) from public, anon, authenticated;
