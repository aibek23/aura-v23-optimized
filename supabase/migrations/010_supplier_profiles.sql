-- Persistent shop-scoped supplier contact cards and deletion protection.
CREATE TABLE IF NOT EXISTS public.supplier_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shop_settings(shop_id) ON DELETE CASCADE,
  identity_key text NOT NULL,
  supplier_name text NOT NULL CHECK (length(btrim(supplier_name)) BETWEEN 1 AND 200),
  supplier_phone text CHECK (supplier_phone IS NULL OR length(supplier_phone) <= 50),
  photo_path text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_profiles_shop_identity_key UNIQUE (shop_id, identity_key),
  CONSTRAINT supplier_profiles_photo_shop_path CHECK (
    photo_path IS NULL OR photo_path LIKE shop_id::text || '/supplier-profiles/%'
  )
);

ALTER TABLE public.supplier_profiles ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_profiles TO authenticated;

DROP POLICY IF EXISTS supplier_profiles_shop_select ON public.supplier_profiles;
CREATE POLICY supplier_profiles_shop_select
  ON public.supplier_profiles FOR SELECT TO authenticated
  USING (shop_id = public.current_shop_id() AND public.is_approved());

DROP POLICY IF EXISTS supplier_profiles_admin_write ON public.supplier_profiles;
CREATE POLICY supplier_profiles_admin_write
  ON public.supplier_profiles FOR ALL TO authenticated
  USING (shop_id = public.current_shop_id() AND public.is_shop_admin())
  WITH CHECK (shop_id = public.current_shop_id() AND public.is_shop_admin());

CREATE OR REPLACE FUNCTION public.delete_supplier_profile(
  _supplier_name text,
  _supplier_phone text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_shop uuid := public.current_shop_id();
  v_name text := btrim(_supplier_name);
  v_phone text := nullif(btrim(_supplier_phone), '');
  v_key text;
  v_balance numeric(14,2);
  v_photo_path text;
BEGIN
  IF NOT public.is_shop_admin() OR v_shop IS NULL THEN
    RAISE EXCEPTION 'Недостаточно прав' USING errcode = '42501';
  END IF;
  IF nullif(v_name, '') IS NULL THEN
    RAISE EXCEPTION 'Укажите поставщика' USING errcode = '22023';
  END IF;

  -- Uses the same lock key as supplier debt/payments so deletion cannot race
  -- with a new consignment or debt transaction.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    v_shop::text || ':supplier:' || lower(v_name) || ':' || coalesce(v_phone, ''), 0
  ));

  SELECT coalesce(sum(
    CASE WHEN operation_type IN ('consignment', 'adjustment') THEN amount ELSE -amount END
  ), 0)
    INTO v_balance
    FROM public.supplier_debt_operations
   WHERE shop_id = v_shop
     AND lower(btrim(supplier_name)) = lower(v_name)
     AND nullif(btrim(supplier_phone), '') IS NOT DISTINCT FROM v_phone;

  IF v_balance > 0 THEN
    RAISE EXCEPTION 'Нельзя удалить поставщика: долг составляет %', v_balance USING errcode = '22023';
  END IF;

  v_key := lower(v_name) || chr(31) || coalesce(v_phone, '');
  INSERT INTO public.supplier_profiles (
    shop_id, identity_key, supplier_name, supplier_phone, deleted_at
  ) VALUES (v_shop, v_key, v_name, v_phone, now())
  ON CONFLICT (shop_id, identity_key) DO UPDATE
    SET supplier_name = EXCLUDED.supplier_name,
        supplier_phone = EXCLUDED.supplier_phone,
        deleted_at = now(),
        updated_at = now()
  RETURNING photo_path INTO v_photo_path;

  RETURN coalesce(v_photo_path, '');
END;
$$;

REVOKE ALL ON FUNCTION public.delete_supplier_profile(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_supplier_profile(text, text) TO authenticated;

DROP POLICY IF EXISTS supplier_profile_shop_photo_delete ON storage.objects;
CREATE POLICY supplier_profile_shop_photo_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'product-images'
    AND public.is_shop_admin()
    AND (storage.foldername(name))[1] = public.current_shop_id()::text
    AND (storage.foldername(name))[2] = 'supplier-profiles'
  );
