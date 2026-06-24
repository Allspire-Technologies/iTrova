-- When an order is cancelled after its stock was deducted (on shipping), return the
-- stock (products + raw materials per BOM) and clear the flag — mirroring the
-- invoice-void reversal. Cancel from a never-shipped order is a no-op for stock.
CREATE OR REPLACE FUNCTION public.restock_on_order_cancel()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE item RECORD;
BEGIN
  IF NEW.status = 'cancelled' AND COALESCE(OLD.status, '') <> 'cancelled' AND OLD.stock_deducted = true THEN
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

DROP TRIGGER IF EXISTS trg_restock_on_order_cancel ON public.orders;
CREATE TRIGGER trg_restock_on_order_cancel
BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.restock_on_order_cancel();
