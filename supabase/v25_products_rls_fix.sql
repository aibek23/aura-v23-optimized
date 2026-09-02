-- ============================================================================
-- MIGRATION v25_products_rls_fix
--
-- Причина: при создании товара приложение писало shop_id из profiles.shop_id,
-- а RLS-политика "products: shop insert" сверяет shop_id с
-- public.current_shop_id() = COALESCE(impersonated_shop_id (super_admin),
-- profiles.shop_id). В режиме имперсонации значения расходились и INSERT
-- падал с "new row violates row-level security policy for table products".
--
-- Код исправлен (app/actions/products.ts теперь берёт shop_id из
-- current_shop_id()). Здесь фиксируем серверную часть:
--   1. Явные GRANT EXECUTE на хелперы RLS, чтобы клиент мог вызвать RPC.
--   2. Переопределение политик products идемпотентно (без изменения смысла).
-- Миграция безопасна для повторного применения.
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.current_shop_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_approved() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_shop_admin() TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "products: shop insert" ON public.products;
CREATE POLICY "products: shop insert" ON public.products
  FOR INSERT TO authenticated
  WITH CHECK (public.is_approved() AND shop_id = public.current_shop_id());

DROP POLICY IF EXISTS "products: shop update" ON public.products;
CREATE POLICY "products: shop update" ON public.products
  FOR UPDATE TO authenticated
  USING (public.is_approved() AND shop_id = public.current_shop_id())
  WITH CHECK (shop_id = public.current_shop_id());
