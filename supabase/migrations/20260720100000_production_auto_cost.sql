-- Production auto-costing: a run's cost = raw materials consumed (used + wasted) at their cost, plus an
-- optional labour/overhead amount. That cost is allocated across the produced products by relative
-- selling value and becomes each product's cost price (blended per the business's valuation method).
-- A manually-entered cost still overrides. Labour/overhead is capitalised into Inventory in the ledger.
-- Whole-function replace of record_production_run (last set 20260710110000) + a new _labour_overhead arg.

-- Allow the 'production' journal source.
alter table public.journal_entries drop constraint if exists journal_entries_source_check;
alter table public.journal_entries add constraint journal_entries_source_check
  check (source in ('manual','opening','sale','invoice','expense','payment','payroll','purchase','production'));

-- Drop the old 5-arg signature so the new (defaulted) 6-arg version fully replaces it.
drop function if exists public.record_production_run(uuid, uuid, jsonb, jsonb, text);

create or replace function public.record_production_run(
  _business_id uuid, _requisition_id uuid, _outputs jsonb, _materials jsonb, _notes text, _labour_overhead numeric default 0
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_run_id   uuid := gen_random_uuid();
  v_req      record;
  v_out      record;
  v_mat      record;
  v_line     record;
  v_name     text;
  v_consumed numeric;
  v_delta    numeric;
  v_raw_cost numeric := 0;
  v_run_cost numeric;
  v_total_value numeric;
  v_total_qty   numeric;
  v_val      text;
  v_sp       numeric;
  v_oldq     numeric;
  v_oldc     numeric;
  v_unit     numeric;
  v_final    numeric;
  v_newcost  numeric;
begin
  if _business_id is null or _business_id <> public.current_business_id() then
    raise exception 'not authorised for this business';
  end if;
  perform public.assert_permission(_business_id, 'production', 'produce');

  if _outputs is null or jsonb_typeof(_outputs) <> 'array' or jsonb_array_length(_outputs) = 0 then
    raise exception 'EMPTY_OUTPUTS' using errcode = 'check_violation';
  end if;

  if _requisition_id is not null then
    select * into v_req from public.production_requisitions where id = _requisition_id for update;
    if not found or v_req.business_id <> _business_id then raise exception 'requisition not found'; end if;
    if v_req.status <> 'approved' then raise exception 'REQUISITION_NOT_APPROVED' using errcode = 'check_violation'; end if;
  end if;

  insert into public.production_runs (id, business_id, requisition_id, produced_by, notes)
  values (v_run_id, _business_id, _requisition_id, auth.uid(), nullif(_notes, ''));

  create temp table _run_used (raw_material_id uuid primary key, used numeric, wasted numeric) on commit drop;
  for v_mat in
    select (e->>'raw_material_id')::uuid as raw_material_id,
           (e->>'quantity_used')::numeric as used,
           coalesce((e->>'quantity_wasted')::numeric, 0) as wasted
    from jsonb_array_elements(coalesce(_materials, '[]'::jsonb)) as e
  loop
    if v_mat.used is null or v_mat.used < 0 or v_mat.wasted < 0 then raise exception 'BAD_QUANTITY' using errcode = 'check_violation'; end if;
    if not exists (select 1 from public.raw_materials rm where rm.id = v_mat.raw_material_id and rm.business_id = _business_id) then
      raise exception 'MATERIAL_NOT_FOUND' using errcode = 'check_violation';
    end if;
    insert into _run_used values (v_mat.raw_material_id, v_mat.used, v_mat.wasted)
    on conflict (raw_material_id) do update set used = _run_used.used + excluded.used, wasted = _run_used.wasted + excluded.wasted;
  end loop;

  for v_line in
    select coalesce(u.raw_material_id, i.raw_material_id) as raw_material_id,
           coalesce(u.used, 0) as used, coalesce(u.wasted, 0) as wasted, coalesce(i.issued, 0) as issued
    from _run_used u
    full outer join (
      select raw_material_id, sum(coalesce(quantity_issued, 0)) as issued
      from public.production_requisition_items
      where _requisition_id is not null and requisition_id = _requisition_id
      group by raw_material_id
    ) i on i.raw_material_id = u.raw_material_id
    order by 1
  loop
    v_consumed := v_line.used + v_line.wasted;
    v_delta := v_consumed - v_line.issued;
    if v_delta > 0 then
      update public.raw_materials set stock_quantity = stock_quantity - v_delta
       where id = v_line.raw_material_id and business_id = _business_id and stock_quantity >= v_delta;
      if not found then
        select name into v_name from public.raw_materials where id = v_line.raw_material_id;
        raise exception 'INSUFFICIENT_STOCK:%', coalesce(v_name, 'a material') using errcode = 'check_violation';
      end if;
      insert into public.stock_adjustments (business_id, raw_material_id, delta, reason, notes, user_id)
      values (_business_id, v_line.raw_material_id, -v_delta, 'Production',
              case when v_line.wasted > 0 then 'Production run (incl. ' || v_line.wasted || ' wasted)' else 'Production run' end, auth.uid());
    elsif v_delta < 0 then
      update public.raw_materials set stock_quantity = stock_quantity - v_delta
       where id = v_line.raw_material_id and business_id = _business_id;
      insert into public.stock_adjustments (business_id, raw_material_id, delta, reason, notes, user_id)
      values (_business_id, v_line.raw_material_id, -v_delta, 'Production', 'Unused material returned', auth.uid());
    end if;
    if v_line.used > 0 or v_line.wasted > 0 then
      insert into public.production_run_materials (run_id, raw_material_id, quantity_used, quantity_wasted)
      values (v_run_id, v_line.raw_material_id, v_line.used, v_line.wasted);
    end if;
  end loop;

  -- Run cost = consumed materials at cost + labour/overhead.
  select coalesce(sum((u.used + u.wasted) * coalesce(rm.cost_per_unit, 0)), 0)
    into v_raw_cost from _run_used u join public.raw_materials rm on rm.id = u.raw_material_id;
  v_run_cost := v_raw_cost + coalesce(_labour_overhead, 0);

  -- Output totals for value-based allocation (per-unit cost = run_cost × selling_price / total_value).
  select coalesce(sum(qty * coalesce(sp, 0)), 0), coalesce(sum(qty), 0)
    into v_total_value, v_total_qty
    from (select (e->>'quantity')::numeric qty,
                 (select selling_price from public.products where id = (e->>'product_id')::uuid and business_id = _business_id) sp
          from jsonb_array_elements(_outputs) e) t;

  select valuation_method into v_val from public.businesses where id = _business_id;

  for v_out in
    select (e->>'product_id')::uuid as product_id, (e->>'quantity')::numeric as qty, (e->>'cost_price')::numeric as cost
    from jsonb_array_elements(_outputs) as e
  loop
    if v_out.qty is null or v_out.qty <= 0 then raise exception 'BAD_QUANTITY' using errcode = 'check_violation'; end if;
    if v_out.cost is not null and v_out.cost < 0 then raise exception 'BAD_QUANTITY' using errcode = 'check_violation'; end if;

    select selling_price, stock_quantity, cost_price into v_sp, v_oldq, v_oldc
      from public.products where id = v_out.product_id and business_id = _business_id;
    if not found then raise exception 'PRODUCT_NOT_FOUND' using errcode = 'check_violation'; end if;

    -- Auto unit cost (value-allocated) unless a manual cost was supplied.
    v_unit := case when v_total_value > 0 then v_run_cost * coalesce(v_sp, 0) / v_total_value
                   when v_total_qty > 0 then v_run_cost / v_total_qty else 0 end;
    v_final := coalesce(v_out.cost, round(v_unit, 4));
    -- Blend into cost price per the valuation method (moving average vs last cost).
    if coalesce(v_val, 'moving_average') = 'last_cost' or coalesce(v_oldq, 0) <= 0 then
      v_newcost := v_final;
    else
      v_newcost := (v_oldq * coalesce(v_oldc, 0) + v_out.qty * v_final) / (v_oldq + v_out.qty);
    end if;

    update public.products set stock_quantity = stock_quantity + v_out.qty, cost_price = round(v_newcost, 4)
     where id = v_out.product_id and business_id = _business_id;
    insert into public.production_run_outputs (run_id, product_id, quantity) values (v_run_id, v_out.product_id, v_out.qty);
    insert into public.stock_adjustments (business_id, product_id, delta, reason, notes, user_id)
    values (_business_id, v_out.product_id, v_out.qty, 'Production', 'Production run output', auth.uid());
  end loop;

  if _requisition_id is not null then update public.production_requisitions set status = 'completed' where id = _requisition_id; end if;

  -- Ledger: capitalise labour/overhead into Inventory (raw→finished reclass is net-zero in a single
  -- Inventory account, so only the added overhead needs posting). Never let a ledger error fail the run.
  if coalesce(_labour_overhead, 0) > 0 then
    begin
      if exists (select 1 from public.accounts where business_id = _business_id) then
        perform public._post_journal_impl(_business_id, current_date, 'Production overhead', 'production', v_run_id, jsonb_build_array(
          jsonb_build_object('account_code', '1200', 'debit', _labour_overhead, 'credit', 0, 'description', 'Labour/overhead into stock'),
          jsonb_build_object('account_code', '1000', 'debit', 0, 'credit', _labour_overhead, 'description', 'Cash')));
      end if;
    exception when others then null;
    end;
  end if;

  return jsonb_build_object('id', v_run_id);
end;
$$;
revoke all on function public.record_production_run(uuid, uuid, jsonb, jsonb, text, numeric) from public, anon;
grant execute on function public.record_production_run(uuid, uuid, jsonb, jsonb, text, numeric) to authenticated;

notify pgrst, 'reload schema';
