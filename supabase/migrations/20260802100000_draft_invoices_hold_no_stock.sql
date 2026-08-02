-- Draft invoices hold no stock.
-- APPLIES TO THE SHARED iTrova SUPABASE PROJECT (wnuyzsjhijhnhkpcnnqu).
--
-- The bug: save_invoice applied its stock delta unconditionally — the invoice's status was read only
-- to write the header. So an invoice parked in 'draft' had its goods deducted while the ledger
-- reversed (sync_invoice_journal skips draft) and Reports excluded it: inventory said the goods had
-- left, the books said nothing happened. This restores the agreed rule — stock moves when an invoice
-- is ISSUED, not before.
--
-- One rule: an invoice HOLDS STOCK while its status is anything other than draft or void.
--   save draft            → no deduction
--   draft   → issued      → deduct (oversell-guarded)
--   issued  → draft       → return the stock
--   issued  → void/delete → return the stock (unchanged)
--   draft   → void/delete → nothing to return
--
-- That last line is why the void trigger had to change too: it fired on ANY transition into void, so
-- once drafts stop holding stock it would have ADDED stock that was never removed — inventing units.

-- ---------------------------------------------------------------- 1. one definition of "holds stock"
create or replace function public._invoice_holds_stock(_status text)
returns boolean language sql immutable as $$
  select coalesce(_status, 'issued') not in ('draft', 'void');
$$;

-- ---------------------------------------------------------------- 2. save_invoice respects the status
-- Desired quantities count as zero while the invoice is a draft, and the already-committed side
-- counts as zero if it WAS a draft — so the existing delta machinery handles every transition
-- (including issued→draft returning stock) with no special case.
--
-- The edit path never wrote `status`, which is deliberate: editing a paid invoice must not demote it.
-- So the status is only applied when the caller explicitly sends one.
create or replace function public.save_invoice(_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_business_id  uuid := (_payload->>'business_id')::uuid;
  v_invoice_id   uuid := nullif(_payload->>'invoice_id', '')::uuid;
  v_sale_id      uuid := nullif(_payload->>'sale_id', '')::uuid;
  v_is_edit      boolean := v_invoice_id is not null;
  v_number       text;
  v_status_given boolean := nullif(_payload->>'status', '') is not null;
  v_status       text := coalesce(nullif(_payload->>'status', ''), 'issued');
  v_old_status   text;
  v_eff_status   text;
  v_holds_new    boolean;
  v_holds_old    boolean;
  v_row          record;
  v_name         text;
begin
  if v_business_id is null or v_business_id <> public.current_business_id() then
    raise exception 'not authorised for this business';
  end if;

  -- Tell the status trigger to stand down: this function settles the stock itself, and letting both
  -- act on the same save would move it twice.
  perform set_config('itrova.in_save_invoice', '1', true);

  if v_is_edit then
    select status into v_old_status from public.invoices where id = v_invoice_id;
  end if;
  -- What the invoice will BE after this save (an edit keeps its status unless one was sent).
  v_eff_status := case when v_is_edit and not v_status_given then v_old_status else v_status end;
  v_holds_new  := public._invoice_holds_stock(v_eff_status);
  v_holds_old  := v_is_edit and public._invoice_holds_stock(v_old_status);

  -- Apply the net per-product stock delta (desired − already-committed). delta > 0 deducts (with an
  -- oversell guard that blocks the whole save), delta < 0 returns stock. Custom lines (null product) skip.
  for v_row in
    with desired as (
      select (e->>'product_id')::uuid as product_id, sum((e->>'quantity')::numeric) as qty
      from jsonb_array_elements(_payload->'items') e
      where nullif(e->>'product_id', '') is not null
        and v_holds_new                     -- a draft reserves nothing
      group by 1
    ),
    current_q as (
      select product_id, sum(qty) as qty from (
        -- POS invoice edit: reconcile against the sale's items
        select si.product_id, si.quantity as qty
          from public.sale_items si
         where v_is_edit and v_sale_id is not null and si.sale_id = v_sale_id
        union all
        -- Manual invoice edit: reconcile against the invoice's own inventory lines
        select ii.product_id, ii.quantity
          from public.invoice_items ii
         where v_is_edit and v_sale_id is null and ii.invoice_id = v_invoice_id and ii.product_id is not null
      ) s
      where v_holds_old                     -- it was a draft, so nothing is committed yet
      group by 1
    )
    select coalesce(d.product_id, c.product_id) as product_id,
           coalesce(d.qty, 0) - coalesce(c.qty, 0) as delta
    from desired d full outer join current_q c on c.product_id = d.product_id
  loop
    if coalesce(v_row.delta, 0) = 0 then continue; end if;
    if v_row.delta > 0 then
      update public.products
         set stock_quantity = stock_quantity - v_row.delta
       where id = v_row.product_id and business_id = v_business_id and stock_quantity >= v_row.delta;
      if not found then
        select name into v_name from public.products where id = v_row.product_id;
        raise exception 'INSUFFICIENT_STOCK:%', coalesce(v_name, 'an item') using errcode = 'check_violation';
      end if;
    else
      update public.products
         set stock_quantity = stock_quantity + (-v_row.delta)
       where id = v_row.product_id and business_id = v_business_id;
    end if;
  end loop;

  -- ---- Invoice header
  if not v_is_edit then
    v_number := coalesce(nullif(_payload->>'invoice_number', ''), public.next_invoice_number(v_business_id));
    insert into public.invoices (business_id, invoice_number, customer_name, customer_phone, customer_email,
        notes, due_date, status, subtotal, discount_amount, tax, total, created_by, issue_date)
    values (v_business_id, v_number, _payload->>'customer_name', nullif(_payload->>'customer_phone', ''),
        nullif(_payload->>'customer_email', ''), nullif(_payload->>'notes', ''), nullif(_payload->>'due_date', '')::date,
        v_status, (_payload->>'subtotal')::numeric, coalesce((_payload->>'discount')::numeric, 0),
        coalesce((_payload->>'tax')::numeric, 0), (_payload->>'total')::numeric,
        nullif(_payload->>'created_by', '')::uuid, coalesce(nullif(_payload->>'issue_date', '')::date, current_date))
    returning id, invoice_number into v_invoice_id, v_number;
  else
    update public.invoices set
      customer_name   = _payload->>'customer_name',
      customer_phone  = nullif(_payload->>'customer_phone', ''),
      customer_email  = nullif(_payload->>'customer_email', ''),
      notes           = nullif(_payload->>'notes', ''),
      due_date        = nullif(_payload->>'due_date', '')::date,
      subtotal        = (_payload->>'subtotal')::numeric,
      discount_amount = coalesce((_payload->>'discount')::numeric, 0),
      tax             = coalesce((_payload->>'tax')::numeric, 0),
      total           = (_payload->>'total')::numeric,
      -- Only when the caller sent one, so editing a paid invoice can't silently demote it.
      status          = case when v_status_given then v_status else status end
    where id = v_invoice_id and business_id = v_business_id
    returning invoice_number into v_number;
    if v_number is null then raise exception 'invoice not found'; end if;
  end if;

  -- ---- Line items (replace-in-full). unit_cost snapshots the product's current cost for COGS.
  delete from public.invoice_items where invoice_id = v_invoice_id;
  insert into public.invoice_items (invoice_id, product_id, description, quantity, unit_price, line_total, unit_cost)
  select v_invoice_id, nullif(e->>'product_id', '')::uuid, e->>'description',
         (e->>'quantity')::numeric, (e->>'unit_price')::numeric,
         (e->>'quantity')::numeric * (e->>'unit_price')::numeric,
         coalesce(p.cost_price, 0)
  from jsonb_array_elements(_payload->'items') e
  left join public.products p on p.id = nullif(e->>'product_id', '')::uuid and p.business_id = v_business_id;

  -- ---- POS invoice: mirror the quantity changes onto the sale so Reports + the sale journal stay right.
  if v_is_edit and v_sale_id is not null then
    update public.sale_items si
       set quantity = d.qty
      from (
        select (e->>'product_id')::uuid as product_id, sum((e->>'quantity')::numeric) as qty
        from jsonb_array_elements(_payload->'items') e
        where nullif(e->>'product_id', '') is not null
        group by 1
      ) d
     where si.sale_id = v_sale_id and si.product_id = d.product_id;
    update public.sales set
       total_amount    = (_payload->>'total')::numeric,
       discount_amount = coalesce((_payload->>'discount')::numeric, 0),
       tax_amount      = coalesce((_payload->>'tax')::numeric, 0)
     where id = v_sale_id and business_id = v_business_id;
    -- Reverse & repost the sale's ledger entry from the new figures (never let it fail the save).
    begin
      delete from public.journal_entries where business_id = v_business_id and source = 'sale' and source_id = v_sale_id;
      perform public.post_sale_journal(v_business_id, v_sale_id);
    exception when others then null; end;
  end if;

  return jsonb_build_object('invoice_id', v_invoice_id, 'invoice_number', v_number, 'status', v_eff_status);
end;
$$;

-- ---------------------------------------------------------------- 3. status changes move stock too
-- The status dropdown writes `invoices.status` directly, so the stock rule has to live here as well
-- as in save_invoice. Replaces reverse_invoice_stock_on_void, which only handled the → void case and
-- would now over-credit a draft that never held stock.
create or replace function public.sync_invoice_stock_on_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare item record; v_name text;
begin
  -- save_invoice settles its own stock; don't apply it twice.
  if coalesce(current_setting('itrova.in_save_invoice', true), '') = '1' then return NEW; end if;
  -- POS invoices belong to reverse_sale_on_void, which also returns raw materials via the BOM.
  if NEW.sale_id is not null then return NEW; end if;
  -- Only a change in whether stock is HELD matters (issued→paid moves nothing).
  if public._invoice_holds_stock(OLD.status) = public._invoice_holds_stock(NEW.status) then return NEW; end if;

  if public._invoice_holds_stock(NEW.status) then
    -- draft → issued: take the stock now, with the same oversell guard as a save.
    for item in select product_id, quantity from public.invoice_items
                 where invoice_id = NEW.id and product_id is not null loop
      update public.products set stock_quantity = stock_quantity - item.quantity
       where id = item.product_id and stock_quantity >= item.quantity;
      if not found then
        select name into v_name from public.products where id = item.product_id;
        raise exception 'INSUFFICIENT_STOCK:%', coalesce(v_name, 'an item') using errcode = 'check_violation';
      end if;
    end loop;
  else
    -- issued → draft, or → void: give it back.
    for item in select product_id, quantity from public.invoice_items
                 where invoice_id = NEW.id and product_id is not null loop
      update public.products set stock_quantity = stock_quantity + item.quantity where id = item.product_id;
    end loop;
  end if;
  return NEW;
end $$;

drop trigger if exists trg_reverse_invoice_stock_on_void on public.invoices;
drop function if exists public.reverse_invoice_stock_on_void();
drop trigger if exists trg_sync_invoice_stock_on_status on public.invoices;
create trigger trg_sync_invoice_stock_on_status after update of status on public.invoices
  for each row when (OLD.status is distinct from NEW.status)
  execute function public.sync_invoice_stock_on_status();

notify pgrst, 'reload schema';
