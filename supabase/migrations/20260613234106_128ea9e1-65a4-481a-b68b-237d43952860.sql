
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS onboarded boolean NOT NULL DEFAULT false;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS rating smallint;
ALTER TABLE public.suppliers ADD CONSTRAINT suppliers_rating_range CHECK (rating IS NULL OR (rating BETWEEN 1 AND 5));

CREATE TABLE IF NOT EXISTS public.stock_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  raw_material_id uuid REFERENCES public.raw_materials(id) ON DELETE CASCADE,
  delta numeric NOT NULL,
  reason text NOT NULL,
  notes text,
  user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((product_id IS NOT NULL)::int + (raw_material_id IS NOT NULL)::int = 1)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_adjustments TO authenticated;
GRANT ALL ON public.stock_adjustments TO service_role;

ALTER TABLE public.stock_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stock_adj_select" ON public.stock_adjustments FOR SELECT TO authenticated
  USING (business_id = public.current_business_id());
CREATE POLICY "stock_adj_insert" ON public.stock_adjustments FOR INSERT TO authenticated
  WITH CHECK (business_id = public.current_business_id());
CREATE POLICY "stock_adj_delete" ON public.stock_adjustments FOR DELETE TO authenticated
  USING (business_id = public.current_business_id());
