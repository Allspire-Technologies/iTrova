
REVOKE EXECUTE ON FUNCTION public.next_doc_number(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_invoice_from_sale() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.receive_purchase_order() FROM PUBLIC, anon, authenticated;
