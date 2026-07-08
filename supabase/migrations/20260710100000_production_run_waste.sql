-- Production run waste: capture raw material lost/spoiled during a run, separately from what
-- actually went into the product. Waste is consumed from stock like usage (both reduce raw-material
-- stock), but is recorded distinctly so yield/loss shows up in the run records.
--
-- Reconciliation against an approved requisition now nets on TOTAL consumption (used + wasted):
--   delta = (used + wasted) − issued  → positive deducts the extra (guarded), negative restocks.

alter table public.production_run_materials
  add column if not exists quantity_wasted numeric not null default 0 check (quantity_wasted >= 0);

-- Re-declare record_production_run to parse + persist per-material waste and fold it into the
-- stock reconciliation. (Whole-function replace — the only change from 20260707100000 is waste.)
create or replace function public.record_production_run(
  _business_id uuid, _requisition_id uuid, _outputs jsonb, _materials jsonb, _notes text
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
    if not found or v_req.business_id <> _business_id then
      raise exception 'requisition not found';
    end if;
    if v_req.status <> 'approved' then
      raise exception 'REQUISITION_NOT_APPROVED' using errcode = 'check_violation';
    end if;
  end if;

  insert into public.production_runs (id, business_id, requisition_id, produced_by, notes)
  values (v_run_id, _business_id, _requisition_id, auth.uid(), nullif(_notes, ''));

  -- Materials: build the used/wasted-per-material map from the payload (validated + summed per id).
  create temp table _run_used (raw_material_id uuid primary key, used numeric, wasted numeric) on commit drop;
  for v_mat in
    select (e->>'raw_material_id')::uuid as raw_material_id,
           (e->>'quantity_used')::numeric as used,
           coalesce((e->>'quantity_wasted')::numeric, 0) as wasted
    from jsonb_array_elements(coalesce(_materials, '[]'::jsonb)) as e
  loop
    if v_mat.used is null or v_mat.used < 0 or v_mat.wasted < 0 then
      raise exception 'BAD_QUANTITY' using errcode = 'check_violation';
    end if;
    -- Re-validate ownership: ids arrive in JSON, so a foreign id must not slip through.
    if not exists (select 1 from public.raw_materials rm
                   where rm.id = v_mat.raw_material_id and rm.business_id = _business_id) then
      raise exception 'MATERIAL_NOT_FOUND' using errcode = 'check_violation';
    end if;
    insert into _run_used values (v_mat.raw_material_id, v_mat.used, v_mat.wasted)
    on conflict (raw_material_id) do update
      set used = _run_used.used + excluded.used, wasted = _run_used.wasted + excluded.wasted;
  end loop;

  -- Reconcile stock on total consumption: union of consumed materials and (in requisition mode)
  -- issued materials, so issued-but-omitted lines fully restock and extra consumption deducts.
  for v_line in
    select coalesce(u.raw_material_id, i.raw_material_id) as raw_material_id,
           coalesce(u.used, 0) as used,
           coalesce(u.wasted, 0) as wasted,
           coalesce(i.issued, 0) as issued
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
    v_delta := v_consumed - v_line.issued;  -- positive = extra to deduct, negative = restock
    if v_delta > 0 then
      update public.raw_materials
         set stock_quantity = stock_quantity - v_delta
       where id = v_line.raw_material_id and business_id = _business_id
         and stock_quantity >= v_delta;
      if not found then
        select name into v_name from public.raw_materials where id = v_line.raw_material_id;
        raise exception 'INSUFFICIENT_STOCK:%', coalesce(v_name, 'a material') using errcode = 'check_violation';
      end if;
      insert into public.stock_adjustments (business_id, raw_material_id, delta, reason, notes, user_id)
      values (_business_id, v_line.raw_material_id, -v_delta, 'Production',
              case when v_line.wasted > 0 then 'Production run (incl. ' || v_line.wasted || ' wasted)' else 'Production run' end,
              auth.uid());
    elsif v_delta < 0 then
      update public.raw_materials
         set stock_quantity = stock_quantity - v_delta   -- minus a negative = restock
       where id = v_line.raw_material_id and business_id = _business_id;
      insert into public.stock_adjustments (business_id, raw_material_id, delta, reason, notes, user_id)
      values (_business_id, v_line.raw_material_id, -v_delta, 'Production', 'Unused material returned', auth.uid());
    end if;

    if v_line.used > 0 or v_line.wasted > 0 then
      insert into public.production_run_materials (run_id, raw_material_id, quantity_used, quantity_wasted)
      values (v_run_id, v_line.raw_material_id, v_line.used, v_line.wasted);
    end if;
  end loop;

  -- Outputs: increment product stock + audit rows.
  for v_out in
    select (e->>'product_id')::uuid as product_id, (e->>'quantity')::numeric as qty
    from jsonb_array_elements(_outputs) as e
  loop
    if v_out.qty is null or v_out.qty <= 0 then
      raise exception 'BAD_QUANTITY' using errcode = 'check_violation';
    end if;
    update public.products set stock_quantity = stock_quantity + v_out.qty
     where id = v_out.product_id and business_id = _business_id;
    if not found then
      raise exception 'PRODUCT_NOT_FOUND' using errcode = 'check_violation';
    end if;
    insert into public.production_run_outputs (run_id, product_id, quantity)
    values (v_run_id, v_out.product_id, v_out.qty);
    insert into public.stock_adjustments (business_id, product_id, delta, reason, notes, user_id)
    values (_business_id, v_out.product_id, v_out.qty, 'Production', 'Production run output', auth.uid());
  end loop;

  if _requisition_id is not null then
    update public.production_requisitions set status = 'completed' where id = _requisition_id;
  end if;

  return jsonb_build_object('id', v_run_id);
end;
$$;
revoke all on function public.record_production_run(uuid, uuid, jsonb, jsonb, text) from public, anon;
grant execute on function public.record_production_run(uuid, uuid, jsonb, jsonb, text) to authenticated;

notify pgrst, 'reload schema';
