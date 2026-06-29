-- Sync a manual invoice that was created offline. Mirrors commit_offline_sale but with no stock/
-- sale rows — just the invoice + its line items. Idempotent on the client-supplied invoice id so a
-- replayed queue entry returns 'duplicate' instead of a second invoice. Deposits captured offline
-- sync separately (record_invoice_payment) AFTER this runs, since they reference the invoice id.

create or replace function public.commit_offline_invoice(_invoice jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_id uuid := (_invoice->>'business_id')::uuid;
  v_invoice_id  uuid := (_invoice->>'invoice_id')::uuid;
  v_created_at  timestamptz := coalesce((_invoice->>'created_at')::timestamptz, now());
begin
  if v_business_id is null or v_business_id <> public.current_business_id() then
    raise exception 'not authorised for this business';
  end if;

  if exists (select 1 from public.invoices where id = v_invoice_id) then
    return jsonb_build_object('status', 'duplicate', 'invoice_id', v_invoice_id);
  end if;

  insert into public.invoices (id, business_id, invoice_number, customer_name, customer_phone,
                               customer_email, due_date, notes, status, subtotal, total,
                               created_by, issue_date, created_at)
  values (v_invoice_id, v_business_id, _invoice->>'invoice_number',
          coalesce(_invoice->>'customer_name', 'Walk-in Customer'),
          nullif(_invoice->>'customer_phone', ''), nullif(_invoice->>'customer_email', ''),
          nullif(_invoice->>'due_date', '')::date, nullif(_invoice->>'notes', ''),
          'issued', (_invoice->>'subtotal')::numeric, (_invoice->>'total')::numeric,
          auth.uid(), (v_created_at)::date, v_created_at);

  insert into public.invoice_items (invoice_id, description, quantity, unit_price, line_total)
  select v_invoice_id, e->>'description', (e->>'quantity')::numeric, (e->>'unit_price')::numeric,
         (e->>'quantity')::numeric * (e->>'unit_price')::numeric
  from jsonb_array_elements(_invoice->'items') as e;

  return jsonb_build_object('status', 'committed', 'invoice_id', v_invoice_id,
                            'invoice_number', _invoice->>'invoice_number');
end;
$$;

revoke all on function public.commit_offline_invoice(jsonb) from public, anon;
grant execute on function public.commit_offline_invoice(jsonb) to authenticated;
