-- 007. Фискальные и нефискальные чеки.
--
-- Запускать ПОСЛЕ 001–006. Файл можно запускать повторно.
--
-- Что делает:
-- 1. sales.receipt_type — тип чека продажи: 'fiscal' (фискальный) или
--    'non_fiscal' (нефискальный). У старых продаж остаётся NULL («не указан»),
--    чтобы отчёты не выдавали догадку за факт.
-- 2. shop_settings.default_receipt_type — настройка администратора:
--    'ask' (спрашивать при каждой продаже), 'fiscal' или 'non_fiscal'.
-- 3. commit_sale_with_receipt — обёртка над существующими функциями продажи
--    (commit_offline_sale и commit_offline_credit_sale). Сами функции продажи
--    НЕ пересоздаются, поэтому их SECURITY DEFINER и проверки из 006 сохраняются.
--    Обёртка передаёт выбранный тип чека через переменную транзакции, а триггер
--    записывает его в строку продажи в момент вставки — без отдельного UPDATE.
-- 4. Тип чека нельзя изменить напрямую из приложения после продажи (для отчётов).

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Колонки
-- ---------------------------------------------------------------------------
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS receipt_type text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sales_receipt_type_check'
      AND conrelid = 'public.sales'::regclass
  ) THEN
    ALTER TABLE public.sales
      ADD CONSTRAINT sales_receipt_type_check
      CHECK (receipt_type IS NULL OR receipt_type IN ('fiscal', 'non_fiscal'));
  END IF;
END;
$$;

ALTER TABLE public.shop_settings
  ADD COLUMN IF NOT EXISTS default_receipt_type text NOT NULL DEFAULT 'ask';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'shop_settings_default_receipt_type_check'
      AND conrelid = 'public.shop_settings'::regclass
  ) THEN
    ALTER TABLE public.shop_settings
      ADD CONSTRAINT shop_settings_default_receipt_type_check
      CHECK (default_receipt_type IN ('ask', 'fiscal', 'non_fiscal'));
  END IF;
END;
$$;

-- Для будущего отчёта «фискальные / нефискальные продажи за период».
CREATE INDEX IF NOT EXISTS sales_shop_receipt_type_created_idx
  ON public.sales (shop_id, receipt_type, created_at)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Триггер: тип чека проставляется при вставке продажи
--    Приоритет: выбор кассира (переменная транзакции) → настройка магазина
--    (если не 'ask') → NULL.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_sale_receipt_type()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_requested text := nullif(current_setting('aura.receipt_type', true), '');
  v_default text;
BEGIN
  IF v_requested IN ('fiscal', 'non_fiscal') THEN
    NEW.receipt_type := v_requested;
  ELSIF NEW.receipt_type IS NULL THEN
    SELECT default_receipt_type INTO v_default
      FROM public.shop_settings
     WHERE shop_id = NEW.shop_id;
    IF v_default IN ('fiscal', 'non_fiscal') THEN
      NEW.receipt_type := v_default;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sales_set_receipt_type ON public.sales;
CREATE TRIGGER sales_set_receipt_type
  BEFORE INSERT ON public.sales
  FOR EACH ROW
  EXECUTE FUNCTION public.set_sale_receipt_type();

-- ---------------------------------------------------------------------------
-- 3. Защита: сотрудник не может поменять тип чека прямым запросом.
--    Как и в 006: триггер НЕ security definer, current_user показывает,
--    кто реально меняет строку.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_sales_receipt_type()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon')
     AND NEW.receipt_type IS DISTINCT FROM OLD.receipt_type THEN
    RAISE EXCEPTION 'Тип чека (фискальный / нефискальный) нельзя изменить после продажи'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sales_guard_receipt_type ON public.sales;
CREATE TRIGGER sales_guard_receipt_type
  BEFORE UPDATE ON public.sales
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_sales_receipt_type();

-- ---------------------------------------------------------------------------
-- 4. Продажа с типом чека. Тип берётся из _sale->>'receipt_type'.
--    Повтор с тем же client_op_id возвращает уже проведённую продажу
--    (тип чека у неё не меняется).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commit_sale_with_receipt(
  _client_op_id text,
  _sale jsonb,
  _due_date date DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_receipt_type text := nullif(btrim(coalesce(_sale->>'receipt_type', '')), '');
BEGIN
  IF v_receipt_type IS NOT NULL AND v_receipt_type NOT IN ('fiscal', 'non_fiscal') THEN
    RAISE EXCEPTION 'Некорректный тип чека' USING ERRCODE = '22023';
  END IF;

  -- true = только до конца текущей транзакции (одна продажа).
  PERFORM set_config('aura.receipt_type', coalesce(v_receipt_type, ''), true);

  IF coalesce(_sale->>'payment_method', '') = 'credit' THEN
    RETURN public.commit_offline_credit_sale(_client_op_id, _sale, _due_date);
  END IF;

  RETURN public.commit_offline_sale(_client_op_id, _sale);
END;
$$;

REVOKE ALL ON FUNCTION public.commit_sale_with_receipt(text, jsonb, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commit_sale_with_receipt(text, jsonb, date) TO authenticated;

COMMIT;

-- Обновить кэш схемы PostgREST, чтобы новая функция сразу была доступна.
NOTIFY pgrst, 'reload schema';
