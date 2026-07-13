-- Split payment: a POS sale can be paid via multiple methods (e.g. part cash + part transfer).
-- New `sale_payments` child table holds one row per method — a single-method sale writes one row, a
-- split writes N. It's the source of truth for per-method amounts (End-of-Day, Reports, Dashboard).
-- Written ONLY inside commit_offline_sale (security definer); clients read only. `sales.payment_method`
-- is kept as a quick summary: the method when single, or 'split' when more than one.

create table if not exists public.sale_payments (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  sale_id     uuid not null references public.sales(id) on delete cascade,
  method      text not null,
  amount      numeric not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists sale_payments_sale_idx on public.sale_payments (sale_id);
create index if not exists sale_payments_business_idx on public.sale_payments (business_id, created_at desc);

alter table public.sale_payments enable row level security;
revoke all on public.sale_payments from anon;
grant select on public.sale_payments to authenticated;
drop policy if exists "biz members view sale_payments" on public.sale_payments;
create policy "biz members view sale_payments" on public.sale_payments for select
  using (business_id = public.current_business_id());

-- Backfill: one payment row per existing sale from its single method + total, so every read path
-- (End-of-Day, Reports, Dashboard, invoices) works uniformly from sale_payments. Idempotent — the
-- NOT EXISTS guard means re-running never duplicates.
insert into public.sale_payments (business_id, sale_id, method, amount, created_at)
select s.business_id, s.id, coalesce(s.payment_method, 'cash'), s.total_amount, s.created_at
from public.sales s
where not exists (select 1 from public.sale_payments sp where sp.sale_id = s.id);

-- Re-declare commit_offline_sale (last set in 20260717110000_ledger_autopost_sales): identical —
-- stock decrement, sale + sale_items (with unit_cost), invoice + invoice_items, and the exception-safe
-- ledger posting are unchanged — PLUS it now records the payment breakdown into sale_payments and sets
-- sales.payment_method to the single method or 'split'. Reads `_sale->'payments'` ([{method,amount}]);
-- falls back to the single `_sale->>'payment_method'` for older clients.
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
  v_payments    jsonb := _sale->'payments';
  v_has_split   boolean := v_payments is not null and jsonb_typeof(v_payments) = 'array' and jsonb_array_length(v_payments) > 0;
  v_method      text;
  v_item        record;
  v_name        text;
begin
  if v_business_id is null or v_business_id <> public.current_business_id() then
    raise exception 'not authorised for this business';
  end if;

  if exists (select 1 from public.sales where id = v_sale_id) then
    return jsonb_build_object('status', 'duplicate', 'sale_id', v_sale_id);
  end if;

  -- Payment summary for sales.payment_method: the single method, or 'split' when more than one.
  if v_has_split then
    v_method := case when jsonb_array_length(v_payments) > 1 then 'split' else (v_payments->0->>'method') end;
  else
    v_method := coalesce(_sale->>'payment_method', 'cash');
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
          (_sale->>'total')::numeric, (_sale->>'discount')::numeric, v_tax, v_method, v_created_at);

  insert into public.sale_items (sale_id, product_id, quantity, unit_price, unit_cost)
  select v_sale_id, (e->>'product_id')::uuid, (e->>'quantity')::numeric, (e->>'unit_price')::numeric,
         coalesce(p.cost_price, 0)
  from jsonb_array_elements(_sale->'items') as e
  left join public.products p on p.id = (e->>'product_id')::uuid and p.business_id = v_business_id;

  -- Payment breakdown: one row per method (or a single row from the summary for older clients).
  if v_has_split then
    insert into public.sale_payments (business_id, sale_id, method, amount)
    select v_business_id, v_sale_id, e->>'method', coalesce((e->>'amount')::numeric, 0)
    from jsonb_array_elements(v_payments) as e;
  else
    insert into public.sale_payments (business_id, sale_id, method, amount)
    values (v_business_id, v_sale_id, v_method, (_sale->>'total')::numeric);
  end if;

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

  -- Ledger posting: never let it fail the sale.
  begin
    perform public.post_sale_journal(v_business_id, v_sale_id);
  exception when others then
    null;
  end;

  return jsonb_build_object('status', 'committed', 'sale_id', v_sale_id, 'invoice_number', _sale->>'invoice_number');
end;
$$;
revoke all on function public.commit_offline_sale(jsonb) from public, anon;
grant execute on function public.commit_offline_sale(jsonb) to authenticated;

notify pgrst, 'reload schema';
