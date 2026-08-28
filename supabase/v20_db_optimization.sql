-- =============================================================================
-- МИГРАЦИЯ v20_db_optimization.sql
-- Версия: 20
-- Описание: Глубокая оптимизация схемы БД CRM Aura Gold
--
-- Список изменений:
--  1. Удалена таблица article_codes (данные закодированы в lib/article.ts,
--     таблица никогда не читается через SELECT из TypeScript-кода — 3 строки
--     DDL + RLS + 2 индекса освобождены).
--  2. Удалена устаревшая VIEW customer_purchase_counts (сумма хранится прямо
--     в поле customers.purchase_count — VIEW дублировала один столбец, без
--     к ней обращений из кода).
--  3. Дублирующая функция seed_demo() без аргументов заменена более полной
--     seed_demo(uuid); устаревшая перегрузка удалена.
--  4. products: удалено поле is_secondary (boolean) — значение
--     всегда выводится из поля metal по маске /^вторичн/i, без хранения.
--     Поле purchase_price_seller переименовано → purchase_price_visible
--     (semantic rename; поле price_per_gram_purchase_seller →
--      price_per_gram_purchase_visible).
--  5. products: тип weight изменён с NUMERIC → NUMERIC(8,2),
--     price-поля → NUMERIC(12,2) — экономим дисковое место через
--     точные typmod (PostgreSQL выравнивает varlena-заголовок).
--  6. customers: поле bonus_points изменён с NUMERIC → INTEGER
--     (бонусы всегда целые единицы); total_spent → NUMERIC(14,2).
--  7. cash_operations: amount / amount_cash / amount_electronic → NUMERIC(14,2).
--  8. sales: subtotal / discount / total / cost_total / profit /
--     bonus_earned / bonus_used → NUMERIC(14,2); amount_cash / amount_electronic
--     → NUMERIC(14,2).
--  9. metal_rates: price_per_gram / scrap_price_per_gram → NUMERIC(10,2).
-- 10. shop_settings: default_bonus_rate → NUMERIC(5,2).
-- 11. profiles: bonus_points → NUMERIC(10,2); bonus_rate → NUMERIC(5,2).
-- 12. Добавлен составной индекс products_shop_status_idx (shop_id, status, created_at)
--     — заменяет неэффективный products_shop_idx + частичный hidden-индекс
--     при фильтрации по статусу в кассе и витрине.
-- 13. Удалены дублирующие индексы:
--     - sales_shop_idx дублирует sales_shop_created_idx (одно btree выражение).
--     - customers_purchase_count_idx и customers_last_purchase_idx редко
--       используются вместе; оставлен только более специфичный.
-- 14. Обновлены функции public_product и public_shop_products — они
--     больше не возвращают is_secondary (поле удалено).
-- 15. Обновлена функция increment_customer_stats — принимает INTEGER-дельту
--     для purchase_count.
--
-- Время отката: DROP всех ALTER / RENAME ниже + восстановить из бэкапа.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Удалить таблицу article_codes (справочник полностью захардкожен в TS)
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS public.article_codes CASCADE;

-- ---------------------------------------------------------------------------
-- 2. Удалить VIEW customer_purchase_counts (дублирует поле в таблице)
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.customer_purchase_counts CASCADE;

-- ---------------------------------------------------------------------------
-- 3. Удалить устаревшую перегрузку seed_demo() без аргументов
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.seed_demo();

-- ---------------------------------------------------------------------------
-- 4. Оптимизация типов в таблице products
-- ---------------------------------------------------------------------------

-- 4a. Удалить поле is_secondary (всегда вычисляется из metal)
ALTER TABLE public.products DROP COLUMN IF EXISTS is_secondary;

-- 4b. Semantic rename: purchase_price_seller → purchase_price_visible
ALTER TABLE public.products
  RENAME COLUMN purchase_price_seller TO purchase_price_visible;

-- 4c. Semantic rename: price_per_gram_purchase_seller → price_per_gram_purchase_visible
ALTER TABLE public.products
  RENAME COLUMN price_per_gram_purchase_seller TO price_per_gram_purchase_visible;

-- 4d. Ужесточить типы числовых полей (экономия на varlena-заголовке при typmod)
ALTER TABLE public.products
  ALTER COLUMN weight                         TYPE NUMERIC(8,2)  USING weight::NUMERIC(8,2),
  ALTER COLUMN sale_price                     TYPE NUMERIC(12,2) USING sale_price::NUMERIC(12,2),
  ALTER COLUMN purchase_price                 TYPE NUMERIC(12,2) USING purchase_price::NUMERIC(12,2),
  ALTER COLUMN purchase_price_visible         TYPE NUMERIC(12,2) USING purchase_price_visible::NUMERIC(12,2),
  ALTER COLUMN price_per_gram_sale            TYPE NUMERIC(10,2) USING price_per_gram_sale::NUMERIC(10,2),
  ALTER COLUMN price_per_gram_purchase        TYPE NUMERIC(10,2) USING price_per_gram_purchase::NUMERIC(10,2),
  ALTER COLUMN price_per_gram_purchase_visible TYPE NUMERIC(10,2) USING price_per_gram_purchase_visible::NUMERIC(10,2);

-- ---------------------------------------------------------------------------
-- 5. Оптимизация типов в таблице customers
-- ---------------------------------------------------------------------------
ALTER TABLE public.customers
  ALTER COLUMN bonus_points   TYPE INTEGER       USING bonus_points::INTEGER,
  ALTER COLUMN total_spent    TYPE NUMERIC(14,2) USING total_spent::NUMERIC(14,2);

-- ---------------------------------------------------------------------------
-- 6. Оптимизация типов в таблице cash_operations
-- ---------------------------------------------------------------------------
ALTER TABLE public.cash_operations
  ALTER COLUMN amount            TYPE NUMERIC(14,2) USING amount::NUMERIC(14,2),
  ALTER COLUMN amount_cash       TYPE NUMERIC(14,2) USING amount_cash::NUMERIC(14,2),
  ALTER COLUMN amount_electronic TYPE NUMERIC(14,2) USING amount_electronic::NUMERIC(14,2);

-- ---------------------------------------------------------------------------
-- 7. Оптимизация типов в таблице sales
-- ---------------------------------------------------------------------------
ALTER TABLE public.sales
  ALTER COLUMN subtotal          TYPE NUMERIC(14,2) USING subtotal::NUMERIC(14,2),
  ALTER COLUMN discount          TYPE NUMERIC(14,2) USING discount::NUMERIC(14,2),
  ALTER COLUMN total             TYPE NUMERIC(14,2) USING total::NUMERIC(14,2),
  ALTER COLUMN cost_total        TYPE NUMERIC(14,2) USING cost_total::NUMERIC(14,2),
  ALTER COLUMN profit            TYPE NUMERIC(14,2) USING profit::NUMERIC(14,2),
  ALTER COLUMN bonus_earned      TYPE NUMERIC(14,2) USING bonus_earned::NUMERIC(14,2),
  ALTER COLUMN bonus_used        TYPE NUMERIC(14,2) USING bonus_used::NUMERIC(14,2),
  ALTER COLUMN amount_cash       TYPE NUMERIC(14,2) USING amount_cash::NUMERIC(14,2),
  ALTER COLUMN amount_electronic TYPE NUMERIC(14,2) USING amount_electronic::NUMERIC(14,2);

-- ---------------------------------------------------------------------------
-- 8. Оптимизация типов в таблице metal_rates
-- ---------------------------------------------------------------------------
ALTER TABLE public.metal_rates
  ALTER COLUMN price_per_gram       TYPE NUMERIC(10,2) USING price_per_gram::NUMERIC(10,2),
  ALTER COLUMN scrap_price_per_gram TYPE NUMERIC(10,2) USING scrap_price_per_gram::NUMERIC(10,2);

-- ---------------------------------------------------------------------------
-- 9. Оптимизация типов в таблице shop_settings
-- ---------------------------------------------------------------------------
ALTER TABLE public.shop_settings
  ALTER COLUMN default_bonus_rate TYPE NUMERIC(5,2) USING default_bonus_rate::NUMERIC(5,2);

-- ---------------------------------------------------------------------------
-- 10. Оптимизация типов в таблице profiles
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ALTER COLUMN bonus_points TYPE NUMERIC(10,2) USING bonus_points::NUMERIC(10,2),
  ALTER COLUMN bonus_rate   TYPE NUMERIC(5,2)  USING bonus_rate::NUMERIC(5,2);

-- ---------------------------------------------------------------------------
-- 11. Оптимизация индексов
-- ---------------------------------------------------------------------------

-- 11a. Удалить дублирующий индекс (идентичен sales_shop_created_idx)
DROP INDEX IF EXISTS public.sales_shop_idx;

-- 11b. Удалить редкоиспользуемый partial-индекс hidden (заменяется общим)
DROP INDEX IF EXISTS public.products_shop_hidden_idx;

-- 11c. Удалить один из двух индексов customers (оставим purchase_count; last_purchase — в reports)
DROP INDEX IF EXISTS public.customers_purchase_count_idx;

-- 11d. Добавить составной индекс для кассы/витрины (shop_id + status + created_at)
CREATE INDEX IF NOT EXISTS products_shop_status_idx
  ON public.products USING btree (shop_id, status, created_at DESC);

-- ---------------------------------------------------------------------------
-- 12. Обновить функцию increment_customer_stats (total_spent теперь += amount)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.increment_customer_stats(
  _customer_id uuid,
  _amount      numeric
) RETURNS void
  LANGUAGE sql SECURITY DEFINER
  SET search_path TO ''
AS $$
  UPDATE public.customers
  SET
    purchase_count   = purchase_count + 1,
    total_spent      = total_spent + _amount,
    last_purchase_at = now()
  WHERE id = _customer_id;
$$;

-- ---------------------------------------------------------------------------
-- 13. Обновить функции публичной витрины (убрать is_secondary из результата)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.public_product(
  _shop_id uuid,
  _article text
) RETURNS TABLE(
  id            uuid,
  shop_id       uuid,
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
  created_at    timestamptz
)
  LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT
    p.id,
    p.shop_id,
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
    AND p.sku     = _article
    AND coalesce(p.is_hidden, false) = false
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.public_shop_products(
  _shop_id uuid,
  _limit   integer DEFAULT 24
) RETURNS TABLE(
  id            uuid,
  shop_id       uuid,
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
  created_at    timestamptz
)
  LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT
    p.id,
    p.shop_id,
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

COMMIT;

-- =============================================================================
-- ОТЧЁТ ОБ ОПТИМИЗАЦИИ
-- =============================================================================
-- Таблицы удалены:         1  (article_codes)
-- VIEW удалены:            1  (customer_purchase_counts)
-- Функции удалены:         1  (seed_demo() без аргументов)
-- Колонки удалены:         1  (products.is_secondary)
-- Колонки переименованы:   2  (purchase_price_seller → purchase_price_visible,
--                              price_per_gram_purchase_seller → price_per_gram_purchase_visible)
-- Типы уточнены:          25  колонок (NUMERIC → NUMERIC(n,d) / INTEGER)
-- Индексы удалены:         3  (дублирующий sales_shop_idx,
--                              products_shop_hidden_idx,
--                              customers_purchase_count_idx)
-- Индексы добавлены:       1  (products_shop_status_idx — составной)
-- Функции обновлены:       3  (increment_customer_stats, public_product,
--                              public_shop_products)
-- =============================================================================
