-- Landed cost: freight, duty and other costs (clearing, insurance, handling…) that capitalise into
-- inventory value on top of the supplier's unit price. Stored as an itemized list per PO / delivery.
-- `material_purchases.landed_total` is the sum (direct deliveries) or the by-value allocated share
-- (PO receipts) that the cost trigger reads to value stock at the landed unit cost.

alter table public.purchase_orders
  add column if not exists landed_costs jsonb not null default '[]'::jsonb;

alter table public.material_purchases
  add column if not exists landed_costs jsonb not null default '[]'::jsonb,
  add column if not exists landed_total numeric not null default 0;

notify pgrst, 'reload schema';
