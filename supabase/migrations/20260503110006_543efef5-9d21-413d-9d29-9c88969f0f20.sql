-- Orders table
CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  staff_id UUID,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  channel TEXT NOT NULL DEFAULT 'online', -- online | phone
  payment_method TEXT NOT NULL DEFAULT 'cash',
  status TEXT NOT NULL DEFAULT 'pending', -- pending | shipped | delivered | cancelled
  notes TEXT,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  stock_deducted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "biz members view orders" ON public.orders
  FOR SELECT USING (business_id = public.current_business_id());
CREATE POLICY "biz members insert orders" ON public.orders
  FOR INSERT WITH CHECK (business_id = public.current_business_id());
CREATE POLICY "biz members update orders" ON public.orders
  FOR UPDATE USING (business_id = public.current_business_id());
CREATE POLICY "biz members delete orders" ON public.orders
  FOR DELETE USING (business_id = public.current_business_id());

-- Order items
CREATE TABLE public.order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL,
  quantity NUMERIC NOT NULL,
  unit_price NUMERIC NOT NULL
);

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "biz members view order_items" ON public.order_items
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_items.order_id AND o.business_id = public.current_business_id()));
CREATE POLICY "biz members insert order_items" ON public.order_items
  FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_items.order_id AND o.business_id = public.current_business_id()));
CREATE POLICY "biz members update order_items" ON public.order_items
  FOR UPDATE USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_items.order_id AND o.business_id = public.current_business_id()));
CREATE POLICY "biz members delete order_items" ON public.order_items
  FOR DELETE USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_items.order_id AND o.business_id = public.current_business_id()));

-- Updated-at trigger function (reusable)
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER orders_set_updated_at
BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Deduct stock when order becomes shipped (only once)
CREATE OR REPLACE FUNCTION public.deduct_stock_on_ship()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE item RECORD;
BEGIN
  IF NEW.status = 'shipped' AND COALESCE(OLD.status,'') <> 'shipped' AND NEW.stock_deducted = false THEN
    FOR item IN SELECT product_id, quantity FROM public.order_items WHERE order_id = NEW.id LOOP
      UPDATE public.products
        SET stock_quantity = stock_quantity - item.quantity
        WHERE id = item.product_id;
    END LOOP;
    NEW.stock_deducted := true;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER orders_deduct_stock
BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.deduct_stock_on_ship();
