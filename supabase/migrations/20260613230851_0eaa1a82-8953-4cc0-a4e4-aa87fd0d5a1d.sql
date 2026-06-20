
GRANT SELECT, INSERT, UPDATE, DELETE ON public.businesses TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sale_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.suppliers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.raw_materials TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.material_purchases TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_materials TO authenticated;

GRANT ALL ON public.businesses TO service_role;
GRANT ALL ON public.profiles TO service_role;
GRANT ALL ON public.products TO service_role;
GRANT ALL ON public.sales TO service_role;
GRANT ALL ON public.sale_items TO service_role;
GRANT ALL ON public.orders TO service_role;
GRANT ALL ON public.order_items TO service_role;
GRANT ALL ON public.suppliers TO service_role;
GRANT ALL ON public.raw_materials TO service_role;
GRANT ALL ON public.material_purchases TO service_role;
GRANT ALL ON public.product_materials TO service_role;
