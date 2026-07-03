-- Fix "permission denied for function create_export_invoice": ensure the authenticated role can
-- execute the export-invoice functions. Idempotent — safe to re-run. (These grants also live in the
-- migrations that define the functions; this standalone migration guarantees them if an earlier
-- migration was only partially applied.)
grant execute on function public.create_export_invoice(jsonb) to authenticated;
grant execute on function public.next_export_invoice_number(uuid) to authenticated;
