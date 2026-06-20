ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'Africa/Lagos',
  ADD COLUMN IF NOT EXISTS subscription_tier TEXT DEFAULT 'free'
    CHECK (subscription_tier IN ('free', 'pro', 'business')),
  ADD COLUMN IF NOT EXISTS whatsapp_number TEXT;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notification_prefs JSONB DEFAULT '{
    "low_stock_alerts": true,
    "overdue_invoice_alerts": true,
    "daily_summary": false
  }'::jsonb;