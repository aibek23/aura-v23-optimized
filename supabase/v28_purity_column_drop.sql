-- ============================================================================
-- MIGRATION v28_purity_column_drop
--
-- Колонка public.products.purity удалена (вручную в БД). Эта миграция
-- приводит схему и зависимые объекты в согласованное состояние:
--   * убирает триггер/функцию/констрейнт/индекс, которые ссылались на purity;
--   * пересоздаёт публичные SECURITY DEFINER функции без колонки purity;
--   * проба теперь вычисляется из строки metal («Золото 585» → «585»)
--     как на клиенте (lib/purity.ts), так и в SQL при необходимости.
--
-- Миграция идемпотентна.
-- ============================================================================

-- 1. Зависимые объекты v26.
DROP TRIGGER  IF EXISTS sync_product_purity ON public.products;
DROP FUNCTION IF EXISTS public.sync_product_purity();
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_purity_format;
DROP INDEX    IF EXISTS public.products_shop_purity_idx;

-- 2. Сама колонка (на случай, если где-то ещё осталась).
ALTER TABLE public.products DROP COLUMN IF EXISTS purity;

-- 3. Хелпер: проба из человекочитаемой строки металла.
CREATE OR REPLACE FUNCTION public.purity_from_metal(_metal text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT (regexp_match(coalesce(_metal, ''), '(\d{3,4})\s*$'))[1];
$$;

-- 4. Публичные функции без колонки purity (сигнатура изменилась → DROP).
DROP FUNCTION IF EXISTS public.public_product(uuid, text);
CREATE FUNCTION public.public_product(
  _shop_id uuid,
  _article text
) RETURNS TABLE(
  id uuid, shop_id uuid, shop_seq_id integer, shop_name text, name text,
  category text, metal text, metal_color text, weight numeric, size text,
  sku text, stones text, description text, sale_price numeric,
  quantity integer, status text, images text[], image_url text,
  created_at timestamp with time zone
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.shop_id, s.seq_id, s.shop_name, p.name, p.category, p.metal,
         p.metal_color, p.weight, p.size, p.sku, p.stones, p.description,
         p.sale_price, p.quantity, p.status::text, p.images, p.image_url, p.created_at
  FROM public.products p
  LEFT JOIN public.shop_settings s ON s.shop_id = p.shop_id
  WHERE p.shop_id = _shop_id
    AND p.sku = upper(btrim(_article))
    AND coalesce(p.is_hidden, false) = false
  LIMIT 1;
$$;

DROP FUNCTION IF EXISTS public.public_product_by_seq(integer, text);
CREATE FUNCTION public.public_product_by_seq(
  _shop_seq_id integer,
  _article     text
) RETURNS TABLE(
  id uuid, shop_id uuid, shop_seq_id integer, shop_name text, name text,
  category text, metal text, metal_color text, weight numeric, size text,
  sku text, stones text, description text, sale_price numeric,
  quantity integer, status text, images text[], image_url text,
  created_at timestamp with time zone
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.shop_id, s.seq_id, s.shop_name, p.name, p.category, p.metal,
         p.metal_color, p.weight, p.size, p.sku, p.stones, p.description,
         p.sale_price, p.quantity, p.status::text, p.images, p.image_url, p.created_at
  FROM public.products p
  JOIN public.shop_settings s ON s.shop_id = p.shop_id
  WHERE s.seq_id = _shop_seq_id
    AND p.sku = upper(btrim(_article))
    AND coalesce(p.is_hidden, false) = false
    AND s.public_enabled = true
  LIMIT 1;
$$;

DROP FUNCTION IF EXISTS public.public_shop_products(uuid, integer);
CREATE FUNCTION public.public_shop_products(
  _shop_id uuid,
  _limit   integer DEFAULT 24
) RETURNS TABLE(
  id uuid, shop_id uuid, shop_seq_id integer, shop_name text, name text,
  category text, metal text, metal_color text, weight numeric, size text,
  sku text, stones text, description text, sale_price numeric,
  quantity integer, status text, images text[], image_url text,
  created_at timestamp with time zone
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.shop_id, s.seq_id, s.shop_name, p.name, p.category, p.metal,
         p.metal_color, p.weight, p.size, p.sku, p.stones, p.description,
         p.sale_price, p.quantity, p.status::text, p.images, p.image_url, p.created_at
  FROM public.products p
  LEFT JOIN public.shop_settings s ON s.shop_id = p.shop_id
  WHERE p.shop_id = _shop_id
    AND p.status = 'in_stock'
    AND p.quantity > 0
    AND coalesce(p.is_hidden, false) = false
  ORDER BY p.created_at DESC
  LIMIT _limit;
$$;

-- 5. Права.
GRANT EXECUTE ON FUNCTION public.public_product(uuid, text)            TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_product_by_seq(integer, text)  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_shop_products(uuid, integer)   TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purity_from_metal(text)               TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
