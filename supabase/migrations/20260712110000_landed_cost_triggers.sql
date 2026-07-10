-- Landed cost — value stock at the true landed unit cost (LAST COST). Two trigger re-declares:
--   1. add_stock_on_purchase: every material delivery now sets cost_per_unit to
--        (total_cost + landed_total) / quantity  — so plain and landed purchases both flow to cost.
--   2. receive_purchase_order: sum the PO's landed_costs, allocate BY VALUE across lines, pass each
--        line's share into the material_purchases it creates (raw materials) or straight into
--        products.cost_price (products).

-- 1) Material delivery → stock + last-cost valuation (incl. any landed cost on the delivery).
create or replace function public.add_stock_on_purchase()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.raw_materials
     set stock_quantity = stock_quantity + new.quantity,
         cost_per_unit = case when new.quantity > 0
                              then (coalesce(new.total_cost, 0) + coalesce(new.landed_total, 0)) / new.quantity
                              else cost_per_unit end
   where id = new.raw_material_id;
  return new;
end;
$$;

-- 2) PO received → allocate landed cost by value; value raw-material + product stock accordingly.
create or replace function public.receive_purchase_order()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  item          record;
  v_total_landed numeric;
  v_total_value  numeric;
  v_count        integer;
  v_allocated    numeric;
begin
  if new.status = 'received' and coalesce(old.status, '') <> 'received' then
    select coalesce(sum((e->>'amount')::numeric), 0) into v_total_landed
      from jsonb_array_elements(coalesce(new.landed_costs, '[]'::jsonb)) e;
    select coalesce(sum(line_total), 0), count(*) into v_total_value, v_count
      from public.purchase_order_items where purchase_order_id = new.id;

    for item in select * from public.purchase_order_items where purchase_order_id = new.id loop
      -- This line's share of the landed cost, allocated by value (equal split if there's no value).
      if v_total_landed <= 0 then
        v_allocated := 0;
      elsif v_total_value > 0 then
        v_allocated := item.line_total / v_total_value * v_total_landed;
      else
        v_allocated := v_total_landed / greatest(v_count, 1);
      end if;

      if item.raw_material_id is not null then
        -- add_stock_on_purchase values cost_per_unit from (total_cost + landed_total) / quantity.
        insert into public.material_purchases (business_id, raw_material_id, supplier_id, quantity, unit_cost, total_cost, landed_total, notes)
        values (new.business_id, item.raw_material_id, new.supplier_id, item.quantity, item.unit_cost, item.line_total, v_allocated, 'PO ' || new.po_number);
      elsif item.product_id is not null then
        update public.products
           set stock_quantity = stock_quantity + item.quantity,
               cost_price = case when item.quantity > 0
                                 then (item.line_total + v_allocated) / item.quantity
                                 else cost_price end
         where id = item.product_id;
        insert into public.stock_adjustments (business_id, product_id, delta, reason, notes)
        values (new.business_id, item.product_id, item.quantity, 'Purchase order received', 'PO ' || new.po_number);
      end if;
    end loop;
    new.received_at := now();
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';
