-- v31: индексы для масштабирования CRM-поиска.
--
-- Текущие экраны фильтруют уже загруженный набор товаров в браузере и не
-- создают запрос на каждую букву. Эти индексы заранее закрывают критичные
-- access patterns для будущей серверной пагинации и больших каталогов.

CREATE INDEX IF NOT EXISTS products_shop_created_at_idx
  ON public.products (shop_id, created_at DESC);

CREATE INDEX IF NOT EXISTS products_shop_weight_idx
  ON public.products (shop_id, weight);

CREATE INDEX IF NOT EXISTS products_shop_sale_price_idx
  ON public.products (shop_id, sale_price);

CREATE INDEX IF NOT EXISTS products_shop_supplier_idx
  ON public.products (shop_id, supplier_name, supplier_phone);
