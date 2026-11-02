-- Measure newly created product cards after rollout without charging or blocking.
-- Existing catalog rows are deliberately not backfilled: they are grandfathered.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE public.product_unit_usage (
  product_id uuid PRIMARY KEY,
  shop_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX product_unit_usage_shop_id_idx
  ON public.product_unit_usage (shop_id);

ALTER TABLE public.product_unit_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY product_unit_usage_read_own_shop
  ON public.product_unit_usage
  FOR SELECT
  TO authenticated
  USING (
    shop_id = public.current_shop_id()
    AND public.is_approved()
  );

REVOKE ALL ON TABLE public.product_unit_usage FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.product_unit_usage TO authenticated;

CREATE FUNCTION public.record_new_product_unit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  INSERT INTO public.product_unit_usage (product_id, shop_id)
  VALUES (NEW.id, NEW.shop_id)
  ON CONFLICT (product_id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.record_new_product_unit() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER products_record_new_unit
  AFTER INSERT ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.record_new_product_unit();

-- The ledger is append-only: sales, edits, sync retries and deletions do not
-- erase the fact that this product card was added.
CREATE FUNCTION public.superadmin_list_product_units()
RETURNS TABLE (shop_id uuid, units_used bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden: requires super_admin role'
      USING errcode = '42501';
  END IF;

  RETURN QUERY
  SELECT ss.shop_id, COALESCE(unit_counts.units_used, 0)::bigint
  FROM public.shop_settings AS ss
  LEFT JOIN (
    SELECT product_unit_usage.shop_id, count(*)::bigint AS units_used
    FROM public.product_unit_usage
    GROUP BY product_unit_usage.shop_id
  ) AS unit_counts ON unit_counts.shop_id = ss.shop_id
  ORDER BY ss.shop_id;
END;
$$;

REVOKE ALL ON FUNCTION public.superadmin_list_product_units() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.superadmin_list_product_units() TO authenticated;

COMMIT;
