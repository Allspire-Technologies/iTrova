-- Hot-path indexes. RLS scopes every read on these tables by business_id, yet none of them had an
-- index on it, so each Dashboard/Reports/list query scanned every tenant's rows. Child tables get
-- their join key. Plain CREATE INDEX (not CONCURRENTLY) so the file runs as one batch in the SQL editor.

create index if not exists sales_business_created_idx on public.sales (business_id, created_at desc);
create index if not exists sale_items_sale_idx on public.sale_items (sale_id);
create index if not exists sale_items_product_idx on public.sale_items (product_id);

create index if not exists invoices_business_status_idx on public.invoices (business_id, status);
create index if not exists invoices_business_issue_date_idx on public.invoices (business_id, issue_date desc);
create index if not exists invoices_sale_idx on public.invoices (sale_id) where sale_id is not null;
create index if not exists invoice_items_invoice_idx on public.invoice_items (invoice_id);

create index if not exists stock_adjustments_business_created_idx on public.stock_adjustments (business_id, created_at desc);
create index if not exists stock_adjustments_product_idx on public.stock_adjustments (product_id) where product_id is not null;
create index if not exists stock_adjustments_raw_material_idx on public.stock_adjustments (raw_material_id) where raw_material_id is not null;

create index if not exists purchase_orders_business_created_idx on public.purchase_orders (business_id, created_at desc);
create index if not exists purchase_order_items_po_idx on public.purchase_order_items (purchase_order_id);
create index if not exists material_purchases_business_created_idx on public.material_purchases (business_id, created_at desc);

create index if not exists raw_materials_business_idx on public.raw_materials (business_id);
create index if not exists suppliers_business_idx on public.suppliers (business_id);
create index if not exists profiles_business_idx on public.profiles (business_id);
create index if not exists user_roles_business_idx on public.user_roles (business_id);
