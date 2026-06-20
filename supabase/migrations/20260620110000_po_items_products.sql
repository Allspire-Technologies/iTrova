-- Purchase-order line items can now reference an Inventory product, in addition to a
-- raw material. When a PO is marked "received", product lines increment product stock
-- (and log a stock adjustment for traceability), mirroring how raw-material lines
-- increment raw-material stock via material_purchases.

ALTER TABLE public.purchase_order_items
  ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES public.products(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.receive_purchase_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE item RECORD;
BEGIN
  IF NEW.status = 'received' AND COALESCE(OLD.status,'') <> 'received' THEN
    FOR item IN SELECT * FROM public.purchase_order_items WHERE purchase_order_id = NEW.id LOOP
      IF item.raw_material_id IS NOT NULL THEN
        INSERT INTO public.material_purchases (business_id, raw_material_id, supplier_id, quantity, unit_cost, total_cost, notes)
        VALUES (NEW.business_id, item.raw_material_id, NEW.supplier_id, item.quantity, item.unit_cost, item.line_total, 'PO ' || NEW.po_number);
      ELSIF item.product_id IS NOT NULL THEN
        UPDATE public.products
          SET stock_quantity = stock_quantity + item.quantity
          WHERE id = item.product_id;
        INSERT INTO public.stock_adjustments (business_id, product_id, delta, reason, notes)
        VALUES (NEW.business_id, item.product_id, item.quantity, 'Purchase order received', 'PO ' || NEW.po_number);
      END IF;
    END LOOP;
    NEW.received_at := now();
  END IF;
  RETURN NEW;
END;
$$;
