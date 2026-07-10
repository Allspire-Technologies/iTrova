-- Landed cost v2: per-line allocation basis (value/weight) + a valuation method.
--   businesses.valuation_method — 'moving_average' (default) blends new landed cost with stock on
--     hand; 'last_cost' keeps the v1 behaviour (value the whole line at the latest landed unit cost).
--   products.weight / raw_materials.weight — per-unit weight, used to allocate weight-basis landed
--     costs (freight) across a PO's lines. Landed-cost lines carry an optional "basis" in the jsonb.

alter table public.businesses
  add column if not exists valuation_method text not null default 'moving_average'
  check (valuation_method in ('last_cost', 'moving_average'));

alter table public.products      add column if not exists weight numeric;
alter table public.raw_materials add column if not exists weight numeric;

notify pgrst, 'reload schema';
