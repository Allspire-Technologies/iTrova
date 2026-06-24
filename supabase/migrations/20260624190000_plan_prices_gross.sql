-- price_amount now represents the gross (pre-discount) list price for a billing cycle;
-- the plan card applies discount_percent to it to show the eventual price. Convert the
-- existing net amounts to gross so what is charged stays the same.
update public.plan_prices
set price_amount = round(price_amount / (1 - discount_percent / 100.0))
where discount_percent > 0 and discount_percent < 100;
