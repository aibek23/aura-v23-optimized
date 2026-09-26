-- =============================================================================
-- МИГРАЦИЯ v35_sync_engine_support.sql
-- Версия: 35
-- Описание: Полная поддержка двухсторонней офлайн-синхронизации (SyncEngine / Outbox),
--           идемпотентности операций (client_op_id), мягкого удаления (deleted_at),
--           отслеживания изменений (updated_at + триггеры) и политик RLS UPDATE.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Универсальная триггерная функция для автоматического обновления updated_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 2. Таблица products (товары на складе)
-- ---------------------------------------------------------------------------
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS client_op_id TEXT;

UPDATE public.products
   SET updated_at = created_at
 WHERE updated_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS products_client_op_id_idx
  ON public.products (client_op_id)
  WHERE client_op_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS products_shop_updated_at_idx
  ON public.products (shop_id, updated_at);

CREATE INDEX IF NOT EXISTS products_shop_deleted_at_idx
  ON public.products (shop_id, deleted_at)
  WHERE deleted_at IS NOT NULL;

DROP TRIGGER IF EXISTS update_products_updated_at ON public.products;
CREATE TRIGGER update_products_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 3. Таблица sales (чеки продаж)
-- ---------------------------------------------------------------------------
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS client_op_id TEXT;

UPDATE public.sales
   SET updated_at = created_at
 WHERE updated_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS sales_client_op_id_idx
  ON public.sales (client_op_id)
  WHERE client_op_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS sales_shop_updated_at_idx
  ON public.sales (shop_id, updated_at);

CREATE INDEX IF NOT EXISTS sales_shop_deleted_at_idx
  ON public.sales (shop_id, deleted_at)
  WHERE deleted_at IS NOT NULL;

DROP TRIGGER IF EXISTS update_sales_updated_at ON public.sales;
CREATE TRIGGER update_sales_updated_at
  BEFORE UPDATE ON public.sales
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- RLS UPDATE для поддержки UPSERT и синхронизации
DROP POLICY IF EXISTS "sales: shop update" ON public.sales;
CREATE POLICY "sales: shop update" ON public.sales
  FOR UPDATE TO authenticated
  USING (public.is_approved() AND (shop_id = public.current_shop_id()))
  WITH CHECK (public.is_approved() AND (shop_id = public.current_shop_id()));

GRANT UPDATE ON public.sales TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Таблица sale_returns (возвраты товаров)
-- ---------------------------------------------------------------------------
ALTER TABLE public.sale_returns
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS client_op_id TEXT;

ALTER TABLE public.sale_returns
  ALTER COLUMN created_by DROP NOT NULL;

UPDATE public.sale_returns
   SET updated_at = created_at
 WHERE updated_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS sale_returns_client_op_id_idx
  ON public.sale_returns (client_op_id)
  WHERE client_op_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS sale_returns_shop_updated_at_idx
  ON public.sale_returns (shop_id, updated_at);

CREATE INDEX IF NOT EXISTS sale_returns_shop_deleted_at_idx
  ON public.sale_returns (shop_id, deleted_at)
  WHERE deleted_at IS NOT NULL;

DROP TRIGGER IF EXISTS update_sale_returns_updated_at ON public.sale_returns;
CREATE TRIGGER update_sale_returns_updated_at
  BEFORE UPDATE ON public.sale_returns
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- RLS UPDATE для sale_returns
DROP POLICY IF EXISTS "sale_returns: shop update" ON public.sale_returns;
CREATE POLICY "sale_returns: shop update" ON public.sale_returns
  FOR UPDATE TO authenticated
  USING (public.is_approved() AND (shop_id = public.current_shop_id()))
  WITH CHECK (public.is_approved() AND (shop_id = public.current_shop_id()));

GRANT UPDATE ON public.sale_returns TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Таблица cash_operations (кассовые операции)
-- ---------------------------------------------------------------------------
ALTER TABLE public.cash_operations
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS client_op_id TEXT;

UPDATE public.cash_operations
   SET updated_at = created_at
 WHERE updated_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS cash_operations_client_op_id_idx
  ON public.cash_operations (client_op_id)
  WHERE client_op_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS cash_operations_shop_updated_at_idx
  ON public.cash_operations (shop_id, updated_at);

CREATE INDEX IF NOT EXISTS cash_operations_shop_deleted_at_idx
  ON public.cash_operations (shop_id, deleted_at)
  WHERE deleted_at IS NOT NULL;

DROP TRIGGER IF EXISTS update_cash_operations_updated_at ON public.cash_operations;
CREATE TRIGGER update_cash_operations_updated_at
  BEFORE UPDATE ON public.cash_operations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- RLS UPDATE для cash_operations
DROP POLICY IF EXISTS "cash_operations: shop update" ON public.cash_operations;
CREATE POLICY "cash_operations: shop update" ON public.cash_operations
  FOR UPDATE TO authenticated
  USING (public.is_approved() AND (shop_id = public.current_shop_id()))
  WITH CHECK (public.is_approved() AND (shop_id = public.current_shop_id()));

GRANT UPDATE ON public.cash_operations TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Таблица customers (клиенты CRM)
-- ---------------------------------------------------------------------------
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS client_op_id TEXT;

UPDATE public.customers
   SET updated_at = created_at
 WHERE updated_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS customers_client_op_id_idx
  ON public.customers (client_op_id)
  WHERE client_op_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS customers_shop_updated_at_idx
  ON public.customers (shop_id, updated_at);

CREATE INDEX IF NOT EXISTS customers_shop_deleted_at_idx
  ON public.customers (shop_id, deleted_at)
  WHERE deleted_at IS NOT NULL;

DROP TRIGGER IF EXISTS update_customers_updated_at ON public.customers;
CREATE TRIGGER update_customers_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 7. Таблица cash_reason_presets (шаблоны причин кассы)
-- ---------------------------------------------------------------------------
ALTER TABLE public.cash_reason_presets
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

UPDATE public.cash_reason_presets
   SET updated_at = created_at
 WHERE updated_at IS NULL;

CREATE INDEX IF NOT EXISTS cash_reason_presets_shop_updated_at_idx
  ON public.cash_reason_presets (shop_id, updated_at);

CREATE INDEX IF NOT EXISTS cash_reason_presets_shop_deleted_at_idx
  ON public.cash_reason_presets (shop_id, deleted_at)
  WHERE deleted_at IS NOT NULL;

DROP TRIGGER IF EXISTS update_cash_reason_presets_updated_at ON public.cash_reason_presets;
CREATE TRIGGER update_cash_reason_presets_updated_at
  BEFORE UPDATE ON public.cash_reason_presets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 8. Таблица supplier_debt_operations (долги и взаиморасчёты с поставщиками)
-- ---------------------------------------------------------------------------
ALTER TABLE public.supplier_debt_operations
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS client_op_id TEXT;

UPDATE public.supplier_debt_operations
   SET updated_at = created_at
 WHERE updated_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS supplier_debt_operations_client_op_id_idx
  ON public.supplier_debt_operations (client_op_id)
  WHERE client_op_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS supplier_debt_operations_shop_updated_at_idx
  ON public.supplier_debt_operations (shop_id, updated_at);

CREATE INDEX IF NOT EXISTS supplier_debt_operations_shop_deleted_at_idx
  ON public.supplier_debt_operations (shop_id, deleted_at)
  WHERE deleted_at IS NOT NULL;

DROP TRIGGER IF EXISTS update_supplier_debt_operations_updated_at ON public.supplier_debt_operations;
CREATE TRIGGER update_supplier_debt_operations_updated_at
  BEFORE UPDATE ON public.supplier_debt_operations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 9. Таблица metal_rates (курсы металлов)
-- ---------------------------------------------------------------------------
ALTER TABLE public.metal_rates
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS metal_rates_shop_updated_at_idx
  ON public.metal_rates (shop_id, updated_at);

CREATE INDEX IF NOT EXISTS metal_rates_shop_deleted_at_idx
  ON public.metal_rates (shop_id, deleted_at)
  WHERE deleted_at IS NOT NULL;

DROP TRIGGER IF EXISTS update_metal_rates_updated_at ON public.metal_rates;
CREATE TRIGGER update_metal_rates_updated_at
  BEFORE UPDATE ON public.metal_rates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

COMMIT;

-- =============================================================================
-- ИТОГ МИГРАЦИИ v35
-- =============================================================================
-- • Добавлены колонки updated_at, deleted_at, client_op_id во все сущности
-- • Настроены автоматические триггеры обновления updated_at
-- • Созданы уникальные индексы по client_op_id для идемпотентности Outbox
-- • Созданы индексы по (shop_id, updated_at) для быстрого keyset pagination
-- • Созданы индексы по (shop_id, deleted_at) для мягкого удаления
-- • Добавлены RLS политики UPDATE для sales, cash_operations, sale_returns
-- =============================================================================
