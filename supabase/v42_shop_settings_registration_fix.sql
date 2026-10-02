-- AURA v42 — Ensure every registered shop has shop_settings.
-- Apply to existing installations after the earlier migrations.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_shop_name text := nullif(new.raw_user_meta_data ->> 'shop_name', '');
  v_shop_id   uuid;
BEGIN
  SELECT p.shop_id INTO v_shop_id
  FROM public.profiles p
  WHERE p.shop_name IS NOT DISTINCT FROM v_shop_name
    AND p.shop_id IS NOT NULL
  ORDER BY p.created_at ASC
  LIMIT 1;

  IF v_shop_id IS NULL THEN
    v_shop_id := gen_random_uuid();
  END IF;

  INSERT INTO public.profiles (
    id, full_name, shop_name, shop_id, phone, requested_role, email, status
  )
  VALUES (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    v_shop_name,
    v_shop_id,
    new.raw_user_meta_data ->> 'phone',
    new.raw_user_meta_data ->> 'requested_role',
    new.email,
    'pending'
  )
  ON CONFLICT (id) DO NOTHING;

  -- Also repairs the missing settings row if this registration joined an
  -- existing shop whose original trigger did not create one.
  INSERT INTO public.shop_settings AS existing (shop_id, shop_name)
  VALUES (v_shop_id, v_shop_name)
  ON CONFLICT (shop_id) DO UPDATE
    SET shop_name = COALESCE(existing.shop_name, EXCLUDED.shop_name);

  RETURN new;
END;
$$;

-- Keep the sequence ahead of both assigned IDs and its own current position.
-- This avoids duplicate seq_id values when the sequence lagged behind data.
SELECT setval(
  'public.shop_seq_id_seq',
  GREATEST(
    COALESCE((SELECT MAX(seq_id) FROM public.shop_settings), 0) + 1,
    (
      SELECT last_value + CASE WHEN is_called THEN 1 ELSE 0 END
      FROM public.shop_seq_id_seq
    )
  ),
  false
);

-- Backfill shops whose profiles were created before this trigger fix.
INSERT INTO public.shop_settings (shop_id, shop_name)
SELECT DISTINCT ON (p.shop_id) p.shop_id, p.shop_name
FROM public.profiles p
LEFT JOIN public.shop_settings s ON s.shop_id = p.shop_id
WHERE p.shop_id IS NOT NULL
  AND s.shop_id IS NULL
ORDER BY p.shop_id, p.created_at ASC
ON CONFLICT (shop_id) DO NOTHING;