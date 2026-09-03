-- v27: Гарантия наличия колонок закупочной цены.
-- Колонки уже существуют в базовой схеме (supabase.sql, v20):
--   products.purchase_price          — реальная закупочная цена (видит админ)
--   products.purchase_price_visible  — закупочная цена, видимая продавцу
-- Эта миграция идемпотентна: только добавляет колонки, если их нет,
-- и восстанавливает комментарии/права. Данные не изменяются.

BEGIN;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS purchase_price numeric(12,2) DEFAULT 0 NOT NULL;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS purchase_price_visible numeric(12,2);

COMMENT ON COLUMN public.products.purchase_price IS
  'Реальная закупочная цена (только для администратора).';
COMMENT ON COLUMN public.products.purchase_price_visible IS
  'Закупочная цена, видимая продавцу (переименовано из purchase_price_seller в v20).';

COMMIT;
