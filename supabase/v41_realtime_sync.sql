-- v24: включаем Realtime для мгновенной синхронизации между устройствами.
-- Запустите один раз в Supabase SQL Editor.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['products','sales','sale_returns','cash_operations','customers',
    'cash_reason_presets','metal_rates','supplier_debt_operations','shop_settings'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t)
       AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
