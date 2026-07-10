-- Post a draft pay run to Expenditure: recompute totals from the run's lines (source of truth),
-- create one aggregate "Salaries" expense for the total GROSS pay (the real business cost), and stamp
-- the run posted + linked to that expense. One transaction, so a failure rolls the whole thing back.
-- Idempotent: refuses a run that's already posted. SECURITY DEFINER, so it checks the caller's
-- expenditure/create permission explicitly (RLS is bypassed inside the function).
create or replace function public.post_payroll_run(
  _run_id uuid, _payment_method text, _mark_paid boolean
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_run        record;
  v_gross      numeric;
  v_deductions numeric;
  v_net        numeric;
  v_count      int;
  v_expense_id uuid;
begin
  select * into v_run from public.payroll_runs where id = _run_id;
  if not found then raise exception 'pay run not found'; end if;
  if v_run.business_id <> public.current_business_id() then raise exception 'not authorised for this business'; end if;
  perform public.assert_permission(v_run.business_id, 'expenditure', 'create');
  if v_run.status = 'posted' then raise exception 'ALREADY_POSTED' using errcode = 'check_violation'; end if;

  select coalesce(sum(gross_pay), 0), coalesce(sum(deduction_total), 0), coalesce(sum(net_pay), 0), count(*)
    into v_gross, v_deductions, v_net, v_count
    from public.payroll_run_lines where run_id = _run_id;
  if v_count = 0 then raise exception 'NO_LINES' using errcode = 'check_violation'; end if;

  insert into public.expenses (
    business_id, expense_date, category, amount, payment_method, payee, description,
    status, due_date, paid_date, created_by, tax_amount
  ) values (
    v_run.business_id, v_run.pay_date, 'Salaries', v_gross, nullif(_payment_method, ''), 'Payroll',
    'Payroll — ' || v_run.period_label || ' (' || v_count || ' staff)',
    case when _mark_paid then 'paid' else 'pending' end,
    case when _mark_paid then null else v_run.pay_date end,
    case when _mark_paid then v_run.pay_date else null end,
    auth.uid(), 0
  ) returning id into v_expense_id;

  update public.payroll_runs
    set status = 'posted', expense_id = v_expense_id,
        gross_total = v_gross, deduction_total = v_deductions, net_total = v_net
    where id = _run_id;

  return jsonb_build_object('expense_id', v_expense_id, 'gross_total', v_gross, 'net_total', v_net, 'staff', v_count);
end;
$$;
revoke all on function public.post_payroll_run(uuid, text, boolean) from public, anon;
grant execute on function public.post_payroll_run(uuid, text, boolean) to authenticated;

notify pgrst, 'reload schema';
