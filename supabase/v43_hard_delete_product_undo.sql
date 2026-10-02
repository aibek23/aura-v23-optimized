-- =============================================================================
-- v43: Physically remove a newly-added product when its creation is undone.
-- Product deletion tombstones keep offline devices from resurrecting the row.
-- Run after v40_undo_create_sale_cash.sql.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.product_deletion_tombstones (
  shop_id uuid NOT NULL,
  product_id uuid NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (shop_id, product_id)
);

CREATE INDEX IF NOT EXISTS product_deletion_tombstones_shop_deleted_idx
  ON public.product_deletion_tombstones (shop_id, deleted_at, product_id);

ALTER TABLE public.product_deletion_tombstones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.product_deletion_tombstones FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.product_deletion_tombstones TO authenticated;

DROP POLICY IF EXISTS "product deletion tombstones: shop read"
  ON public.product_deletion_tombstones;
CREATE POLICY "product deletion tombstones: shop read"
  ON public.product_deletion_tombstones
  FOR SELECT TO authenticated
  USING (public.is_approved() AND shop_id = public.current_shop_id());

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'product_deletion_tombstones'
  ) THEN
    ALTER PUBLICATION supabase_realtime
      ADD TABLE public.product_deletion_tombstones;
  END IF;
END
$$;

-- Keep the v40 implementation for sales, cash operations and edit undos.
-- The public RPC below overrides only product-create undo.
DO $$
BEGIN
  IF to_regprocedure('public.undo_action_v40(uuid)') IS NULL THEN
    IF to_regprocedure('public.undo_action(uuid)') IS NULL THEN
      RAISE EXCEPTION 'Run v40_undo_create_sale_cash.sql before v43';
    END IF;
    ALTER FUNCTION public.undo_action(uuid) RENAME TO undo_action_v40;
  END IF;
END
$$;

REVOKE ALL ON FUNCTION public.undo_action_v40(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.undo_action(_action_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_shop_id uuid := public.current_shop_id();
  v_profile public.profiles;
  v_action public.action_history;
  v_product public.products;
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

  SELECT * INTO v_action FROM public.action_history
   WHERE id = _action_id AND shop_id = v_shop_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Запись истории не найдена';
  END IF;

  -- All undo behavior other than product creation stays in the tested v40 RPC.
  IF v_action.entity_type <> 'product_create' THEN
    RETURN public.undo_action_v40(_action_id);
  END IF;

  SELECT * INTO v_product FROM public.products
   WHERE id = v_action.entity_id AND shop_id = v_shop_id
   FOR UPDATE;
  IF NOT FOUND OR v_product.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Товар уже удалён';
  END IF;
  IF v_product.status IS DISTINCT FROM 'in_stock' THEN
    RAISE EXCEPTION 'Товар уже продан или списан — сначала отмените продажу';
  END IF;
  IF v_product.consignment_operation_id IS NOT NULL THEN
    RAISE EXCEPTION 'Товар взят на реализацию — долг поставщику уже начислен. Скорректируйте его в разделе поставщиков';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.sales s
     WHERE s.shop_id = v_shop_id AND s.deleted_at IS NULL
       AND s.items @> jsonb_build_array(jsonb_build_object('product_id', v_product.id::text))
  ) THEN
    RAISE EXCEPTION 'Товар участвовал в продаже — отмена добавления невозможна';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_shop_id::text || ':action_history', 0));
  SELECT * INTO v_action FROM public.action_history
   WHERE id = _action_id AND shop_id = v_shop_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Запись истории больше не доступна';
  END IF;
  IF v_action.status <> 'active' THEN
    RAISE EXCEPTION 'Это действие уже отменено';
  END IF;

  -- The journal row and hard delete commit atomically. Devices consume this
  -- durable tombstone during delta sync and purge the matching local cache row.
  INSERT INTO public.product_deletion_tombstones (shop_id, product_id)
  VALUES (v_shop_id, v_product.id)
  ON CONFLICT (shop_id, product_id)
  DO UPDATE SET deleted_at = EXCLUDED.deleted_at;

  DELETE FROM public.products
   WHERE id = v_product.id AND shop_id = v_shop_id
   RETURNING * INTO v_product;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Товар не найден';
  END IF;

  UPDATE public.action_history
     SET status = 'undone', undone_at = now(), undone_by = v_user_id
   WHERE id = v_action.id;

  RETURN jsonb_build_object(
    'entity_type', 'product_create',
    'removed_id', v_action.entity_id,
    'shop_id', v_shop_id,
    'removed_record', to_jsonb(v_product),
    'restored_products', '[]'::jsonb,
    'removed_cash_operations', '[]'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.undo_action(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.undo_action(uuid) TO authenticated;

COMMENT ON FUNCTION public.undo_action(uuid) IS
  'Undo a product creation by hard-deleting the unused product and recording a durable sync tombstone; delegate all other undo types to v40.';

COMMIT;