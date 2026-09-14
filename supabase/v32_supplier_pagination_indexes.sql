-- v32: индексы для ограниченных и курсорных выборок журнала поставщиков.
-- Выполняется отдельно от v31, чтобы обновление уже установленных баз
-- не зависело от того, применялся ли предыдущий файл.

CREATE INDEX IF NOT EXISTS supplier_debt_shop_created_at_idx
  ON public.supplier_debt_operations (shop_id, created_at DESC);

CREATE INDEX IF NOT EXISTS supplier_debt_shop_supplier_idx
  ON public.supplier_debt_operations (shop_id, supplier_name, supplier_phone, created_at DESC);