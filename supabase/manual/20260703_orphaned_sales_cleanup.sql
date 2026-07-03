-- Manual, review-first cleanup for sales orphaned by past deletes.
--
-- Context: before the delete_invoice / delete_order RPCs, deleting a POS invoice (or a delivered
-- order) removed the invoice but left its `sales` row with voided = false, so it kept counting on the
-- dashboard and in reports. This script finds and (optionally) voids those leftovers.
--
-- DO NOT run this blindly. The `sales` table predates the `invoices` table (2026-05-02 vs
-- 2026-06-13), so a sale with no invoice can ALSO be a legitimate pre-invoicing sale. Run STEP 1,
-- eyeball the dates/amounts, and only void the rows you recognise as delete leftovers.

-- STEP 1 — REVIEW. Non-voided sales with no invoice pointing at them, newest first.
-- Recent rows (after you started using invoices) are the delete leftovers; very old rows are likely
-- genuine pre-invoicing sales you should keep.
select s.id,
       s.created_at,
       s.total_amount,
       s.payment_method
from public.sales s
where s.voided = false
  and not exists (select 1 from public.invoices i where i.sale_id = s.id)
order by s.created_at desc;

-- STEP 2 — VOID the confirmed leftovers. Prefer listing the exact ids you verified in STEP 1:
--
--   update public.sales set voided = true
--   where id in ('<id-1>', '<id-2>');
--
-- Or, if you are confident every invoice-less sale after a cutoff date is a delete leftover, bound it
-- by date (adjust the cutoff to when you began invoicing):
--
--   update public.sales s
--   set voided = true
--   where s.voided = false
--     and s.created_at >= '2026-06-13'
--     and not exists (select 1 from public.invoices i where i.sale_id = s.id);
--
-- Voiding drops the sale from the dashboard/reports. Stock is left untouched — those goods left
-- inventory when the sale was made and were never returned; adjust stock manually if you want them back.
