-- Deposit / partial payments on manual invoices.
-- A manual invoice (sale_id IS NULL) can receive deposits over time; when the cumulative
-- amount_paid reaches the total the invoice auto-flips to 'paid'. POS invoices (sale_id set)
-- are paid in full at sale time and are excluded. The invoice_payments ledger is the source
-- of truth; invoices.amount_paid + status are denormalised copies kept in lock-step by the
-- SECURITY DEFINER RPCs below (the only writers), so clients get read-only ledger access.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS amount_paid   NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fully_paid_at TIMESTAMPTZ;

-- Existing fully-paid invoices read as paid-in-full (balance 0).
UPDATE public.invoices SET amount_paid = total WHERE status = 'paid' AND amount_paid = 0;

-- Payment ledger ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invoice_payments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  UUID NOT NULL REFERENCES public.invoices(id)   ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  amount      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  method      TEXT NOT NULL DEFAULT 'cash',
  note        TEXT,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoice_payments_invoice_idx ON public.invoice_payments (invoice_id, created_at);

-- Read-only to clients; all writes flow through the RPCs so the denormalised
-- invoices.amount_paid + status can never drift from the ledger.
GRANT SELECT ON public.invoice_payments TO authenticated;
GRANT ALL    ON public.invoice_payments TO service_role;
ALTER TABLE public.invoice_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invoice_payments_select" ON public.invoice_payments FOR SELECT TO authenticated
  USING (business_id = public.current_business_id());

-- Record a payment ----------------------------------------------------------
-- _payment_id is client-generated so the call is idempotent: replaying a queued
-- offline deposit (PR2) returns 'duplicate' instead of double-applying.
CREATE OR REPLACE FUNCTION public.record_invoice_payment(
  _payment_id uuid, _invoice_id uuid, _amount numeric, _method text, _note text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  biz        uuid := public.current_business_id();
  inv        RECORD;
  new_paid   numeric;
  new_status text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.invoice_payments WHERE id = _payment_id) THEN
    SELECT amount_paid, status INTO new_paid, new_status FROM public.invoices WHERE id = _invoice_id;
    RETURN jsonb_build_object('status', 'duplicate', 'amount_paid', new_paid, 'invoice_status', new_status);
  END IF;

  SELECT * INTO inv FROM public.invoices WHERE id = _invoice_id;
  IF inv.id IS NULL OR inv.business_id <> biz THEN
    RAISE EXCEPTION 'not authorised for this invoice';
  END IF;
  IF inv.sale_id IS NOT NULL THEN
    RAISE EXCEPTION 'deposits apply to manual invoices only';
  END IF;
  IF inv.status NOT IN ('issued', 'partial') THEN
    RAISE EXCEPTION 'payments can only be recorded on issued invoices (status: %)', inv.status;
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'payment amount must be positive';
  END IF;
  -- Overpay guard. A balance that shrank since the client read it (e.g. another
  -- device paid first) surfaces as NEEDS_REVIEW so the offline drain can hold it.
  IF _amount > (inv.total - inv.amount_paid) THEN
    RAISE EXCEPTION 'NEEDS_REVIEW:%', inv.invoice_number USING errcode = 'check_violation';
  END IF;

  INSERT INTO public.invoice_payments (id, invoice_id, business_id, amount, method, note, created_by)
  VALUES (_payment_id, _invoice_id, biz, _amount, coalesce(nullif(_method, ''), 'cash'), nullif(_note, ''), auth.uid());

  new_paid := inv.amount_paid + _amount;
  new_status := CASE WHEN new_paid >= inv.total THEN 'paid' ELSE 'partial' END;

  UPDATE public.invoices
     SET amount_paid   = new_paid,
         status        = new_status,
         fully_paid_at = CASE WHEN new_status = 'paid' THEN now() ELSE NULL END
   WHERE id = _invoice_id;

  PERFORM public.log_invoice_edit(_invoice_id,
    'Payment ' || _amount::text || ' recorded' ||
    CASE WHEN new_status = 'paid' THEN ' · fully paid' ELSE ' · balance ' || (inv.total - new_paid)::text END);

  RETURN jsonb_build_object('status', 'committed', 'amount_paid', new_paid,
                            'balance', inv.total - new_paid, 'invoice_status', new_status);
END;
$$;

REVOKE ALL  ON FUNCTION public.record_invoice_payment(uuid, uuid, numeric, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.record_invoice_payment(uuid, uuid, numeric, text, text) TO authenticated;

-- Delete a payment (correct a mistake) --------------------------------------
-- Recomputes amount_paid from the surviving ledger rows and walks status back down.
CREATE OR REPLACE FUNCTION public.delete_invoice_payment(_payment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  biz        uuid := public.current_business_id();
  pay        RECORD;
  inv        RECORD;
  new_paid   numeric;
  new_status text;
BEGIN
  SELECT * INTO pay FROM public.invoice_payments WHERE id = _payment_id;
  IF pay.id IS NULL THEN
    RETURN jsonb_build_object('status', 'missing');  -- idempotent
  END IF;
  IF pay.business_id <> biz THEN
    RAISE EXCEPTION 'not authorised for this payment';
  END IF;

  SELECT * INTO inv FROM public.invoices WHERE id = pay.invoice_id;
  IF inv.status = 'void' THEN
    RAISE EXCEPTION 'cannot adjust payments on a void invoice';
  END IF;
  -- Once the balance is settled the invoice is closed: payments can no longer be
  -- removed (void the invoice instead). This keeps a paid invoice's ledger immutable.
  IF inv.status = 'paid' THEN
    RAISE EXCEPTION 'cannot remove payments from a fully paid invoice';
  END IF;

  DELETE FROM public.invoice_payments WHERE id = _payment_id;

  SELECT COALESCE(SUM(amount), 0) INTO new_paid FROM public.invoice_payments WHERE invoice_id = pay.invoice_id;
  new_status := CASE
                  WHEN inv.total > 0 AND new_paid >= inv.total THEN 'paid'
                  WHEN new_paid > 0                            THEN 'partial'
                  ELSE 'issued'
                END;

  UPDATE public.invoices
     SET amount_paid   = new_paid,
         status        = new_status,
         fully_paid_at = CASE WHEN new_status = 'paid' THEN COALESCE(inv.fully_paid_at, now()) ELSE NULL END
   WHERE id = pay.invoice_id;

  PERFORM public.log_invoice_edit(pay.invoice_id,
    'Payment ' || pay.amount::text || ' removed · balance ' || (inv.total - new_paid)::text);

  RETURN jsonb_build_object('status', 'deleted', 'amount_paid', new_paid,
                            'balance', inv.total - new_paid, 'invoice_status', new_status);
END;
$$;

REVOKE ALL  ON FUNCTION public.delete_invoice_payment(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_invoice_payment(uuid) TO authenticated;
