-- Fix "permission denied for table export_invoices": RLS controls which rows are visible, but the
-- authenticated role still needs table-level privileges. Grant them (row access stays gated by the
-- policies from 20260703160000). Inserts flow through the SECURITY DEFINER create_export_invoice RPC,
-- but the list/re-download reads the table directly, so SELECT is required.
grant select, insert, update, delete on public.export_invoices to authenticated;
