-- Input VAT on the buying side: capture the VAT charged by suppliers so Reports' Net VAT nets it off
-- output VAT. Two procurement paths carry it — direct material purchases and purchase orders — each
-- as an "of which VAT" amount taken straight from the supplier's invoice (not a computed rate).
alter table public.material_purchases
  add column if not exists tax_amount numeric not null default 0;

alter table public.purchase_orders
  add column if not exists tax_amount numeric not null default 0;

notify pgrst, 'reload schema';
