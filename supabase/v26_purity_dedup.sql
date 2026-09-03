-- ============================================================================
-- MIGRATION v26_purity_dedup
--
-- Причина: проба хранилась дважды — отдельной колонкой public.products.purity
-- и внутри текстового поля public.products.metal («Золото 585»), а в UI было
-- два независимых блока выбора пробы. Источник истины теперь один:
-- колонка products.purity. Значение в metal остаётся человекочитаемым,
-- но всегда синхронизируется триггером из purity.
--
-- Миграция идемпотентна и безопасна для повторного применения.
-- ============================================================================

-- 1. Удаляем возможные legacy-дубли колонок под пробу (если создавались ранее).
ALTER TABLE public.products DROP COLUMN IF EXISTS metal_purity;
ALTER TABLE public.products DROP COLUMN IF EXISTS proba;
ALTER TABLE public.products DROP COLUMN IF EXISTS purity_code;

-- 2. Бэкфилл: если purity пустая, достаём пробу из строки metal.
UPDATE public.products
   SET purity = (regexp_match(metal, '(\d{3})\s*$'))[1]
 WHERE (purity IS NULL OR btrim(purity) = '')
   AND metal ~ '(\d{3})\s*$';

-- 3. Нормализация пустых строк.
UPDATE public.products
   SET purity = NULL
 WHERE purity IS NOT NULL AND btrim(purity) = '';

-- 4. Единый источник истины: синхронизация purity <-> metal.
CREATE OR REPLACE FUNCTION public.sync_product_purity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_from_metal text;
BEGIN
  IF new.purity IS NOT NULL AND btrim(new.purity) = '' THEN
    new.purity := NULL;
  END IF;

  v_from_metal := (regexp_match(coalesce(new.metal, ''), '(\d{3})\s*$'))[1];

  IF new.purity IS NULL THEN
    -- проба не задана явно — берём из metal, если она там есть
    new.purity := v_from_metal;
  ELSIF v_from_metal IS DISTINCT FROM new.purity THEN
    -- проба задана — metal не должен содержать другую (дублирующую) пробу
    new.metal := btrim(regexp_replace(coalesce(new.metal, ''), '\s*\d{3}\s*$', ''))
                 || ' ' || new.purity;
  END IF;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS sync_product_purity ON public.products;
CREATE TRIGGER sync_product_purity
  BEFORE INSERT OR UPDATE OF purity, metal ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.sync_product_purity();

-- 5. Ограничение формата пробы (3 цифры) — предотвращает мусорные значения.
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_purity_format;
ALTER TABLE public.products
  ADD CONSTRAINT products_purity_format
  CHECK (purity IS NULL OR purity ~ '^[0-9]{3,4}$') NOT VALID;

-- 6. Индекс для отчётов по пробам.
CREATE INDEX IF NOT EXISTS products_shop_purity_idx
  ON public.products (shop_id, purity)
  WHERE purity IS NOT NULL;

-- 7. Права (Data API) — без изменений по смыслу, фиксируем явно.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
