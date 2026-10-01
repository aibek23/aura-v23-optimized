-- =============================================================================
-- Migration v40: отмена ДОБАВЛЕНИЯ товара, ПРОДАЖИ и ДВИЖЕНИЯ ДЕНЕГ (касса).
-- Устанавливать ПОСЛЕ v39_action_history.sql. Выполнить один раз в SQL Editor.
--
--  * Новые записи истории: product_create, sale, cash_operation (AFTER INSERT).
--  * Отмена выполняется атомарно в public.undo_action и использует мягкое
--    удаление (deleted_at), поэтому офлайн-кэш на всех устройствах
--    синхронизируется штатным механизмом.
--  * Отмена продажи: товары возвращаются на склад (in_stock), откатываются
--    статистика клиента и бонусы продавца, связанные кассовые записи чека
--    скрываются. Продажу с оформленным возвратом отменить нельзя.
--  * Отмена кассовой операции: запись скрывается, баланс кассы пересчитывается.
--    Операции возврата и выплаты поставщику отменять нельзя (у них свои разделы).
--  * Отмена добавления товара: только если товар в наличии, не продавался и
--    не взят на реализацию.
--  * Отменять продажи и кассу может только администратор.
-- =============================================================================

BEGIN;

-- 1. Расширяем допустимые типы записей истории ------------------------------
ALTER TABLE public.action_history DROP CONSTRAINT IF EXISTS action_history_entity_type_check;
ALTER TABLE public.action_history ADD CONSTRAINT action_history_entity_type_check
  CHECK (entity_type IN ('product', 'metal_rate', 'product_create', 'sale', 'cash_operation'));

-- 2. Триггер записи истории при создании -------------------------------------
CREATE OR REPLACE FUNCTION public.capture_action_history_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_state jsonb := to_jsonb(NEW);
  v_type text := TG_ARGV[0];
  v_employee_id uuid := auth.uid();
  v_employee_name text;
  v_description text;
  v_op_label text;
BEGIN
  IF NEW.shop_id IS NULL THEN RETURN NEW; END IF;

  IF v_type = 'product_create' THEN
    v_description := 'Добавлен товар «' || left(coalesce(v_state ->> 'name', 'Без названия'), 180)
      || '» (' || coalesce(v_state ->> 'sku', 'без артикула') || ')';
  ELSIF v_type = 'sale' THEN
    v_description := 'Продажа на сумму ' || to_char(coalesce((v_state ->> 'total')::numeric, 0), 'FM999999999990')
      || ' с · позиций: ' || coalesce(jsonb_array_length(coalesce(v_state -> 'items', '[]'::jsonb)), 0)
      || CASE WHEN nullif(btrim(v_state ->> 'customer_name'), '') IS NOT NULL
              THEN ' · клиент: ' || left(v_state ->> 'customer_name', 80) ELSE '' END;
  ELSIF v_type = 'cash_operation' THEN
    v_op_label := CASE v_state ->> 'type'
      WHEN 'income' THEN 'Внесение'
      WHEN 'outcome' THEN 'Изъятие'
      WHEN 'collection' THEN 'Инкассация'
      ELSE 'Операция' END;
    v_description := 'Касса: ' || v_op_label || ' '
      || to_char(coalesce((v_state ->> 'amount')::numeric, 0), 'FM999999999990') || ' с'
      || CASE WHEN nullif(btrim(v_state ->> 'reason'), '') IS NOT NULL
              THEN ' — ' || left(v_state ->> 'reason', 120) ELSE '' END;
  ELSE
    RAISE EXCEPTION 'Unsupported action-history insert type: %', v_type;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.shop_id::text || ':action_history', 0));

  SELECT nullif(btrim(p.full_name), '') INTO v_employee_name
    FROM public.profiles p WHERE p.id = v_employee_id;
  v_employee_name := coalesce(v_employee_name, 'Система');

  INSERT INTO public.action_history (
    shop_id, entity_type, entity_id, prev_state, next_state, changed_fields,
    employee_id, employee_name, description
  ) VALUES (
    NEW.shop_id, v_type, NEW.id, '{}'::jsonb, v_state, ARRAY[]::text[],
    v_employee_id, v_employee_name, v_description
  );

  DELETE FROM public.action_history h
   WHERE h.shop_id = NEW.shop_id
     AND h.id IN (
       SELECT r.id FROM public.action_history r
        WHERE r.shop_id = NEW.shop_id
        ORDER BY r.seq DESC
        OFFSET 50
     );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.capture_action_history_insert() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS products_capture_action_history_insert ON public.products;
CREATE TRIGGER products_capture_action_history_insert
  AFTER INSERT ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.capture_action_history_insert('product_create');

DROP TRIGGER IF EXISTS sales_capture_action_history_insert ON public.sales;
CREATE TRIGGER sales_capture_action_history_insert
  AFTER INSERT ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.capture_action_history_insert('sale');

DROP TRIGGER IF EXISTS cash_operations_capture_action_history_insert ON public.cash_operations;
CREATE TRIGGER cash_operations_capture_action_history_insert
  AFTER INSERT ON public.cash_operations
  FOR EACH ROW EXECUTE FUNCTION public.capture_action_history_insert('cash_operation');

-- 3. Старую функцию отмены правок сохраняем под новым именем ----------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'undo_action'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'undo_edit_action'
  ) THEN
    ALTER FUNCTION public.undo_action(uuid) RENAME TO undo_edit_action;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.undo_edit_action(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- 4. Новая единая функция отмены --------------------------------------------
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
  v_sale public.sales;
  v_cash public.cash_operations;
  v_item jsonb;
  v_pid uuid;
  v_restored jsonb := '[]'::jsonb;
  v_removed_cash jsonb := '[]'::jsonb;
  v_row public.products;
  v_cash_row public.cash_operations;
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
  IF NOT FOUND THEN RAISE EXCEPTION 'Запись истории не найдена'; END IF;

  -- Правки карточек и курсов — прежняя логика v39 без изменений.
  IF v_action.entity_type IN ('product', 'metal_rate') THEN
    RETURN public.undo_edit_action(_action_id);
  END IF;

  IF v_action.entity_type IN ('sale', 'cash_operation') AND NOT public.is_shop_admin() THEN
    RAISE EXCEPTION 'Продажи и движение денег может отменять только администратор'
      USING errcode = '42501';
  END IF;

  -- ---------------------------------------------------- добавление товара
  IF v_action.entity_type = 'product_create' THEN
    SELECT * INTO v_product FROM public.products
     WHERE id = v_action.entity_id AND shop_id = v_shop_id FOR UPDATE;
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
  END IF;

  -- ---------------------------------------------------- продажа
  IF v_action.entity_type = 'sale' THEN
    SELECT * INTO v_sale FROM public.sales
     WHERE id = v_action.entity_id AND shop_id = v_shop_id FOR UPDATE;
    IF NOT FOUND OR v_sale.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'Продажа уже отменена или удалена';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.sale_returns r
       WHERE r.sale_id = v_sale.id AND r.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'По этому чеку уже оформлен возврат — отмена продажи невозможна';
    END IF;
  END IF;

  -- ---------------------------------------------------- касса
  IF v_action.entity_type = 'cash_operation' THEN
    SELECT * INTO v_cash FROM public.cash_operations
     WHERE id = v_action.entity_id AND shop_id = v_shop_id FOR UPDATE;
    IF NOT FOUND OR v_cash.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'Операция уже отменена или удалена';
    END IF;
    IF v_cash.supplier_debt_operation_id IS NOT NULL THEN
      RAISE EXCEPTION 'Это выплата поставщику — её нельзя отменить из истории, используйте раздел поставщиков';
    END IF;
    IF EXISTS (SELECT 1 FROM public.sale_returns r WHERE r.cash_operation_id = v_cash.id) THEN
      RAISE EXCEPTION 'Это выдача денег по возврату — её нельзя отменить отдельно от возврата';
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_shop_id::text || ':action_history', 0));
  SELECT * INTO v_action FROM public.action_history
   WHERE id = _action_id AND shop_id = v_shop_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Запись истории больше не доступна'; END IF;
  IF v_action.status <> 'active' THEN RAISE EXCEPTION 'Это действие уже отменено'; END IF;

  IF v_action.entity_type = 'product_create' THEN
    UPDATE public.products
       SET deleted_at = now(), updated_at = now()
     WHERE id = v_product.id
    RETURNING * INTO v_product;

  ELSIF v_action.entity_type = 'sale' THEN
    -- Возвращаем изделия на склад.
    FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(v_sale.items, '[]'::jsonb)) LOOP
      IF coalesce(v_item ->> 'kind', 'product') = 'product'
         AND nullif(v_item ->> 'product_id', '') IS NOT NULL THEN
        v_pid := (v_item ->> 'product_id')::uuid;
        UPDATE public.products
           SET status = 'in_stock', updated_at = now()
         WHERE id = v_pid AND shop_id = v_shop_id AND status = 'sold' AND deleted_at IS NULL
        RETURNING * INTO v_row;
        IF FOUND THEN v_restored := v_restored || jsonb_build_array(to_jsonb(v_row)); END IF;
      END IF;
    END LOOP;

    -- Статистика клиента.
    IF v_sale.customer_id IS NOT NULL THEN
      UPDATE public.customers
         SET purchase_count = greatest(0, purchase_count - 1),
             total_spent = greatest(0, total_spent - coalesce(v_sale.total, 0)),
             updated_at = now()
       WHERE id = v_sale.customer_id;
    END IF;

    -- Бонусы продавца: убрать начисленные, вернуть потраченные.
    IF v_sale.seller_id IS NOT NULL THEN
      UPDATE public.profiles
         SET bonus_points = greatest(0, coalesce(bonus_points, 0)
                                       - coalesce(v_sale.bonus_earned, 0)
                                       + coalesce(v_sale.bonus_used, 0))
       WHERE id = v_sale.seller_id;
    END IF;

    -- Кассовые записи, созданные вместе с чеком (офлайн-продажи, лом и т.п.).
    IF v_sale.client_op_id IS NOT NULL THEN
      FOR v_cash_row IN
        UPDATE public.cash_operations
           SET deleted_at = now(), updated_at = now()
         WHERE shop_id = v_shop_id AND deleted_at IS NULL
           AND client_op_id LIKE v_sale.client_op_id || ':%'
        RETURNING *
      LOOP
        v_removed_cash := v_removed_cash || jsonb_build_array(to_jsonb(v_cash_row));
      END LOOP;
    END IF;

    UPDATE public.sales
       SET deleted_at = now(), updated_at = now()
     WHERE id = v_sale.id
    RETURNING * INTO v_sale;

  ELSIF v_action.entity_type = 'cash_operation' THEN
    UPDATE public.cash_operations
       SET deleted_at = now(), updated_at = now()
     WHERE id = v_cash.id
    RETURNING * INTO v_cash;
  ELSE
    RAISE EXCEPTION 'Тип записи истории не поддерживается';
  END IF;

  UPDATE public.action_history
     SET status = 'undone', undone_at = now(), undone_by = v_user_id
   WHERE id = v_action.id;

  RETURN jsonb_build_object(
    'entity_type', v_action.entity_type,
    'removed_id', v_action.entity_id,
    'shop_id', v_shop_id,
    'removed_record', CASE v_action.entity_type
      WHEN 'product_create' THEN to_jsonb(v_product)
      WHEN 'sale' THEN to_jsonb(v_sale)
      ELSE to_jsonb(v_cash) END,
    'restored_products', v_restored,
    'removed_cash_operations', v_removed_cash
  );
END;
$$;

REVOKE ALL ON FUNCTION public.undo_action(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.undo_action(uuid) TO authenticated;

COMMENT ON FUNCTION public.undo_action(uuid) IS
  'Undo one shop-local history event: card/rate edits (v39), product creation, sale, or cash operation (v40, soft delete).';

COMMIT;
