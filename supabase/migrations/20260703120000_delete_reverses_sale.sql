-- Deleting a transaction must reverse the sale behind it.
--
-- Bug: a POS sale (and a delivered order) creates a `sales` row + a paid `invoices` row. The
-- dashboard/reports count `sales` where voided = false. Voiding an invoice runs
-- `reverse_sale_on_void` (returns stock + sets sales.voided = true), but *deleting* the invoice only
-- removed the invoice row — the sale stayed voided = false, so it kept counting and its stock was
-- never returned. Same for deleting a delivered order.
--
-- Fix: route deletes through RPCs that reverse the sale first. We reuse the existing
-- `reverse_sale_on_void` trigger (fired by flipping status -> 'void') so the restock math stays in
-- one place, then remove the invoice and the now-reversed sale. Reversing per `sale_items` is correct
-- for both POS sales and delivered-order sales, because `deliver_order` copies `order_items` into
-- `sale_items` verbatim and the deducted quantities are identical.

-- Delete an invoice, reversing its linked sale (return stock + drop it from totals) when present.
create or replace function public.delete_invoice(_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv     record;
  v_sale_id uuid;
begin
  select * into v_inv from public.invoices where id = _invoice_id;
  if not found then raise exception 'invoice not found'; end if;
  if v_inv.business_id is null or v_inv.business_id <> public.current_business_id() then
    raise exception 'not authorised for this business';
  end if;

  v_sale_id := v_inv.sale_id;

  -- Reverse the sale's stock by voiding first (fires reverse_sale_on_void: restock + sales.voided).
  -- Skip when already void — stock has already been returned, and re-voiding would not re-trigger.
  if v_sale_id is not null and coalesce(v_inv.status, '') <> 'void' then
    update public.invoices set status = 'void' where id = _invoice_id;
  end if;

  -- Remove the invoice (invoice_items + invoice_deposits cascade) and then the reversed sale
  -- (sale_items cascade) so it stops counting entirely. An order pointing at this invoice has its
  -- invoice_id set null by the FK.
  delete from public.invoices where id = _invoice_id;
  if v_sale_id is not null then
    delete from public.sales where id = v_sale_id;
  end if;
end;
$$;

revoke all on function public.delete_invoice(uuid) from public, anon;
grant execute on function public.delete_invoice(uuid) to authenticated;

-- Delete an order, reversing whatever stock it holds. A delivered order carries a sale/invoice, so we
-- reverse+delete those (which returns the stock the order deducted). A shipped-but-never-invoiced
-- order deducted stock with no sale behind it, so return it directly. A pending order holds no stock.
create or replace function public.delete_order(_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_item  record;
begin
  select * into v_order from public.orders where id = _order_id;
  if not found then raise exception 'order not found'; end if;
  if v_order.business_id is null or v_order.business_id <> public.current_business_id() then
    raise exception 'not authorised for this business';
  end if;

  if v_order.invoice_id is not null then
    -- Delivered: reverse + remove the sale/invoice. delete_invoice restocks per sale_items, which
    -- equals this order's order_items, so the order's deducted stock is returned exactly once.
    perform public.delete_invoice(v_order.invoice_id);
  elsif v_order.stock_deducted then
    -- Shipped, never invoiced: return the products + raw materials (BOM) this order took out.
    for v_item in select product_id, quantity from public.order_items where order_id = _order_id loop
      update public.products
        set stock_quantity = stock_quantity + v_item.quantity
        where id = v_item.product_id;
      update public.raw_materials rm
        set stock_quantity = rm.stock_quantity + (pm.quantity_per_unit * v_item.quantity)
        from public.product_materials pm
        where pm.product_id = v_item.product_id and pm.raw_material_id = rm.id;
    end loop;
  end if;

  delete from public.orders where id = _order_id; -- order_items cascade
end;
$$;

revoke all on function public.delete_order(uuid) from public, anon;
grant execute on function public.delete_order(uuid) to authenticated;

-- NOTE: cleanup of already-orphaned sales is intentionally NOT run here. Sales predate the invoices
-- table (2026-05-02 vs 2026-06-13), so "any sale without an invoice" also matches legitimate
-- pre-invoicing sales — voiding those would erase real historical revenue. Use the review-first
-- script in supabase/manual/20260703_orphaned_sales_cleanup.sql instead.
