
-- Phase 2: Suppliers, Raw Materials, BOM links

CREATE TABLE public.suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  name TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "biz members view suppliers" ON public.suppliers FOR SELECT USING (business_id = current_business_id());
CREATE POLICY "biz members insert suppliers" ON public.suppliers FOR INSERT WITH CHECK (business_id = current_business_id());
CREATE POLICY "biz members update suppliers" ON public.suppliers FOR UPDATE USING (business_id = current_business_id());
CREATE POLICY "biz members delete suppliers" ON public.suppliers FOR DELETE USING (business_id = current_business_id());
CREATE TRIGGER suppliers_set_updated_at BEFORE UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.raw_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  sku TEXT,
  unit TEXT NOT NULL DEFAULT 'kg',
  stock_quantity NUMERIC NOT NULL DEFAULT 0,
  reorder_level NUMERIC NOT NULL DEFAULT 5,
  cost_per_unit NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.raw_materials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "biz members view raw_materials" ON public.raw_materials FOR SELECT USING (business_id = current_business_id());
CREATE POLICY "biz members insert raw_materials" ON public.raw_materials FOR INSERT WITH CHECK (business_id = current_business_id());
CREATE POLICY "biz members update raw_materials" ON public.raw_materials FOR UPDATE USING (business_id = current_business_id());
CREATE POLICY "biz members delete raw_materials" ON public.raw_materials FOR DELETE USING (business_id = current_business_id());
CREATE TRIGGER raw_materials_set_updated_at BEFORE UPDATE ON public.raw_materials FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Bill of materials: how much raw material each product consumes per unit
CREATE TABLE public.product_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  raw_material_id UUID NOT NULL REFERENCES public.raw_materials(id) ON DELETE CASCADE,
  quantity_per_unit NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(product_id, raw_material_id)
);
ALTER TABLE public.product_materials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "biz members view product_materials" ON public.product_materials FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.products p WHERE p.id = product_materials.product_id AND p.business_id = current_business_id())
);
CREATE POLICY "biz members insert product_materials" ON public.product_materials FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.products p WHERE p.id = product_materials.product_id AND p.business_id = current_business_id())
);
CREATE POLICY "biz members update product_materials" ON public.product_materials FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.products p WHERE p.id = product_materials.product_id AND p.business_id = current_business_id())
);
CREATE POLICY "biz members delete product_materials" ON public.product_materials FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.products p WHERE p.id = product_materials.product_id AND p.business_id = current_business_id())
);

-- Raw material purchase log (received from suppliers, increments stock)
CREATE TABLE public.material_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  raw_material_id UUID NOT NULL REFERENCES public.raw_materials(id) ON DELETE CASCADE,
  quantity NUMERIC NOT NULL,
  unit_cost NUMERIC NOT NULL DEFAULT 0,
  total_cost NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.material_purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "biz members view material_purchases" ON public.material_purchases FOR SELECT USING (business_id = current_business_id());
CREATE POLICY "biz members insert material_purchases" ON public.material_purchases FOR INSERT WITH CHECK (business_id = current_business_id());
CREATE POLICY "biz members delete material_purchases" ON public.material_purchases FOR DELETE USING (business_id = current_business_id());

-- Trigger: increment raw_material stock on purchase
CREATE OR REPLACE FUNCTION public.add_stock_on_purchase()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.raw_materials SET stock_quantity = stock_quantity + NEW.quantity WHERE id = NEW.raw_material_id;
  RETURN NEW;
END; $$;
CREATE TRIGGER material_purchases_add_stock AFTER INSERT ON public.material_purchases
FOR EACH ROW EXECUTE FUNCTION public.add_stock_on_purchase();

-- Helper: deduct raw materials based on a product+quantity (BOM)
CREATE OR REPLACE FUNCTION public.deduct_raw_materials_for_product(_product_id UUID, _quantity NUMERIC)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.raw_materials rm
    SET stock_quantity = rm.stock_quantity - (pm.quantity_per_unit * _quantity)
  FROM public.product_materials pm
  WHERE pm.product_id = _product_id AND pm.raw_material_id = rm.id;
END; $$;

-- Trigger: when a sale_item is inserted, also deduct raw materials
CREATE OR REPLACE FUNCTION public.deduct_raw_on_sale_item()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.deduct_raw_materials_for_product(NEW.product_id, NEW.quantity);
  RETURN NEW;
END; $$;
CREATE TRIGGER sale_items_deduct_raw AFTER INSERT ON public.sale_items
FOR EACH ROW EXECUTE FUNCTION public.deduct_raw_on_sale_item();

-- Update orders trigger: when shipping, also deduct raw materials per BOM
CREATE OR REPLACE FUNCTION public.deduct_stock_on_ship()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE item RECORD;
BEGIN
  IF NEW.status = 'shipped' AND COALESCE(OLD.status,'') <> 'shipped' AND NEW.stock_deducted = false THEN
    FOR item IN SELECT product_id, quantity FROM public.order_items WHERE order_id = NEW.id LOOP
      UPDATE public.products SET stock_quantity = stock_quantity - item.quantity WHERE id = item.product_id;
      PERFORM public.deduct_raw_materials_for_product(item.product_id, item.quantity);
    END LOOP;
    NEW.stock_deducted := true;
  END IF;
  RETURN NEW;
END; $$;
