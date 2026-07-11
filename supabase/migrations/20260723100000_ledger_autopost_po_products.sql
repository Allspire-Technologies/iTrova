-- Accounting v2 — phase 3b: post PRODUCT purchase-order lines to the ledger, closing the last
-- inventory-posting gap. Raw-material PO lines already post (they route through material_purchases →
-- sync_purchase_journal); product lines updated stock/cost but posted nothing, so ledger Inventory was
-- understated for goods bought for resale. Also: PO input VAT on raw-material lines was being dropped
-- (the material_purchases insert passed no tax_amount) — now allocated and posted too.
--
-- Design: a received PO's raw lines keep posting via material_purchases; the PRODUCT portion posts via
-- a new sync_po_journal keyed on (source='purchase', source_id=po.id) — a distinct key from each
-- material_purchase, so the two never collide or double-count. Reverse-and-repost + exception-safe
-- AFTER trigger, matching the other auto-posters (never breaks the underlying write; no-op until a
-- chart of accounts exists).

-- ---- receive_purchase_order: now also allocates the PO's input VAT onto the raw-material
-- material_purchases rows (so raw-material PO VAT reaches the ledger). Whole-function replace of the
-- version last set in 20260713110000; only the material_purchases insert (adds tax_amount) changed.
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
begin
  if new.status = 'received' and coalesce(old.status, '') <> 'received' then
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
        insert into public.material_purchases (business_id, raw_material_id, supplier_id, quantity, unit_cost, total_cost, landed_total, tax_amount, notes)
        values (new.business_id, item.raw_material_id, new.supplier_id, item.quantity, item.unit_cost, item.line_total, v_allocated,
                case when v_total_value > 0 then coalesce(new.tax_amount, 0) * item.line_total / v_total_value else 0 end,
                'PO ' || new.po_number);
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
        insert into public.stock_adjustments (business_id, product_id, delta, reason, notes)
        values (new.business_id, item.product_id, item.quantity, 'Purchase order received', 'PO ' || new.po_number);
      end if;
    end loop;
    new.received_at := now();
  end if;
  return new;
end;
$$;

-- ---- Product-portion PO journal: Dr Inventory (net + landed) + Dr VAT Payable (input) / Cr Cash.
-- Raw-material lines are excluded here (they post via material_purchases). Idempotent: delete this
-- PO's journal then repost from current data; no-op unless the PO is 'received' and a chart exists.
create or replace function public.sync_po_journal(_id uuid, _business_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v             record;
  item          record;
  v_total_value numeric;
  v_total_weight numeric;
  v_count       integer;
  v_alloc       numeric;
  v_prod_goods  numeric := 0;
  v_prod_landed numeric := 0;
  v_prod_tax    numeric;
  v_cash        numeric;
  v_lines       jsonb;
begin
  delete from public.journal_entries where business_id = _business_id and source = 'purchase' and source_id = _id;
  if not exists (select 1 from public.accounts where business_id = _business_id) then return; end if;
  select * into v from public.purchase_orders where id = _id;
  if not found or v.status <> 'received' then return; end if;

  -- Allocation totals across ALL lines (products + raw materials), matching receive_purchase_order.
  select coalesce(sum(i.line_total), 0),
         coalesce(sum(coalesce(p.weight, r.weight, 0) * i.quantity), 0),
         count(*)
    into v_total_value, v_total_weight, v_count
    from public.purchase_order_items i
    left join public.products p on p.id = i.product_id
    left join public.raw_materials r on r.id = i.raw_material_id
   where i.purchase_order_id = _id;

  -- Product goods + their allocated landed cost (product lines only).
  for item in
    select i.*, coalesce(p.weight, 0) as unit_weight
      from public.purchase_order_items i
      join public.products p on p.id = i.product_id
     where i.purchase_order_id = _id
  loop
    v_prod_goods := v_prod_goods + coalesce(item.line_total, 0);
    select coalesce(sum(
      (e->>'amount')::numeric * case
        when coalesce(e->>'basis', 'value') = 'weight' and v_total_weight > 0
             then (item.unit_weight * item.quantity) / v_total_weight
        when v_total_value > 0 then item.line_total / v_total_value
        else 1.0 / greatest(v_count, 1)
      end
    ), 0) into v_alloc
    from jsonb_array_elements(coalesce(v.landed_costs, '[]'::jsonb)) e;
    v_prod_landed := v_prod_landed + coalesce(v_alloc, 0);
  end loop;

  if v_prod_goods = 0 and v_prod_landed = 0 then return; end if;   -- raw-materials-only PO

  -- PO input VAT attributable to the product lines (allocated by goods value).
  v_prod_tax := case when v_total_value > 0 then coalesce(v.tax_amount, 0) * v_prod_goods / v_total_value else 0 end;
  v_cash := v_prod_goods + v_prod_landed;

  v_lines := jsonb_build_array(
    jsonb_build_object('account_code', '1200', 'debit', v_prod_goods - v_prod_tax + v_prod_landed, 'credit', 0, 'description', 'Stock purchased (PO)'));
  if v_prod_tax > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code', '2100', 'debit', v_prod_tax, 'credit', 0, 'description', 'Input VAT'));
  end if;
  v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code', '1000', 'debit', 0, 'credit', v_cash, 'description', 'Cash paid'));

  perform public._post_journal_impl(
    _business_id, coalesce(v.received_at::date, v.created_at::date, current_date),
    'Purchase order ' || coalesce(v.po_number, ''), 'purchase', _id, v_lines);
end; $$;

create or replace function public.trg_sync_po() returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin perform public.sync_po_journal(coalesce(NEW.id, OLD.id), coalesce(NEW.business_id, OLD.business_id));
  exception when others then null; end;
  return null;
end; $$;
drop trigger if exists sync_po_journal_trg on public.purchase_orders;
create trigger sync_po_journal_trg after insert or update or delete on public.purchase_orders
  for each row execute function public.trg_sync_po();

notify pgrst, 'reload schema';
