-- Enforce shop-level public storefront visibility in all public product endpoints.
-- The public_enabled setting already exists; administrators manage only their own shop.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.public_product(_shop_id uuid, _article text)
RETURNS TABLE(
  id uuid, shop_id uuid, shop_seq_id integer, shop_name text, name text,
  category text, metal text, metal_color text, weight numeric, size text,
  sku text, stones text, description text, sale_price numeric, status text,
  images text[], image_url text, created_at timestamp with time zone
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p.id, p.shop_id, s.seq_id, s.shop_name, p.name, p.category, p.metal,
         p.metal_color, p.weight, p.size, p.sku, p.stones, p.description,
         p.sale_price, p.status::text, p.images, p.image_url, p.created_at
    FROM public.products p
    JOIN public.shop_settings s ON s.shop_id = p.shop_id
   WHERE p.shop_id = _shop_id
     AND p.sku = upper(btrim(_article))
     AND coalesce(p.is_hidden, false) = false
     AND s.public_enabled = true
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.public_shop_products(_shop_id uuid, _limit integer DEFAULT 24)
RETURNS TABLE(
  id uuid, shop_id uuid, shop_seq_id integer, shop_name text, name text,
  category text, metal text, metal_color text, weight numeric, size text,
  sku text, stones text, description text, sale_price numeric, status text,
  images text[], image_url text, created_at timestamp with time zone
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p.id, p.shop_id, s.seq_id, s.shop_name, p.name, p.category, p.metal,
         p.metal_color, p.weight, p.size, p.sku, p.stones, p.description,
         p.sale_price, p.status::text, p.images, p.image_url, p.created_at
    FROM public.products p
    JOIN public.shop_settings s ON s.shop_id = p.shop_id
   WHERE p.shop_id = _shop_id
     AND p.status = 'in_stock'
     AND coalesce(p.is_hidden, false) = false
     AND s.public_enabled = true
   ORDER BY p.created_at DESC
   LIMIT _limit;
$$;

CREATE OR REPLACE FUNCTION public.public_shop_is_enabled(_shop_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.shop_settings AS ss
     WHERE ss.shop_id = _shop_id
       AND ss.public_enabled = true
  );
$$;

REVOKE ALL ON FUNCTION public.public_shop_is_enabled(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_shop_is_enabled(uuid) TO anon, authenticated;

COMMIT;
