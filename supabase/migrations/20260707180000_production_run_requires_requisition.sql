-- Production must be recorded against an APPROVED materials request — no more request-less
-- ("direct") runs. This re-declares record_production_run from 20260707100000 with one added guard
-- (raise REQUISITION_REQUIRED when _requisition_id is null); the body is otherwise unchanged, so
-- the requisition-mode reconciliation (deduct extra used, restock unused, mark completed) is intact.
-- NOTIFY refreshes PostgREST so the change takes effect without a restart.

create or replace function public.record_production_run(
  _business_id uuid, _requisition_id uuid, _outputs jsonb, _materials jsonb, _notes text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_run_id uuid := gen_random_uuid();
  v_req    record;
  v_out    record;
  v_mat    record;
  v_line   record;
  v_name   text;
  v_issued numeric;
  v_delta  numeric;
begin
  if _business_id is null or _business_id <> public.current_business_id() then
    raise exception 'not authorised for this business';
  end if;
  perform public.assert_permission(_business_id, 'production', 'produce');

  -- Production is only recorded against an approved request.
  if _requisition_id is null then
    raise exception 'REQUISITION_REQUIRED' using errcode = 'check_violation';
  end if;

  if _outputs is null or jsonb_typeof(_outputs) <> 'array' or jsonb_array_length(_outputs) = 0 then
    raise exception 'EMPTY_OUTPUTS' using errcode = 'check_violation';
  end if;

  select * into v_req from public.production_requisitions where id = _requisition_id for update;
  if not found or v_req.business_id <> _business_id then
    raise exception 'requisition not found';
  end if;
  if v_req.status <> 'approved' then
    raise exception 'REQUISITION_NOT_APPROVED' using errcode = 'check_violation';
  end if;

  insert into public.production_runs (id, business_id, requisition_id, produced_by, notes)
  values (v_run_id, _business_id, _requisition_id, auth.uid(), nullif(_notes, ''));

  -- Materials: build the used-per-material map from the payload (validated + summed per id).
  create temp table _run_used (raw_material_id uuid primary key, used numeric) on commit drop;
  for v_mat in
    select (e->>'raw_material_id')::uuid as raw_material_id, (e->>'quantity_used')::numeric as used
    from jsonb_array_elements(coalesce(_materials, '[]'::jsonb)) as e
  loop
    if v_mat.used is null or v_mat.used < 0 then
      raise exception 'BAD_QUANTITY' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.raw_materials rm
                   where rm.id = v_mat.raw_material_id and rm.business_id = _business_id) then
      raise exception 'MATERIAL_NOT_FOUND' using errcode = 'check_violation';
    end if;
    insert into _run_used values (v_mat.raw_material_id, v_mat.used)
    on conflict (raw_material_id) do update set used = _run_used.used + excluded.used;
  end loop;

  -- Reconcile stock: union of used materials and the request's issued materials, so
  -- issued-but-omitted lines fully restock and extra materials deduct with the guard.
  for v_line in
    select coalesce(u.raw_material_id, i.raw_material_id) as raw_material_id,
           coalesce(u.used, 0) as used,
           coalesce(i.issued, 0) as issued
    from _run_used u
    full outer join (
      select raw_material_id, sum(coalesce(quantity_issued, 0)) as issued
      from public.production_requisition_items
      where requisition_id = _requisition_id
      group by raw_material_id
    ) i on i.raw_material_id = u.raw_material_id
    order by 1
  loop
    v_delta := v_line.used - v_line.issued;  -- positive = extra to deduct, negative = restock
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
      values (_business_id, v_line.raw_material_id, -v_delta, 'Production', 'Production run', auth.uid());
    elsif v_delta < 0 then
      update public.raw_materials
         set stock_quantity = stock_quantity - v_delta   -- minus a negative = restock
       where id = v_line.raw_material_id and business_id = _business_id;
      insert into public.stock_adjustments (business_id, raw_material_id, delta, reason, notes, user_id)
      values (_business_id, v_line.raw_material_id, -v_delta, 'Production', 'Unused material returned', auth.uid());
    end if;

    if v_line.used > 0 then
      insert into public.production_run_materials (run_id, raw_material_id, quantity_used)
      values (v_run_id, v_line.raw_material_id, v_line.used);
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

  update public.production_requisitions set status = 'completed' where id = _requisition_id;

  return jsonb_build_object('id', v_run_id);
end;
$$;
revoke all on function public.record_production_run(uuid, uuid, jsonb, jsonb, text) from public, anon;
grant execute on function public.record_production_run(uuid, uuid, jsonb, jsonb, text) to authenticated;

notify pgrst, 'reload schema';
