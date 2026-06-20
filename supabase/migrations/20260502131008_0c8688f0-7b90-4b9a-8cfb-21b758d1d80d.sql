
-- Profiles table (linked to auth.users)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_name TEXT NOT NULL,
  phone TEXT,
  business_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "users update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "users insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Businesses
CREATE TABLE public.businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  currency TEXT NOT NULL DEFAULT 'NGN',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owners view own business" ON public.businesses FOR SELECT USING (auth.uid() = owner_id);
CREATE POLICY "owners insert own business" ON public.businesses FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "owners update own business" ON public.businesses FOR UPDATE USING (auth.uid() = owner_id);

-- Helper: get business id for current user
CREATE OR REPLACE FUNCTION public.current_business_id()
RETURNS UUID
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT business_id FROM public.profiles WHERE id = auth.uid()
$$;

-- Products
CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT,
  sku TEXT,
  unit TEXT DEFAULT 'pcs',
  selling_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  cost_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  stock_quantity NUMERIC(12,2) NOT NULL DEFAULT 0,
  reorder_level NUMERIC(12,2) NOT NULL DEFAULT 5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "biz members view products" ON public.products FOR SELECT USING (business_id = public.current_business_id());
CREATE POLICY "biz members insert products" ON public.products FOR INSERT WITH CHECK (business_id = public.current_business_id());
CREATE POLICY "biz members update products" ON public.products FOR UPDATE USING (business_id = public.current_business_id());
CREATE POLICY "biz members delete products" ON public.products FOR DELETE USING (business_id = public.current_business_id());

-- Sales
CREATE TABLE public.sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  staff_id UUID REFERENCES auth.users(id),
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "biz members view sales" ON public.sales FOR SELECT USING (business_id = public.current_business_id());
CREATE POLICY "biz members insert sales" ON public.sales FOR INSERT WITH CHECK (business_id = public.current_business_id());

-- Sale items
CREATE TABLE public.sale_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id),
  quantity NUMERIC(12,2) NOT NULL,
  unit_price NUMERIC(12,2) NOT NULL
);
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "biz members view sale_items" ON public.sale_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.sales s WHERE s.id = sale_id AND s.business_id = public.current_business_id())
);
CREATE POLICY "biz members insert sale_items" ON public.sale_items FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.sales s WHERE s.id = sale_id AND s.business_id = public.current_business_id())
);

-- Trigger: on signup, create profile + business
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  new_business_id UUID;
BEGIN
  INSERT INTO public.businesses (name, owner_id)
  VALUES (COALESCE(NEW.raw_user_meta_data->>'business_name', 'My Business'), NEW.id)
  RETURNING id INTO new_business_id;

  INSERT INTO public.profiles (id, owner_name, phone, business_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'owner_name', 'Owner'),
    NEW.raw_user_meta_data->>'phone',
    new_business_id
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
