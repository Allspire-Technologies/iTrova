
-- INVOICES
CREATE TABLE public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL,
  sale_id UUID REFERENCES public.sales(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL DEFAULT 'Walk-in customer',
  customer_phone TEXT,
  customer_email TEXT,
  status TEXT NOT NULL DEFAULT 'issued',
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, invoice_number)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoices TO authenticated;
GRANT ALL ON public.invoices TO service_role;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invoices_select" ON public.invoices FOR SELECT TO authenticated
  USING (business_id = public.current_business_id());
CREATE POLICY "invoices_insert" ON public.invoices FOR INSERT TO authenticated
  WITH CHECK (business_id = public.current_business_id());
CREATE POLICY "invoices_update" ON public.invoices FOR UPDATE TO authenticated
  USING (business_id = public.current_business_id());
CREATE POLICY "invoices_delete" ON public.invoices FOR DELETE TO authenticated
  USING (business_id = public.current_business_id());

CREATE TRIGGER trg_invoices_updated_at BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- INVOICE ITEMS
CREATE TABLE public.invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity NUMERIC(12,2) NOT NULL DEFAULT 1,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(12,2) NOT NULL DEFAULT 0
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_items TO authenticated;
GRANT ALL ON public.invoice_items TO service_role;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invoice_items_all" ON public.invoice_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_id AND i.business_id = public.current_business_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_id AND i.business_id = public.current_business_id()));

-- PURCHASE ORDERS
CREATE TABLE public.purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  po_number TEXT NOT NULL,
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  expected_date DATE,
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  received_at TIMESTAMPTZ,
  UNIQUE (business_id, po_number)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_orders TO authenticated;
GRANT ALL ON public.purchase_orders TO service_role;
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "po_select" ON public.purchase_orders FOR SELECT TO authenticated
  USING (business_id = public.current_business_id());
CREATE POLICY "po_insert" ON public.purchase_orders FOR INSERT TO authenticated
  WITH CHECK (business_id = public.current_business_id());
CREATE POLICY "po_update" ON public.purchase_orders FOR UPDATE TO authenticated
  USING (business_id = public.current_business_id());
CREATE POLICY "po_delete" ON public.purchase_orders FOR DELETE TO authenticated
  USING (business_id = public.current_business_id());

CREATE TRIGGER trg_po_updated_at BEFORE UPDATE ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- PO ITEMS
CREATE TABLE public.purchase_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  raw_material_id UUID REFERENCES public.raw_materials(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity NUMERIC(12,2) NOT NULL DEFAULT 1,
  unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(12,2) NOT NULL DEFAULT 0
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_order_items TO authenticated;
GRANT ALL ON public.purchase_order_items TO service_role;
ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "po_items_all" ON public.purchase_order_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.purchase_orders p WHERE p.id = purchase_order_id AND p.business_id = public.current_business_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.purchase_orders p WHERE p.id = purchase_order_id AND p.business_id = public.current_business_id()));

-- Auto-numbering helper
CREATE OR REPLACE FUNCTION public.next_doc_number(_business_id UUID, _prefix TEXT, _table TEXT, _col TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_n INT;
  result TEXT;
BEGIN
  EXECUTE format(
    'SELECT COALESCE(MAX(NULLIF(regexp_replace(%I, ''^%s-'', ''''), '''')::INT), 0) + 1 FROM public.%I WHERE business_id = $1 AND %I LIKE $2',
    _col, _prefix, _table, _col
  ) INTO next_n USING _business_id, _prefix || '-%';
  result := _prefix || '-' || lpad(next_n::TEXT, 4, '0');
  RETURN result;
END;
$$;

-- Auto-create invoice when a sale is recorded
CREATE OR REPLACE FUNCTION public.create_invoice_from_sale()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_invoice_id UUID;
  inv_num TEXT;
BEGIN
  inv_num := public.next_doc_number(NEW.business_id, 'INV', 'invoices', 'invoice_number');
  INSERT INTO public.invoices (business_id, invoice_number, sale_id, status, subtotal, total)
  VALUES (NEW.business_id, inv_num, NEW.id, 'paid', NEW.total_amount, NEW.total_amount)
  RETURNING id INTO new_invoice_id;

  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, line_total)
  SELECT new_invoice_id,
         COALESCE(p.name, 'Item'),
         si.quantity,
         si.unit_price,
         si.quantity * si.unit_price
  FROM public.sale_items si
  LEFT JOIN public.products p ON p.id = si.product_id
  WHERE si.sale_id = NEW.id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_create_invoice_from_sale
AFTER INSERT ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.create_invoice_from_sale();

-- When PO marked received, add stock via material_purchases
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
      END IF;
    END LOOP;
    NEW.received_at := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_receive_purchase_order
BEFORE UPDATE ON public.purchase_orders
FOR EACH ROW EXECUTE FUNCTION public.receive_purchase_order();
