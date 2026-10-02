-- =============================================================================
-- v44: Надёжное удаление товара из склада.
-- Прямой DELETE из клиента падал (RLS / права / связи). Теперь удаление идёт
-- через SECURITY DEFINER RPC: проверка доступа, tombstone для офлайн-устройств,
-- физическое удаление. Если товар связан с продажами — мягкое удаление.
-- Run after v43_hard_delete_product_undo.sql.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.delete_product(_product_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_shop_id uuid := public.current_shop_id();
  v_profile public.profiles;
  v_product public.products;
  v_mode text := 'hard';
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Требуется вход в систему' USING errcode = '42501';
  END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id;
  IF NOT FOUND OR v_profile.status IS DISTINCT FROM 'approved'::public.profile_status THEN
    RAISE EXCEPTION 'Аккаунт не подтверждён' USING errcode = '42501';
  END IF;
  IF v_shop_id IS NULL THEN
    RAISE EXCEPTION 'Активный магазин не выбран' USING errcode = '42501';
  END IF;

  SELECT * INTO v_product FROM public.products
   WHERE id = _product_id
   FOR UPDATE;
  IF NOT FOUND THEN
    -- Товара нет в облаке (уже удалён или создан офлайн и не синхронизирован):
    -- считаем удаление успешным и пишем tombstone, чтобы он не "воскрес".
    INSERT INTO public.product_deletion_tombstones (shop_id, product_id)
    VALUES (v_shop_id, _product_id)
    ON CONFLICT (shop_id, product_id) DO UPDATE SET deleted_at = EXCLUDED.deleted_at;
    RETURN jsonb_build_object('id', _product_id, 'mode', 'missing');
  END IF;
  IF v_product.shop_id IS DISTINCT FROM v_shop_id
     AND v_product.shop_id IS DISTINCT FROM v_profile.shop_id THEN
    RAISE EXCEPTION 'Товар принадлежит другому магазину' USING errcode = '42501';
  END IF;
  v_shop_id := v_product.shop_id;

  IF EXISTS (
    SELECT 1 FROM public.sales s
     WHERE s.shop_id = v_shop_id
       AND s.items @> jsonb_build_array(jsonb_build_object('product_id', _product_id::text))
  ) THEN
    v_mode := 'soft';
  END IF;

  IF v_mode = 'hard' THEN
    BEGIN
      DELETE FROM public.products WHERE id = _product_id AND shop_id = v_shop_id;
    EXCEPTION WHEN foreign_key_violation THEN
      v_mode := 'soft';
    END;
  END IF;

  IF v_mode = 'soft' THEN
    UPDATE public.products
       SET deleted_at = now(), updated_at = now()
     WHERE id = _product_id AND shop_id = v_shop_id;
  END IF;

  INSERT INTO public.product_deletion_tombstones (shop_id, product_id)
  VALUES (v_shop_id, _product_id)
  ON CONFLICT (shop_id, product_id)
  DO UPDATE SET deleted_at = EXCLUDED.deleted_at;

  RETURN jsonb_build_object('id', _product_id, 'mode', v_mode);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_product(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_product(uuid) TO authenticated;

COMMIT;
