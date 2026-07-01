-- Order-level discount, mirroring invoices.discount_amount. The stored total_amount is net of
-- the discount (subtotal - discount), same convention as invoices.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS discount_amount NUMERIC NOT NULL DEFAULT 0;
