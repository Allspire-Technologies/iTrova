-- Opening balances for the Balance Sheet. iTrova isn't a double-entry ledger, so the two anchors a
-- balance sheet needs — cash on hand/bank and owner's capital, as of a start date — are entered once
-- by the owner. Current cash = opening_cash + net cash movement since books_opening_date; equity =
-- opening_capital + retained earnings (accumulated net profit) since that date.
alter table public.businesses add column if not exists opening_cash        numeric;
alter table public.businesses add column if not exists opening_capital     numeric;
alter table public.businesses add column if not exists books_opening_date  date;

notify pgrst, 'reload schema';
