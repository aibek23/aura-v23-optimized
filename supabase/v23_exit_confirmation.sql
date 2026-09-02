-- ============================================================================
-- MIGRATION v23_exit_confirmation
-- Три задачи:
--   1. Добавляет числовой seq_id (shop_settings.seq_id) для компактных QR-ссылок
--      вида /q/{seq_id}/{SKU} вместо UUID.
--   2. Переводит валидатор префикса артикула с кириллицы на латиницу (A-Z).
--   3. Обновляет функцию next_article, public_product и public_shop_products
--      для поддержки нового seq_id и латинских префиксов.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Числовой короткий ID для магазина
-- ----------------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS public.shop_seq_id_seq
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;

ALTER TABLE public.shop_settings
  ADD COLUMN IF NOT EXISTS seq_id integer;

CREATE UNIQUE INDEX IF NOT EXISTS shop_settings_seq_id_idx
  ON public.shop_settings (seq_id)
  WHERE seq_id IS NOT NULL;

UPDATE public.shop_settings
SET seq_id = nextval('public.shop_seq_id_seq')
WHERE seq_id IS NULL;

CREATE OR REPLACE FUNCTION public.assign_shop_seq_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.seq_id IS NULL THEN
    NEW.seq_id := nextval('public.shop_seq_id_seq');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_shop_seq_id ON public.shop_settings;
CREATE TRIGGER trg_assign_shop_seq_id
  BEFORE INSERT ON public.shop_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_shop_seq_id();

-- ----------------------------------------------------------------------------
-- 2. Обновление next_article: латинский префикс вместо кириллического
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.next_article(p_prefix text)
RETURNS TABLE(out_article text, out_prefix text, out_seq integer, out_reused boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $_$
DECLARE
  v_shop    uuid    := public.current_shop_id();
  v_prefix text    := upper(btrim(coalesce(p_prefix, '')));
  v_seq    integer;
  v_reused boolean := false;
BEGIN
  IF NOT public.is_approved() THEN
    RAISE EXCEPTION 'Аккаунт не подтверждён' USING errcode = '42501';
  END IF;
  IF v_shop IS NULL THEN
    RAISE EXCEPTION 'У профиля не задан магазин' USING errcode = '42501';
  END IF;

  IF v_prefix !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'Некорректный префикс артикула: %. Используйте 2 латинские буквы (A-Z).', p_prefix
      USING errcode = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_shop::text || v_prefix, 0));

  SELECT s INTO v_seq
  FROM generate_series(1, 99999) AS s
  WHERE NOT EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.shop_id        = v_shop
      AND p.article_prefix = v_prefix
      AND p.article_seq    = s
  )
  ORDER BY s
  LIMIT 1;

  IF v_seq IS NULL THEN
    SELECT p.article_seq INTO v_seq
    FROM public.products p
    WHERE p.shop_id        = v_shop
      AND p.article_prefix = v_prefix
      AND p.status IN ('sold', 'archived')
    ORDER BY p.created_at ASC
    LIMIT 1;

    IF v_seq IS NOT NULL THEN
      v_reused := true;
      UPDATE public.products p
         SET article_prefix = null,
             article_seq    = null,
             status         = 'archived'
       WHERE p.shop_id        = v_shop
         AND p.article_prefix = v_prefix
         AND p.article_seq    = v_seq;
    END IF;
  END IF;

  IF v_seq IS NULL THEN
    RAISE EXCEPTION
      'Свободные артикулы для префикса % закончились (00001–99999).', v_prefix
      USING errcode = 'P0001';
  END IF;

  RETURN QUERY
    SELECT public.compose_article(v_prefix, v_seq), v_prefix, v_seq, v_reused;
END $_$;

-- ----------------------------------------------------------------------------
-- 3. public_product — добавляем shop_seq_id в выдачу
-- ----------------------------------------------------------------------------

-- Сначала удаляем функцию, так как изменились возвращаемые колонки
DROP FUNCTION IF EXISTS public.public_product(uuid, text);

CREATE OR REPLACE FUNCTION public.public_product(
  _shop_id uuid,
  _article text
) RETURNS TABLE(
  id            uuid,
  shop_id       uuid,
  shop_seq_id   integer,
  shop_name     text,
  name          text,
  category      text,
  metal         text,
  metal_color   text,
  purity        text,
  weight        numeric,
  size          text,
  sku           text,
  stones        text,
  description   text,
  sale_price    numeric,
  quantity      integer,
  status        text,
  images        text[],
  image_url     text,
  created_at    timestamp with time zone
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT
    p.id,
    p.shop_id,
    s.seq_id          AS shop_seq_id,
    s.shop_name,
    p.name,
    p.category,
    p.metal,
    p.metal_color,
    p.purity,
    p.weight,
    p.size,
    p.sku,
    p.stones,
    p.description,
    p.sale_price,
    p.quantity,
    p.status::text,
    p.images,
    p.image_url,
    p.created_at
  FROM public.products p
  LEFT JOIN public.shop_settings s ON s.shop_id = p.shop_id
  WHERE p.shop_id = _shop_id
    AND p.sku     = upper(btrim(_article))
    AND coalesce(p.is_hidden, false) = false
  LIMIT 1;
$$;

-- ----------------------------------------------------------------------------
-- 4. public_product_by_seq — поиск по числовому seq_id магазина (новый маршрут)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.public_product_by_seq(
  _shop_seq_id integer,
  _article     text
) RETURNS TABLE(
  id            uuid,
  shop_id       uuid,
  shop_seq_id   integer,
  shop_name     text,
  name          text,
  category      text,
  metal         text,
  metal_color   text,
  purity        text,
  weight        numeric,
  size          text,
  sku           text,
  stones        text,
  description   text,
  sale_price    numeric,
  quantity      integer,
  status        text,
  images        text[],
  image_url     text,
  created_at    timestamp with time zone
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT
    p.id,
    p.shop_id,
    s.seq_id          AS shop_seq_id,
    s.shop_name,
    p.name,
    p.category,
    p.metal,
    p.metal_color,
    p.purity,
    p.weight,
    p.size,
    p.sku,
    p.stones,
    p.description,
    p.sale_price,
    p.quantity,
    p.status::text,
    p.images,
    p.image_url,
    p.created_at
  FROM public.products p
  JOIN public.shop_settings s ON s.shop_id = p.shop_id
  WHERE s.seq_id = _shop_seq_id
    AND p.sku    = upper(btrim(_article))
    AND coalesce(p.is_hidden, false) = false
    AND s.public_enabled = true
  LIMIT 1;
$$;

-- ----------------------------------------------------------------------------
-- 5. public_shop_products — добавляем shop_seq_id в выдачу
-- ----------------------------------------------------------------------------

-- Сначала удаляем функцию, так как изменились возвращаемые колонки
DROP FUNCTION IF EXISTS public.public_shop_products(uuid, integer);

CREATE OR REPLACE FUNCTION public.public_shop_products(
  _shop_id uuid,
  _limit   integer DEFAULT 24
) RETURNS TABLE(
  id            uuid,
  shop_id       uuid,
  shop_seq_id   integer,
  shop_name     text,
  name          text,
  category      text,
  metal         text,
  metal_color   text,
  purity        text,
  weight        numeric,
  size          text,
  sku           text,
  stones        text,
  description   text,
  sale_price    numeric,
  quantity      integer,
  status        text,
  images        text[],
  image_url     text,
  created_at    timestamp with time zone
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT
    p.id,
    p.shop_id,
    s.seq_id          AS shop_seq_id,
    s.shop_name,
    p.name,
    p.category,
    p.metal,
    p.metal_color,
    p.purity,
    p.weight,
    p.size,
    p.sku,
    p.stones,
    p.description,
    p.sale_price,
    p.quantity,
    p.status::text,
    p.images,
    p.image_url,
    p.created_at
  FROM public.products p
  LEFT JOIN public.shop_settings s ON s.shop_id = p.shop_id
  WHERE p.shop_id  = _shop_id
    AND p.status   = 'in_stock'
    AND p.quantity > 0
    AND coalesce(p.is_hidden, false) = false
  ORDER BY p.created_at DESC
  LIMIT _limit;
$$;

-- ----------------------------------------------------------------------------
-- 6. Индексы для быстрого поиска по (seq_id магазина + SKU)
-- ----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS products_shop_sku_idx
  ON public.products (shop_id, sku)
  WHERE sku IS NOT NULL;