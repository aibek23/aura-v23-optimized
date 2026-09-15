-- v31: products are physical one-unit records.
-- Legacy rows with quantity > 1 are retained as one physical row; only the
-- first unit keeps the existing id, preventing silent duplicate identities.
-- RLS and role policies are intentionally preserved.
BEGIN;

-- These public functions still had quantity in their return type/body from
-- v28. Drop them before removing the column, then recreate them below with
-- the final one-row/one-unit shape.
DROP FUNCTION IF EXISTS public.public_product(uuid, text);
DROP FUNCTION IF EXISTS public.public_product_by_seq(integer, text);
DROP FUNCTION IF EXISTS public.public_shop_products(uuid, integer);

ALTER TABLE public.products
  ADD CONSTRAINT products_single_unit_quantity_check CHECK (quantity = 1) NOT VALID;

-- Normalize legacy quantities before validating the invariant.
UPDATE public.products SET quantity = 1 WHERE quantity IS DISTINCT FROM 1;
ALTER TABLE public.products VALIDATE CONSTRAINT products_single_unit_quantity_check;
ALTER TABLE public.products DROP CONSTRAINT products_single_unit_quantity_check;
ALTER TABLE public.products DROP COLUMN quantity;

CREATE FUNCTION public.public_product(
  _shop_id uuid,
  _article text
) RETURNS TABLE(
  id uuid, shop_id uuid, shop_seq_id integer, shop_name text, name text,
  category text, metal text, metal_color text, weight numeric, size text,
  sku text, stones text, description text, sale_price numeric,
  status text, images text[], image_url text, created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.shop_id, s.seq_id, s.shop_name, p.name, p.category, p.metal,
         p.metal_color, p.weight, p.size, p.sku, p.stones, p.description,
         p.sale_price, p.status::text, p.images, p.image_url, p.created_at
    FROM public.products p
    LEFT JOIN public.shop_settings s ON s.shop_id = p.shop_id
   WHERE p.shop_id = _shop_id
     AND p.sku = upper(btrim(_article))
     AND coalesce(p.is_hidden, false) = false
   LIMIT 1;
$$;

CREATE FUNCTION public.public_product_by_seq(
  _shop_seq_id integer,
  _article text
) RETURNS TABLE(
  id uuid, shop_id uuid, shop_seq_id integer, shop_name text, name text,
  category text, metal text, metal_color text, weight numeric, size text,
  sku text, stones text, description text, sale_price numeric,
  status text, images text[], image_url text, created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.shop_id, s.seq_id, s.shop_name, p.name, p.category, p.metal,
         p.metal_color, p.weight, p.size, p.sku, p.stones, p.description,
         p.sale_price, p.status::text, p.images, p.image_url, p.created_at
    FROM public.products p
    JOIN public.shop_settings s ON s.shop_id = p.shop_id
   WHERE s.seq_id = _shop_seq_id
     AND p.sku = upper(btrim(_article))
     AND coalesce(p.is_hidden, false) = false
     AND s.public_enabled = true
   LIMIT 1;
$$;

CREATE FUNCTION public.public_shop_products(
  _shop_id uuid,
  _limit integer DEFAULT 24
) RETURNS TABLE(
  id uuid, shop_id uuid, shop_seq_id integer, shop_name text, name text,
  category text, metal text, metal_color text, weight numeric, size text,
  sku text, stones text, description text, sale_price numeric,
  status text, images text[], image_url text, created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.shop_id, s.seq_id, s.shop_name, p.name, p.category, p.metal,
         p.metal_color, p.weight, p.size, p.sku, p.stones, p.description,
         p.sale_price, p.status::text, p.images, p.image_url, p.created_at
    FROM public.products p
    LEFT JOIN public.shop_settings s ON s.shop_id = p.shop_id
   WHERE p.shop_id = _shop_id
     AND p.status = 'in_stock'
     AND coalesce(p.is_hidden, false) = false
   ORDER BY p.created_at DESC
   LIMIT _limit;
$$;

GRANT EXECUTE ON FUNCTION public.public_product(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_product_by_seq(integer, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_shop_products(uuid, integer) TO anon, authenticated;

-- v29/v30 created this function before quantity was removed. Recreate it so
-- existing databases do not retain a deferred reference to products.quantity.
CREATE OR REPLACE FUNCTION public.take_product_on_consignment(
  _product_id uuid,
  _device_info text DEFAULT NULL
) RETURNS public.supplier_debt_operations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_shop uuid := public.current_shop_id();
  v_product public.products;
  v_before numeric(14,2);
  v_amount numeric(14,2);
  v_supplier_name text;
  v_operation public.supplier_debt_operations;
BEGIN
  IF NOT public.is_approved() THEN
    RAISE EXCEPTION 'Аккаунт не подтверждён' USING errcode = '42501';
  END IF;

  SELECT * INTO v_product
    FROM public.products
   WHERE id = _product_id AND shop_id = v_shop
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Товар не найден'; END IF;

  v_supplier_name := NULLIF(btrim(v_product.supplier_name), '');
  IF v_supplier_name IS NULL THEN
    SELECT COALESCE(NULLIF(btrim(p.full_name), ''), 'Администратор')
      INTO v_supplier_name
      FROM public.profiles p
     WHERE p.id = auth.uid();
    v_supplier_name := COALESCE(v_supplier_name, 'Администратор');
    UPDATE public.products
       SET supplier_name = v_supplier_name
     WHERE id = v_product.id;
  END IF;

  IF v_product.consignment_operation_id IS NOT NULL THEN
    RAISE EXCEPTION 'Товар уже взят на реализацию';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    v_shop::text || ':supplier:' || v_supplier_name || ':' ||
    coalesce(nullif(btrim(v_product.supplier_phone), ''), ''), 0
  ));

  v_amount := round(coalesce(v_product.purchase_price, 0), 2);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'Закупочная стоимость товара должна быть больше нуля';
  END IF;

  SELECT coalesce(sum(
    CASE WHEN operation_type IN ('consignment','adjustment')
         THEN amount ELSE -amount END
  ), 0)
    INTO v_before
    FROM public.supplier_debt_operations
   WHERE shop_id = v_shop
     AND supplier_name = v_supplier_name
     AND supplier_phone IS NOT DISTINCT FROM nullif(btrim(v_product.supplier_phone), '');

  INSERT INTO public.supplier_debt_operations (
    shop_id, supplier_name, supplier_phone, operation_type, amount,
    balance_before, balance_after, product_id, reason, created_by, author_name, device_info
  )
  SELECT v_shop, v_supplier_name, nullif(btrim(v_product.supplier_phone), ''),
         'consignment', v_amount, v_before, v_before + v_amount, v_product.id,
         'Товар взят на реализацию', p.id, p.full_name, left(_device_info, 500)
    FROM public.profiles p
   WHERE p.id = auth.uid()
  RETURNING * INTO v_operation;

  UPDATE public.products
     SET consignment_operation_id = v_operation.id,
         consignment_at = v_operation.created_at,
         consignment_by = auth.uid()
   WHERE id = v_product.id;

  RETURN v_operation;
END;
$$;

GRANT EXECUTE ON FUNCTION public.take_product_on_consignment(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.sell_product(_product_id uuid)
RETURNS public.products
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE v_product public.products;
BEGIN
  UPDATE public.products
     SET status = 'sold'
   WHERE id = _product_id
     AND status = 'in_stock'
  RETURNING * INTO v_product;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Товар уже продан или недоступен' USING ERRCODE = 'P0001';
  END IF;
  RETURN v_product;
END;
$$;

REVOKE ALL ON FUNCTION public.sell_product(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sell_product(uuid) TO authenticated;
COMMIT;

-- Note: run this migration only after verifying the live ref
-- faxexmfzvkupsjamgtpa. Existing RLS policies and role grants are untouched.
