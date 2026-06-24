-- Restock an order's items whenever it leaves a fulfilled state (shipped/delivered)
-- back to pending OR cancelled — so "un-shipping" a mistaken order also returns the
-- stock, not just cancelling. The stock_deducted flag guards against restocking twice.
CREATE OR REPLACE FUNCTION public.restock_on_order_cancel()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE item RECORD;
BEGIN
  IF NEW.status IN ('pending', 'cancelled') AND COALESCE(OLD.stock_deducted, false) = true THEN
    FOR item IN SELECT product_id, quantity FROM public.order_items WHERE order_id = NEW.id LOOP
      UPDATE public.products
        SET stock_quantity = stock_quantity + item.quantity
        WHERE id = item.product_id;
      UPDATE public.raw_materials rm
        SET stock_quantity = rm.stock_quantity + (pm.quantity_per_unit * item.quantity)
        FROM public.product_materials pm
        WHERE pm.product_id = item.product_id AND pm.raw_material_id = rm.id;
    END LOOP;
    NEW.stock_deducted := false;
  END IF;
  RETURN NEW;
END;
$$;
