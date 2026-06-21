-- Invoice creator tracking + in-app notifications & business activity log.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Backfill existing POS invoices from the sale's cashier.
UPDATE public.invoices i
  SET created_by = s.staff_id
  FROM public.sales s
  WHERE i.sale_id = s.id AND i.created_by IS NULL;

CREATE TABLE IF NOT EXISTS public.activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  actor_id uuid,
  actor_name text,
  type text NOT NULL,
  summary text NOT NULL,
  entity_type text,
  entity_id uuid,
  link text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activity_log_business_created_idx ON public.activity_log (business_id, created_at DESC);

GRANT SELECT, INSERT ON public.activity_log TO authenticated;
GRANT ALL ON public.activity_log TO service_role;
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "activity_log_select" ON public.activity_log FOR SELECT TO authenticated
  USING (business_id = public.current_business_id());
CREATE POLICY "activity_log_insert" ON public.activity_log FOR INSERT TO authenticated
  WITH CHECK (business_id = public.current_business_id());

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_id uuid,
  type text NOT NULL,            -- low_stock | out_of_stock | overdue | invoice_edited
  title text NOT NULL,
  body text,
  entity_type text,
  entity_id uuid,
  link text,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
CREATE INDEX IF NOT EXISTS notifications_recipient_idx ON public.notifications (recipient_id, read_at);
CREATE INDEX IF NOT EXISTS notifications_dedupe_idx ON public.notifications (recipient_id, type, entity_id);

-- No INSERT grant/policy: rows are created only by the SECURITY DEFINER functions below,
-- which need to write rows for other users' recipient_id.
GRANT SELECT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notifications_select" ON public.notifications FOR SELECT TO authenticated
  USING (recipient_id = auth.uid());
CREATE POLICY "notifications_update" ON public.notifications FOR UPDATE TO authenticated
  USING (recipient_id = auth.uid());
CREATE POLICY "notifications_delete" ON public.notifications FOR DELETE TO authenticated
  USING (recipient_id = auth.uid());

CREATE OR REPLACE FUNCTION public.sync_notifications()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  biz uuid := public.current_business_id();
  is_mgr boolean;
  prefs jsonb;
  want_low boolean;
  want_overdue boolean;
  biz_tz text;
  today_local date;
BEGIN
  IF uid IS NULL OR biz IS NULL THEN RETURN; END IF;

  -- Overdue flips at the business's local midnight, not UTC.
  SELECT COALESCE(timezone, 'Africa/Lagos') INTO biz_tz FROM public.businesses WHERE id = biz;
  today_local := (now() AT TIME ZONE biz_tz)::date;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = uid AND business_id = biz AND role IN ('owner','manager')
  ) INTO is_mgr;

  IF NOT is_mgr THEN
    DELETE FROM public.notifications
      WHERE recipient_id = uid AND type IN ('low_stock','out_of_stock','overdue');
    RETURN;
  END IF;

  SELECT notification_prefs INTO prefs FROM public.profiles WHERE id = uid;
  want_low := COALESCE((prefs->>'low_stock_alerts')::boolean, true);
  want_overdue := COALESCE((prefs->>'overdue_invoice_alerts')::boolean, true);

  IF want_low THEN
    DELETE FROM public.notifications n
      WHERE n.recipient_id = uid AND n.type IN ('low_stock','out_of_stock')
        AND NOT EXISTS (
          SELECT 1 FROM public.products p
          WHERE p.id = n.entity_id AND p.business_id = biz
            AND p.stock_quantity <= p.reorder_level
            AND n.type = (CASE WHEN p.stock_quantity <= 0 THEN 'out_of_stock' ELSE 'low_stock' END)
        );
    INSERT INTO public.notifications (business_id, recipient_id, type, title, body, entity_type, entity_id, link)
    SELECT biz, uid,
           CASE WHEN p.stock_quantity <= 0 THEN 'out_of_stock' ELSE 'low_stock' END,
           p.name,
           CASE WHEN p.stock_quantity <= 0
                THEN 'Out of stock — restock needed'
                ELSE 'Low stock — ' || p.stock_quantity || COALESCE(' ' || p.unit, '')
                     || ' left (reorder at ' || p.reorder_level || ')' END,
           'product', p.id, '/inventory'
    FROM public.products p
    WHERE p.business_id = biz AND p.stock_quantity <= p.reorder_level
      AND NOT EXISTS (
        SELECT 1 FROM public.notifications n
        WHERE n.recipient_id = uid AND n.entity_id = p.id
          AND n.type = (CASE WHEN p.stock_quantity <= 0 THEN 'out_of_stock' ELSE 'low_stock' END)
      );
  ELSE
    DELETE FROM public.notifications WHERE recipient_id = uid AND type IN ('low_stock','out_of_stock');
  END IF;

  IF want_overdue THEN
    DELETE FROM public.notifications n
      WHERE n.recipient_id = uid AND n.type = 'overdue'
        AND NOT EXISTS (
          SELECT 1 FROM public.invoices i
          WHERE i.id = n.entity_id AND i.business_id = biz
            AND i.status = 'issued' AND i.due_date IS NOT NULL AND i.due_date < today_local
        );
    INSERT INTO public.notifications (business_id, recipient_id, type, title, body, entity_type, entity_id, link)
    SELECT biz, uid, 'overdue',
           i.invoice_number || ' · ' || i.customer_name,
           'Overdue since ' || to_char(i.due_date, 'DD Mon YYYY'),
           'invoice', i.id, '/invoices?q=' || i.invoice_number
    FROM public.invoices i
    WHERE i.business_id = biz AND i.status = 'issued'
      AND i.due_date IS NOT NULL AND i.due_date < today_local
      AND NOT EXISTS (
        SELECT 1 FROM public.notifications n
        WHERE n.recipient_id = uid AND n.entity_id = i.id AND n.type = 'overdue'
      );
  ELSE
    DELETE FROM public.notifications WHERE recipient_id = uid AND type = 'overdue';
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.sync_notifications() TO authenticated;

CREATE OR REPLACE FUNCTION public.log_invoice_edit(_invoice_id uuid, _summary text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
  biz uuid;
  inv_num text;
  creator uuid;
  who text;
BEGIN
  SELECT business_id, invoice_number, created_by INTO biz, inv_num, creator
  FROM public.invoices WHERE id = _invoice_id;

  IF biz IS NULL OR biz <> public.current_business_id() THEN RETURN; END IF;

  SELECT owner_name INTO who FROM public.profiles WHERE id = actor;

  INSERT INTO public.activity_log (business_id, actor_id, actor_name, type, summary, entity_type, entity_id, link)
  VALUES (biz, actor, who, 'invoice_edited', _summary, 'invoice', _invoice_id, '/invoices?q=' || inv_num);

  INSERT INTO public.notifications (business_id, recipient_id, actor_id, type, title, body, entity_type, entity_id, link)
  SELECT biz, r.rid, actor, 'invoice_edited',
         'Invoice ' || inv_num,
         COALESCE(_summary, 'Invoice updated') || COALESCE(' · by ' || who, ''),
         'invoice', _invoice_id, '/invoices?q=' || inv_num
  FROM (
    SELECT user_id AS rid FROM public.user_roles WHERE business_id = biz AND role = 'owner'
    UNION
    SELECT creator AS rid WHERE creator IS NOT NULL
  ) r
  WHERE r.rid IS NOT NULL AND r.rid <> actor;
END;
$$;
GRANT EXECUTE ON FUNCTION public.log_invoice_edit(uuid, text) TO authenticated;
