-- =============================================================================
-- Migration v39: shop-scoped, atomic history for product-card and metal-rate edits.
-- Install after v35_sync_engine_support.sql (and the other v38 migrations).
-- =============================================================================

BEGIN;

-- Keep the undo suppression marker in a schema that is not exposed through the
-- Supabase Data API. Authenticated clients cannot set this marker themselves.
CREATE SCHEMA IF NOT EXISTS action_history_private;
REVOKE ALL ON SCHEMA action_history_private FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS action_history_private.undo_guard (
  transaction_id bigint NOT NULL,
  backend_pid integer NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  PRIMARY KEY (transaction_id, backend_pid, entity_type, entity_id)
);
REVOKE ALL ON TABLE action_history_private.undo_guard FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.action_history (
  seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('product', 'metal_rate')),
  entity_id uuid NOT NULL,
  prev_state jsonb NOT NULL,
  next_state jsonb NOT NULL,
  changed_fields text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  employee_id uuid,
  employee_name text NOT NULL DEFAULT 'Система',
  description text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'undone')),
  undone_at timestamptz,
  undone_by uuid
);

CREATE INDEX IF NOT EXISTS action_history_shop_seq_idx
  ON public.action_history (shop_id, seq DESC);

ALTER TABLE public.action_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS action_history_shop_read ON public.action_history;
CREATE POLICY action_history_shop_read ON public.action_history
  FOR SELECT TO authenticated
  USING (shop_id = public.current_shop_id() AND public.is_approved());

-- The JSON snapshots and changed_fields include confidential card data (notably
-- purchase prices). They are available only to the trusted trigger/undo routines.
REVOKE ALL ON TABLE public.action_history FROM PUBLIC, anon, authenticated, service_role;
REVOKE SELECT (prev_state, next_state, changed_fields)
  ON TABLE public.action_history FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT (
  seq, id, shop_id, entity_type, entity_id, created_at,
  employee_id, employee_name, description, status, undone_at, undone_by
) ON public.action_history TO authenticated;
REVOKE ALL ON SEQUENCE public.action_history_seq_seq FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE public.action_history IS
  'Shop-scoped product-card and metal-rate edit history. Retains at most the newest 50 events per shop; snapshots are intentionally not granted to authenticated clients.';
COMMENT ON COLUMN public.action_history.seq IS
  'Global identity ordering key; retention is independently enforced per shop.';
COMMENT ON COLUMN public.action_history.prev_state IS
  'Full row snapshot before the update. Never expose through authenticated SELECT grants.';
COMMENT ON COLUMN public.action_history.next_state IS
  'Full row snapshot after the update. Undo restores only changed_fields, preserving later status, consignment, and sales lifecycle changes.';
COMMENT ON COLUMN public.action_history.changed_fields IS
  'Whitelist of changed business fields. Only these fields are conflict-checked and restored.';
COMMENT ON COLUMN public.action_history.description IS
  'Safe display description containing field labels only, never values such as purchase prices.';
COMMENT ON COLUMN public.action_history.status IS
  'Undoable events remain in history and become undone rather than being deleted.';

CREATE OR REPLACE FUNCTION public.capture_action_history_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_old_state jsonb := to_jsonb(OLD);
  v_new_state jsonb := to_jsonb(NEW);
  v_shop_id uuid;
  v_employee_id uuid := auth.uid();
  v_employee_name text;
  v_entity_type text;
  v_field text;
  v_fields text[] := ARRAY[]::text[];
  v_labels text[] := ARRAY[]::text[];
  v_description text;
BEGIN
  -- Undo inserts a private transaction-scoped marker before its entity UPDATE.
  -- This cannot be bypassed by setting a client-controlled custom GUC.
  IF EXISTS (
    SELECT 1
      FROM action_history_private.undo_guard g
     WHERE g.transaction_id = txid_current()
       AND g.backend_pid = pg_backend_pid()
       AND g.entity_type = TG_ARGV[0]
       AND g.entity_id = OLD.id
  ) THEN
    RETURN NEW;
  END IF;

  -- Entity identity and store ownership are not editable card fields.
  IF OLD.id IS DISTINCT FROM NEW.id OR OLD.shop_id IS DISTINCT FROM NEW.shop_id THEN
    RETURN NEW;
  END IF;

  v_shop_id := OLD.shop_id;
  v_entity_type := TG_ARGV[0];

  IF v_entity_type = 'product' THEN
    FOREACH v_field IN ARRAY ARRAY[
      'name', 'category', 'metal', 'metal_color', 'weight', 'size',
      'purchase_price', 'purchase_price_visible', 'price_per_gram_sale',
      'price_per_gram_purchase', 'price_per_gram_purchase_visible',
      'stones', 'description', 'sale_price', 'image_url', 'images',
      'supplier_name', 'supplier_phone', 'is_hidden'
    ] LOOP
      IF (v_old_state -> v_field) IS DISTINCT FROM (v_new_state -> v_field) THEN
        v_fields := array_append(v_fields, v_field);
        v_labels := array_append(v_labels, CASE v_field
          WHEN 'name' THEN 'Название'
          WHEN 'category' THEN 'Категория'
          WHEN 'metal' THEN 'Металл'
          WHEN 'metal_color' THEN 'Цвет металла'
          WHEN 'weight' THEN 'Вес'
          WHEN 'size' THEN 'Размер'
          WHEN 'purchase_price' THEN 'Закупочная цена'
          WHEN 'purchase_price_visible' THEN 'Видимая закупочная цена'
          WHEN 'price_per_gram_sale' THEN 'Курс продажи'
          WHEN 'price_per_gram_purchase' THEN 'Курс закупки'
          WHEN 'price_per_gram_purchase_visible' THEN 'Видимый курс закупки'
          WHEN 'stones' THEN 'Вставки'
          WHEN 'description' THEN 'Описание'
          WHEN 'sale_price' THEN 'Цена продажи'
          WHEN 'image_url' THEN 'Изображение'
          WHEN 'images' THEN 'Изображения'
          WHEN 'supplier_name' THEN 'Поставщик'
          WHEN 'supplier_phone' THEN 'Телефон поставщика'
          WHEN 'is_hidden' THEN 'Видимость товара'
        END);
      END IF;
    END LOOP;
  ELSIF v_entity_type = 'metal_rate' THEN
    FOREACH v_field IN ARRAY ARRAY['price_per_gram', 'scrap_price_per_gram'] LOOP
      IF (v_old_state -> v_field) IS DISTINCT FROM (v_new_state -> v_field) THEN
        v_fields := array_append(v_fields, v_field);
        v_labels := array_append(v_labels, CASE v_field
          WHEN 'price_per_gram' THEN 'Курс за грамм'
          WHEN 'scrap_price_per_gram' THEN 'Цена лома за грамм'
        END);
      END IF;
    END LOOP;
  ELSE
    RAISE EXCEPTION 'Unsupported action-history entity type: %', v_entity_type;
  END IF;

  -- updated_at and all non-whitelisted/lifecycle fields are intentionally ignored.
  IF cardinality(v_fields) = 0 THEN
    RETURN NEW;
  END IF;

  -- Serialize history insertion and pruning for this shop. The UPDATE already
  -- holds the entity row lock, matching undo_action's entity -> shop -> event order.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_shop_id::text || ':action_history', 0));

  SELECT nullif(btrim(p.full_name), '')
    INTO v_employee_name
    FROM public.profiles p
   WHERE p.id = v_employee_id;
  v_employee_name := coalesce(v_employee_name, 'Система');
  v_description := CASE v_entity_type
    WHEN 'product' THEN 'Товар «' || left(coalesce(v_new_state ->> 'name', v_old_state ->> 'name', 'Без названия'), 180)
      || '» (' || coalesce(v_new_state ->> 'sku', v_old_state ->> 'sku', 'без артикула') || '): '
    ELSE 'Курс «' || coalesce(v_new_state ->> 'metal', v_old_state ->> 'metal', 'Металл') || '»: '
  END || array_to_string(v_labels, ', ');

  INSERT INTO public.action_history (
    shop_id, entity_type, entity_id, prev_state, next_state, changed_fields,
    employee_id, employee_name, description
  ) VALUES (
    v_shop_id, v_entity_type, OLD.id, v_old_state, v_new_state, v_fields,
    v_employee_id, v_employee_name, v_description
  );

  DELETE FROM public.action_history h
   WHERE h.shop_id = v_shop_id
     AND h.id IN (
       SELECT retained.id
         FROM public.action_history retained
        WHERE retained.shop_id = v_shop_id
        ORDER BY retained.seq DESC
        OFFSET 50
     );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.capture_action_history_update() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS products_capture_action_history ON public.products;
CREATE TRIGGER products_capture_action_history
  AFTER UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.capture_action_history_update('product');

DROP TRIGGER IF EXISTS metal_rates_capture_action_history ON public.metal_rates;
CREATE TRIGGER metal_rates_capture_action_history
  AFTER UPDATE ON public.metal_rates
  FOR EACH ROW
  EXECUTE FUNCTION public.capture_action_history_update('metal_rate');

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
  v_initial public.action_history;
  v_action public.action_history;
  v_product public.products;
  v_metal_rate public.metal_rates;
  v_current_state jsonb;
  v_patch jsonb := '{}'::jsonb;
  v_field text;
  v_fields text[];
  v_allowed text[];
  v_assignments text;
  v_sql text;
  v_result jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Требуется вход в систему' USING errcode = '42501';
  END IF;
  SELECT * INTO v_profile
    FROM public.profiles
   WHERE id = v_user_id;
  IF NOT FOUND OR v_profile.status IS DISTINCT FROM 'approved'::public.profile_status THEN
    RAISE EXCEPTION 'Аккаунт не подтверждён' USING errcode = '42501';
  END IF;
  IF v_shop_id IS NULL THEN
    RAISE EXCEPTION 'Активный магазин не выбран' USING errcode = '42501';
  END IF;

  -- This unlocked read locates the entity. The event is re-read FOR UPDATE only
  -- after taking locks in entity -> shop-retention -> event order.
  SELECT * INTO v_initial
    FROM public.action_history
   WHERE id = _action_id AND shop_id = v_shop_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Запись истории не найдена';
  END IF;
  -- Match the existing administrator-only metal_rates write policy; a
  -- SECURITY DEFINER undo must not grant sellers a new way to change rates.
  IF v_initial.entity_type = 'metal_rate' AND NOT public.is_shop_admin() THEN
    RAISE EXCEPTION 'Курсы металлов может отменять только администратор'
      USING errcode = '42501';
  END IF;

  IF v_initial.entity_type = 'product' THEN
    SELECT * INTO v_product
      FROM public.products
     WHERE id = v_initial.entity_id AND shop_id = v_shop_id
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Товар не найден'; END IF;
  ELSIF v_initial.entity_type = 'metal_rate' THEN
    SELECT * INTO v_metal_rate
      FROM public.metal_rates
     WHERE id = v_initial.entity_id AND shop_id = v_shop_id
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Курс металла не найден'; END IF;
  ELSE
    RAISE EXCEPTION 'Тип записи истории не поддерживается';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_shop_id::text || ':action_history', 0));

  SELECT * INTO v_action
    FROM public.action_history
   WHERE id = _action_id AND shop_id = v_shop_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Запись истории больше не доступна'; END IF;
  IF v_action.status <> 'active' THEN
    RAISE EXCEPTION 'Это действие уже отменено';
  END IF;
  IF v_action.entity_type <> v_initial.entity_type
     OR v_action.entity_id <> v_initial.entity_id THEN
    RAISE EXCEPTION 'Запись истории изменилась, обновите страницу';
  END IF;

  IF v_action.entity_type = 'product' THEN
    v_current_state := to_jsonb(v_product);
    v_allowed := ARRAY[
      'name', 'category', 'metal', 'metal_color', 'weight', 'size',
      'purchase_price', 'purchase_price_visible', 'price_per_gram_sale',
      'price_per_gram_purchase', 'price_per_gram_purchase_visible',
      'stones', 'description', 'sale_price', 'image_url', 'images',
      'supplier_name', 'supplier_phone', 'is_hidden'
    ];
  ELSE
    v_current_state := to_jsonb(v_metal_rate);
    v_allowed := ARRAY['price_per_gram', 'scrap_price_per_gram'];
  END IF;

  v_fields := v_action.changed_fields;
  IF cardinality(v_fields) = 0 THEN
    RAISE EXCEPTION 'В записи истории нет восстанавливаемых полей';
  END IF;

  FOREACH v_field IN ARRAY v_fields LOOP
    IF NOT (v_field = ANY(v_allowed)) THEN
      RAISE EXCEPTION 'В записи истории содержится недопустимое поле';
    END IF;
    IF (v_current_state -> v_field) IS DISTINCT FROM (v_action.next_state -> v_field) THEN
      RAISE EXCEPTION 'Поле "%" изменено позже; отмена невозможна', v_field;
    END IF;
    v_patch := v_patch || jsonb_build_object(v_field, v_action.prev_state -> v_field);
  END LOOP;

  IF v_action.entity_type = 'product' THEN
    -- Populate the existing typed row, then update only whitelisted event fields.
    v_product := jsonb_populate_record(v_product, v_patch);
    SELECT string_agg(format('%1$I = ($2).%1$I', field), ', ')
      INTO v_assignments
      FROM unnest(v_fields) AS fields(field);
    v_sql := format(
      'UPDATE public.products SET %s WHERE id = $1 AND shop_id = $3 RETURNING *',
      v_assignments
    );
    INSERT INTO action_history_private.undo_guard
      (transaction_id, backend_pid, entity_type, entity_id)
    VALUES (txid_current(), pg_backend_pid(), 'product', v_action.entity_id);
    EXECUTE v_sql INTO v_product USING v_product.id, v_product, v_shop_id;
    DELETE FROM action_history_private.undo_guard
     WHERE transaction_id = txid_current()
       AND backend_pid = pg_backend_pid()
       AND entity_type = 'product'
       AND entity_id = v_action.entity_id;
    v_result := jsonb_build_object(
      'entity_type', 'product',
      'record', to_jsonb(v_product)
    );
  ELSE
    v_metal_rate := jsonb_populate_record(v_metal_rate, v_patch);
    SELECT string_agg(format('%1$I = ($2).%1$I', field), ', ')
      INTO v_assignments
      FROM unnest(v_fields) AS fields(field);
    v_sql := format(
      'UPDATE public.metal_rates SET %s WHERE id = $1 AND shop_id = $3 RETURNING *',
      v_assignments
    );
    INSERT INTO action_history_private.undo_guard
      (transaction_id, backend_pid, entity_type, entity_id)
    VALUES (txid_current(), pg_backend_pid(), 'metal_rate', v_action.entity_id);
    EXECUTE v_sql INTO v_metal_rate USING v_metal_rate.id, v_metal_rate, v_shop_id;
    DELETE FROM action_history_private.undo_guard
     WHERE transaction_id = txid_current()
       AND backend_pid = pg_backend_pid()
       AND entity_type = 'metal_rate'
       AND entity_id = v_action.entity_id;
    v_result := jsonb_build_object(
      'entity_type', 'metal_rate',
      'record', to_jsonb(v_metal_rate)
    );
  END IF;

  UPDATE public.action_history
     SET status = 'undone',
         undone_at = now(),
         undone_by = v_user_id
   WHERE id = v_action.id;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.undo_action(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.undo_action(uuid) TO authenticated;

COMMENT ON FUNCTION public.undo_action(uuid) IS
  'Undo one active shop-local card/rate edit. Requires an approved profile and matching active shop; locks entity, shop retention stream, then event, rejects conflicting edits, and restores only whitelisted changed fields. Purchase-price card edits do not alter supplier_debt_operations or other supplier accounting ledgers.';

COMMIT;