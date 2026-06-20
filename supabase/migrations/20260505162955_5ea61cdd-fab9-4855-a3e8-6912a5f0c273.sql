
REVOKE EXECUTE ON FUNCTION public.add_stock_on_purchase() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.deduct_raw_on_sale_item() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.deduct_raw_materials_for_product(UUID, NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.deduct_stock_on_ship() FROM PUBLIC, anon, authenticated;
