-- Recorded stocking date. Stock-ins (manual adjustments, opening stock, raw-material purchases,
-- PO receipts) only ever carried the server's created_at — you couldn't record that stock physically
-- arrived on a different day, and there was no way to report on it. Add an optional, user-settable
-- `stocked_date` to the two tables that log stock-ins, and let a PO's received date be set by the app.
-- Anything without a stocked_date falls back to created_at at read time (handled in the app), so
-- existing rows need no backfill.

alter table public.stock_adjustments add column if not exists stocked_date date;
alter table public.material_purchases add column if not exists stocked_date date;

-- Re-declare receive_purchase_order (last set in 20260723100000) — verbatim except:
--   • new.received_at is now coalesce(new.received_at, now()) so the receive UPDATE can set the date;
--   • the material_purchases and stock_adjustments rows it creates stamp stocked_date from that date.
create or replace function public.receive_purchase_order()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  item           record;
  v_total_value  numeric;
  v_total_weight numeric;
  v_count        integer;
  v_allocated    numeric;
  v_method       text;
  v_old_qty      numeric;
  v_old_cost     numeric;
  v_recv         numeric;
  v_new_cost     numeric;
  v_stocked      date;
begin
  if new.status = 'received' and coalesce(old.status, '') <> 'received' then
    -- Keep an app-supplied received_at (settable receive date); default to now() otherwise.
    new.received_at := coalesce(new.received_at, now());
    v_stocked := new.received_at::date;
    select valuation_method into v_method from public.businesses where id = new.business_id;
    -- Allocation totals: line value, and line weight (per-unit weight × qty).
    select coalesce(sum(i.line_total), 0),
           coalesce(sum(coalesce(p.weight, r.weight, 0) * i.quantity), 0),
           count(*)
      into v_total_value, v_total_weight, v_count
      from public.purchase_order_items i
      left join public.products p on p.id = i.product_id
      left join public.raw_materials r on r.id = i.raw_material_id
     where i.purchase_order_id = new.id;

    for item in
      select i.*, coalesce(p.weight, r.weight, 0) as unit_weight
        from public.purchase_order_items i
        left join public.products p on p.id = i.product_id
        left join public.raw_materials r on r.id = i.raw_material_id
       where i.purchase_order_id = new.id
    loop
      -- This line's allocated landed cost: sum each cost line by its basis (weight → by line weight,
      -- else by line value; equal split if neither basis has a total).
      select coalesce(sum(
        (e->>'amount')::numeric * case
          when coalesce(e->>'basis', 'value') = 'weight' and v_total_weight > 0
               then (item.unit_weight * item.quantity) / v_total_weight
          when v_total_value > 0 then item.line_total / v_total_value
          else 1.0 / greatest(v_count, 1)
        end
      ), 0) into v_allocated
      from jsonb_array_elements(coalesce(new.landed_costs, '[]'::jsonb)) e;

      if item.raw_material_id is not null then
        -- add_stock_on_purchase values cost from (total_cost + landed_total) per the business method.
        -- Input VAT is the PO's tax_amount allocated to this line by value, so raw-material PO VAT posts.
        insert into public.material_purchases (business_id, raw_material_id, supplier_id, quantity, unit_cost, total_cost, landed_total, tax_amount, notes, stocked_date)
        values (new.business_id, item.raw_material_id, new.supplier_id, item.quantity, item.unit_cost, item.line_total, v_allocated,
                case when v_total_value > 0 then coalesce(new.tax_amount, 0) * item.line_total / v_total_value else 0 end,
                'PO ' || new.po_number, v_stocked);
      elsif item.product_id is not null then
        select stock_quantity, cost_price into v_old_qty, v_old_cost from public.products where id = item.product_id for update;
        v_recv := item.line_total + v_allocated;
        if item.quantity > 0 then
          if coalesce(v_method, 'moving_average') = 'moving_average' and (coalesce(v_old_qty, 0) + item.quantity) > 0 then
            v_new_cost := (coalesce(v_old_qty, 0) * coalesce(v_old_cost, 0) + v_recv) / (coalesce(v_old_qty, 0) + item.quantity);
          else
            v_new_cost := v_recv / item.quantity;
          end if;
        else
          v_new_cost := v_old_cost;
        end if;
        update public.products
           set stock_quantity = stock_quantity + item.quantity, cost_price = v_new_cost
         where id = item.product_id;
        insert into public.stock_adjustments (business_id, product_id, delta, reason, notes, stocked_date)
        values (new.business_id, item.product_id, item.quantity, 'Purchase order received', 'PO ' || new.po_number, v_stocked);
      end if;
    end loop;
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';
