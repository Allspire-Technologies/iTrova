-- Deduct order stock when an order is fulfilled — whether it goes through 'shipped'
-- or jumps straight to 'delivered'. The stock_deducted flag still guards against
-- deducting twice (e.g. shipped -> delivered).
CREATE OR REPLACE FUNCTION public.deduct_stock_on_ship()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE item RECORD;
BEGIN
  IF NEW.status IN ('shipped', 'delivered') AND NEW.stock_deducted = false THEN
    FOR item IN SELECT product_id, quantity FROM public.order_items WHERE order_id = NEW.id LOOP
      UPDATE public.products SET stock_quantity = stock_quantity - item.quantity WHERE id = item.product_id;
      PERFORM public.deduct_raw_materials_for_product(item.product_id, item.quantity);
    END LOOP;
    NEW.stock_deducted := true;
  END IF;
  RETURN NEW;
END;
$$;
