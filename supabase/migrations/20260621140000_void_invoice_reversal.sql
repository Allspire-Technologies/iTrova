ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS voided boolean NOT NULL DEFAULT false;

-- When a POS invoice is voided, return the sold stock (products + raw materials per
-- BOM) and flag the sale so it drops out of revenue reporting.
CREATE OR REPLACE FUNCTION public.reverse_sale_on_void()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE item RECORD;
BEGIN
  IF NEW.status = 'void' AND COALESCE(OLD.status, '') <> 'void' AND NEW.sale_id IS NOT NULL THEN
    FOR item IN SELECT product_id, quantity FROM public.sale_items WHERE sale_id = NEW.sale_id LOOP
      UPDATE public.products
        SET stock_quantity = stock_quantity + item.quantity
        WHERE id = item.product_id;
      UPDATE public.raw_materials rm
        SET stock_quantity = rm.stock_quantity + (pm.quantity_per_unit * item.quantity)
        FROM public.product_materials pm
        WHERE pm.product_id = item.product_id AND pm.raw_material_id = rm.id;
    END LOOP;
    UPDATE public.sales SET voided = true WHERE id = NEW.sale_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reverse_sale_on_void ON public.invoices;
CREATE TRIGGER trg_reverse_sale_on_void
AFTER UPDATE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.reverse_sale_on_void();
