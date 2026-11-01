-- Exact duplicate indexes were omitted; the canonical equivalent indexes are retained.
-- Aura Gold CRM application schema for Supabase PostgreSQL.
-- Supabase-managed schemas are excluded; only CRM-owned objects are included.
-- Apply once to a new Supabase project. See README.md for deployment steps.

SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET client_min_messages = warning;
SET row_security = off;

CREATE SCHEMA IF NOT EXISTS action_history_private;
CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;

-- Name: citext; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;


--
-- Name: app_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.app_role AS ENUM (
    'seller',
    'admin',
    'super_admin'
);


--
-- Name: cash_op_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.cash_op_type AS ENUM (
    'income',
    'outcome',
    'collection'
);


--
-- Name: product_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.product_status AS ENUM (
    'in_stock',
    'reserved',
    'sold',
    'archived',
    'draft'
);


--
-- Name: profile_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.profile_status AS ENUM (
    'pending',
    'approved',
    'rejected'
);


--
-- Name: supplier_debt_operation_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.supplier_debt_operation_type AS ENUM (
    'consignment',
    'adjustment',
    'payment'
);


--
-- Name: add_bonus_points(numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_bonus_points(_amount numeric) RETURNS numeric
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_total numeric;
begin
  if not public.is_approved() then
    raise exception 'Аккаунт не подтверждён' using errcode = '42501';
  end if;
  if _amount is null or _amount < 0 then
    raise exception 'Некорректное количество бонусов' using errcode = '22023';
  end if;
  update public.profiles
     set bonus_points = coalesce(bonus_points,0) + _amount
   where id = auth.uid()
  returning bonus_points into v_total;
  return coalesce(v_total, 0);
end $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: supplier_debt_operations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_debt_operations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_id uuid NOT NULL,
    supplier_name public.citext NOT NULL,
    supplier_phone text,
    operation_type public.supplier_debt_operation_type NOT NULL,
    amount numeric(14,2) NOT NULL,
    balance_before numeric(14,2) DEFAULT 0 NOT NULL,
    balance_after numeric(14,2) DEFAULT 0 NOT NULL,
    product_id uuid,
    cash_operation_id uuid,
    source text,
    amount_cash numeric(14,2) DEFAULT 0 NOT NULL,
    amount_electronic numeric(14,2) DEFAULT 0 NOT NULL,
    reason text DEFAULT ''::text NOT NULL,
    created_by uuid NOT NULL,
    author_name text,
    device_info text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    client_op_id text,
    deleted_at timestamp with time zone,
    CONSTRAINT supplier_debt_operations_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT supplier_debt_operations_balance_after_check CHECK ((balance_after >= (0)::numeric)),
    CONSTRAINT supplier_debt_operations_source_check CHECK (((source IS NULL) OR (source = ANY (ARRAY['cash'::text, 'electronic'::text, 'mixed'::text]))))
);


--
-- Name: adjust_supplier_debt(text, text, numeric, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.adjust_supplier_debt(_supplier_name text, _supplier_phone text, _amount numeric, _reason text, _device_info text DEFAULT NULL::text) RETURNS public.supplier_debt_operations
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_shop uuid := public.current_shop_id();
  v_supplier_name text := btrim(_supplier_name);
  v_supplier_phone text := nullif(btrim(_supplier_phone), '');
  v_before numeric(14,2);
  v_operation public.supplier_debt_operations;
BEGIN
  IF NOT public.is_shop_admin() THEN
    RAISE EXCEPTION 'Недостаточно прав' USING errcode = '42501';
  END IF;
  IF nullif(v_supplier_name, '') IS NULL THEN RAISE EXCEPTION 'Укажите поставщика'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Сумма должна быть больше нуля'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    v_shop::text || ':supplier:' || lower(v_supplier_name) || ':' ||
    coalesce(v_supplier_phone, ''), 0
  ));

  SELECT coalesce(sum(
    CASE WHEN operation_type IN ('consignment','adjustment')
         THEN amount ELSE -amount END
  ), 0)
    INTO v_before
    FROM public.supplier_debt_operations
   WHERE shop_id = v_shop
     AND lower(btrim(supplier_name)) = lower(v_supplier_name)
     AND nullif(btrim(supplier_phone), '') IS NOT DISTINCT FROM v_supplier_phone;

  INSERT INTO public.supplier_debt_operations (
    shop_id, supplier_name, supplier_phone, operation_type, amount,
    balance_before, balance_after, reason, created_by, author_name, device_info
  )
  SELECT v_shop, v_supplier_name, v_supplier_phone,
         'adjustment', round(_amount, 2), v_before, v_before + round(_amount, 2),
         left(btrim(_reason), 500), p.id, p.full_name, left(_device_info, 500)
    FROM public.profiles p
   WHERE p.id = auth.uid()
  RETURNING * INTO v_operation;

  RETURN v_operation;
END;
$$;


--
-- Name: assign_shop_seq_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assign_shop_seq_id() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.seq_id IS NULL THEN
    NEW.seq_id := nextval('public.shop_seq_id_seq');
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: capture_action_history_insert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.capture_action_history_insert() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
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


--
-- Name: capture_action_history_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.capture_action_history_update() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
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


--
-- Name: cash_ledger_balances(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cash_ledger_balances(_shop uuid) RETURNS TABLE(cash numeric, electronic numeric)
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  WITH operation_splits AS (
    SELECT co.type,
      CASE
        WHEN co.source = 'electronic' THEN 0
        WHEN co.source = 'mixed' THEN
          CASE WHEN coalesce(co.amount_cash, 0) + coalesce(co.amount_electronic, 0) <= 0
            THEN co.amount ELSE coalesce(co.amount_cash, 0) END
        ELSE co.amount
      END AS cash_part,
      CASE
        WHEN co.source = 'electronic' THEN co.amount
        WHEN co.source = 'mixed' THEN
          CASE WHEN coalesce(co.amount_cash, 0) + coalesce(co.amount_electronic, 0) <= 0
            THEN 0 ELSE coalesce(co.amount_electronic, 0) END
        ELSE 0
      END AS electronic_part
    FROM public.cash_operations co
    WHERE co.shop_id = _shop AND co.deleted_at IS NULL
      -- Atomic receipts have a cash mirror. Count the receipt only once.
      AND NOT EXISTS (
        SELECT 1 FROM public.sales s
        WHERE s.shop_id = co.shop_id AND s.deleted_at IS NULL
          AND s.client_op_id IS NOT NULL
          AND co.client_op_id = s.client_op_id || ':cash'
      )
  ),
  operation_balance AS (
    SELECT
      coalesce(sum(CASE
        WHEN type = 'collection' THEN -(cash_part + electronic_part)
        WHEN type = 'income' THEN cash_part ELSE -cash_part END), 0) AS cash,
      coalesce(sum(CASE
        WHEN type = 'collection' THEN cash_part + electronic_part
        WHEN type = 'income' THEN electronic_part ELSE -electronic_part END), 0) AS electronic
    FROM operation_splits
  ),
  sale_balance AS (
    SELECT
      coalesce(sum(CASE
        WHEN payment_method = 'mixed' THEN
          CASE WHEN coalesce(amount_cash, 0) + coalesce(amount_electronic, 0) <= 0
            THEN coalesce(total, 0) ELSE coalesce(amount_cash, 0) END
        WHEN payment_method IN ('card', 'transfer') THEN 0
        ELSE coalesce(total, 0) END), 0) AS cash,
      coalesce(sum(CASE
        WHEN payment_method = 'mixed' THEN
          CASE WHEN coalesce(amount_cash, 0) + coalesce(amount_electronic, 0) <= 0
            THEN 0 ELSE coalesce(amount_electronic, 0) END
        WHEN payment_method IN ('card', 'transfer') THEN coalesce(total, 0)
        ELSE 0 END), 0) AS electronic
    FROM public.sales
    WHERE shop_id = _shop AND deleted_at IS NULL
  )
  SELECT ob.cash + sb.cash, ob.electronic + sb.electronic
  FROM operation_balance ob CROSS JOIN sale_balance sb;
$$;


--
-- Name: commit_offline_sale(text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.commit_offline_sale(_client_op_id text, _sale jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile public.profiles%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_sale_id uuid;
  v_existing_sale_id uuid;
  v_customer_id uuid;
  v_customer_name text;
  v_customer_phone text;
  v_cash_operation_id uuid;
  v_shop_id uuid;
  v_item jsonb;
  v_item_id uuid;
  v_product_ids uuid[] := ARRAY[]::uuid[];
  v_validated_items jsonb := '[]'::jsonb;
  v_payment_method text;
  v_price numeric;
  v_cost numeric;
  v_weight numeric;
  v_subtotal numeric := 0;
  v_cost_total numeric := 0;
  v_bonus_used numeric := 0;
  v_bonus_earned numeric := 0;
  v_shop_bonus_rate numeric;
  v_total numeric := 0;
  v_amount_cash numeric := 0;
  v_amount_electronic numeric := 0;
  v_created_at timestamptz;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Требуется авторизация' USING ERRCODE = '42501';
  END IF;

  IF _client_op_id IS NULL OR btrim(_client_op_id) = '' THEN
    RAISE EXCEPTION 'Не указан идентификатор продажи' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_profile
    FROM public.profiles
   WHERE id = v_user_id
   FOR UPDATE;

  -- Match RLS and the server action's active shop, including impersonation.
  v_shop_id := public.current_shop_id();
  IF NOT FOUND OR v_profile.status::text <> 'approved' OR v_shop_id IS NULL THEN
    RAISE EXCEPTION 'Нет доступа к магазину' USING ERRCODE = '42501';
  END IF;

  IF _sale IS NULL OR jsonb_typeof(_sale) <> 'object' THEN
    RAISE EXCEPTION 'Некорректные данные продажи' USING ERRCODE = '22023';
  END IF;
  IF coalesce(jsonb_typeof(_sale->'items'), 'null') <> 'array' THEN
    RAISE EXCEPTION 'Некорректный список товаров в чеке' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(_sale->'items') = 0 OR jsonb_array_length(_sale->'items') > 200 THEN
    RAISE EXCEPTION 'В чеке должно быть от 1 до 200 позиций' USING ERRCODE = '22023';
  END IF;

  -- A retry after a lost response must return the already-committed receipt.
  -- Serializing by operation id closes the gap before the row is inserted.
  PERFORM pg_advisory_xact_lock(hashtextextended('offline-sale:' || _client_op_id, 0));
  SELECT id INTO v_existing_sale_id
    FROM public.sales
   WHERE shop_id = v_shop_id AND client_op_id = _client_op_id
   LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'accepted', true,
      'duplicate', true,
      'sale_id', v_existing_sale_id
    );
  END IF;

  v_payment_method := coalesce(_sale->>'payment_method', 'cash');
  IF v_payment_method NOT IN ('cash', 'card', 'transfer', 'mixed') THEN
    RAISE EXCEPTION 'Некорректный способ оплаты' USING ERRCODE = '22023';
  END IF;

  -- Validate ids and prevent adding the same unique item twice. Lock every
  -- existing product row in UUID order so concurrent multi-item sales cannot
  -- deadlock by locking the same products in different cart orders.
  FOR v_item IN SELECT value FROM jsonb_array_elements(_sale->'items')
  LOOP
    IF coalesce(v_item->>'kind', 'product') <> 'scrap' THEN
      IF coalesce((v_item->>'quantity')::integer, 1) <> 1 THEN
        RAISE EXCEPTION 'Количество изделия должно быть равно 1' USING ERRCODE = '22023';
      END IF;

      v_item_id := coalesce(
        nullif(v_item->>'product_id', '')::uuid,
        nullif(v_item->>'id', '')::uuid
      );
      IF v_item_id IS NULL THEN
        RAISE EXCEPTION 'В позиции не указан товар' USING ERRCODE = '22023';
      END IF;
      IF v_item_id = ANY(v_product_ids) THEN
        RAISE EXCEPTION 'Одно изделие нельзя добавить в чек дважды' USING ERRCODE = '22023';
      END IF;
      v_product_ids := array_append(v_product_ids, v_item_id);
    END IF;
  END LOOP;

  PERFORM p.id
    FROM public.products AS p
   WHERE p.shop_id = v_shop_id
     AND p.id = ANY(v_product_ids)
   ORDER BY p.id
   FOR UPDATE;

  -- Rebuild line items using server-side product identity/cost and reject the
  -- whole receipt if any item is missing or has already been sold.
  FOR v_item IN SELECT value FROM jsonb_array_elements(_sale->'items')
  LOOP
    IF coalesce(v_item->>'kind', 'product') = 'scrap' THEN
      v_weight := coalesce(nullif(v_item->>'weight', '')::numeric, 0);
      v_price := coalesce(nullif(v_item->>'price', '')::numeric, -1);
      IF v_weight <= 0 OR v_weight > 100000 OR v_price <= 0 THEN
        RAISE EXCEPTION 'Некорректные данные лома' USING ERRCODE = '22023';
      END IF;
      v_price := round(v_price);
      v_cost := v_price;
      v_subtotal := v_subtotal + v_price;
      v_cost_total := v_cost_total + v_cost;
      v_validated_items := v_validated_items || jsonb_build_array(
        v_item || jsonb_build_object(
          'kind', 'scrap',
          'product_id', NULL,
          'quantity', 1,
          'weight', v_weight,
          'price', v_price,
          'cost', v_cost
        )
      );
      CONTINUE;
    END IF;

    v_item_id := coalesce(
      nullif(v_item->>'product_id', '')::uuid,
      nullif(v_item->>'id', '')::uuid
    );
    SELECT * INTO v_product
      FROM public.products AS p
     WHERE p.id = v_item_id
       AND p.shop_id = v_shop_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'accepted', false,
        'code', 'stock_conflict',
        'product_id', v_item_id,
        'product_name', coalesce(v_item->>'name', 'Товар')
      );
    END IF;

    IF v_product.status::text <> 'in_stock' OR v_product.deleted_at IS NOT NULL THEN
      RETURN jsonb_build_object(
        'accepted', false,
        'code', 'stock_conflict',
        'product_id', v_product.id,
        'product_name', v_product.name
      );
    END IF;

    v_price := coalesce(nullif(v_item->>'price', '')::numeric, -1);
    IF v_price < 0 OR (v_product.sale_price > 0 AND v_price > v_product.sale_price * 10) THEN
      RAISE EXCEPTION 'Некорректная цена для «%»', v_product.name USING ERRCODE = '22023';
    END IF;
    v_price := round(v_price);

    v_cost := coalesce(v_product.purchase_price, 0);
    v_subtotal := v_subtotal + v_price;
    v_cost_total := v_cost_total + v_cost;
    v_validated_items := v_validated_items || jsonb_build_array(
      v_item || jsonb_build_object(
        'kind', 'product',
        'product_id', v_product.id,
        'id', v_product.id,
        'sku', v_product.sku,
        'name', v_product.name,
        'quantity', 1,
        'weight', v_product.weight,
        'metal', coalesce(v_product.metal, nullif(v_item->>'metal', '')),
        'price', v_price,
        'price_per_gram', CASE
          WHEN v_product.weight > 0 THEN round(v_price / v_product.weight)
          ELSE NULL
        END,
        'cost', v_cost
      )
    );
  END LOOP;

  v_bonus_used := coalesce(nullif(_sale->>'bonus_used', '')::numeric, 0);
  IF v_bonus_used < 0
     OR v_bonus_used > v_subtotal
     OR v_bonus_used > coalesce(v_profile.bonus_points, 0) THEN
    RAISE EXCEPTION 'Некорректная сумма бонусов' USING ERRCODE = '22023';
  END IF;
  v_total := greatest(0, v_subtotal - v_bonus_used);

  SELECT default_bonus_rate INTO v_shop_bonus_rate
    FROM public.shop_settings
   WHERE shop_id = v_shop_id;
  v_bonus_earned := round(
    greatest(0, v_total - v_cost_total)
    * (coalesce(v_profile.bonus_rate, v_shop_bonus_rate, 2) / 100)
  );

  IF v_payment_method = 'cash' THEN
    v_amount_cash := v_total;
  ELSIF v_payment_method IN ('card', 'transfer') THEN
    v_amount_electronic := v_total;
  ELSE
    v_amount_cash := round(coalesce(nullif(_sale->>'amount_cash', '')::numeric, 0));
    v_amount_electronic := round(coalesce(nullif(_sale->>'amount_electronic', '')::numeric, 0));
    IF v_amount_cash < 0
       OR v_amount_electronic < 0
       OR abs(v_amount_cash + v_amount_electronic - v_total) > 1 THEN
      RAISE EXCEPTION 'Сумма оплаты не совпадает с итогом чека' USING ERRCODE = '22023';
    END IF;
  END IF;

  v_sale_id := coalesce(nullif(_sale->>'id', '')::uuid, gen_random_uuid());
  v_created_at := coalesce(nullif(_sale->>'created_at', '')::timestamptz, now());
  v_customer_id := nullif(_sale->>'customer_id', '')::uuid;
  v_customer_name := nullif(btrim(_sale->>'customer_name'), '');
  v_customer_phone := nullif(btrim(_sale->>'customer_phone'), '');
  IF v_customer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.customers
     WHERE id = v_customer_id AND shop_id = v_shop_id
  ) THEN
    RAISE EXCEPTION 'Клиент не найден в этом магазине' USING ERRCODE = '22023';
  END IF;
  IF v_customer_id IS NULL AND v_customer_phone IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended('offline-customer:' || v_shop_id::text || ':' || v_customer_phone, 0)
    );
    SELECT id INTO v_customer_id
      FROM public.customers
     WHERE shop_id = v_shop_id AND phone = v_customer_phone
     ORDER BY created_at
     LIMIT 1
     FOR UPDATE;

    IF v_customer_id IS NULL AND v_customer_name IS NOT NULL THEN
      INSERT INTO public.customers (shop_id, name, phone, bonus_points)
      VALUES (v_shop_id, v_customer_name, v_customer_phone, 0)
      RETURNING id INTO v_customer_id;
    ELSIF v_customer_id IS NOT NULL AND v_customer_name IS NOT NULL THEN
      UPDATE public.customers
         SET name = v_customer_name
       WHERE id = v_customer_id;
    END IF;
  END IF;

  -- The product locks above make this conditional update a compare-and-set:
  -- exactly one concurrent device can move each item from in_stock to sold.
  UPDATE public.products
     SET status = 'sold'
   WHERE shop_id = v_shop_id
     AND id = ANY(v_product_ids)
     AND status = 'in_stock';

  INSERT INTO public.sales (
    id, shop_id, seller_id, seller_name, customer_id, customer_name,
    customer_phone, payment_method, amount_cash, amount_electronic,
    subtotal, discount, total, cost_total, profit, bonus_earned,
    bonus_used, items, created_at, client_op_id
  ) VALUES (
    v_sale_id, v_shop_id, v_user_id, v_profile.full_name, v_customer_id,
    v_customer_name,
    v_customer_phone,
    v_payment_method, v_amount_cash, v_amount_electronic,
    v_subtotal, 0, v_total, v_cost_total, v_total - v_cost_total, v_bonus_earned,
    v_bonus_used, v_validated_items, v_created_at, _client_op_id
  );

  IF v_customer_id IS NOT NULL THEN
    PERFORM public.increment_customer_stats(v_customer_id, v_total);
  END IF;

  IF v_bonus_earned > 0 THEN
    UPDATE public.profiles
       SET bonus_points = coalesce(bonus_points, 0) + v_bonus_earned
     WHERE id = v_user_id;
  END IF;

  IF v_total > 0 THEN
    v_cash_operation_id := coalesce(
      nullif(_sale->>'cash_operation_id', '')::uuid,
      gen_random_uuid()
    );
    INSERT INTO public.cash_operations (
      id, shop_id, created_by, author_name, type, amount, reason, source,
      amount_cash, amount_electronic, client_op_id
    ) VALUES (
      v_cash_operation_id, v_shop_id, v_user_id, v_profile.full_name, 'income',
      v_total, 'Продажа чека #' || left(v_sale_id::text, 8),
      CASE
        WHEN v_amount_cash > 0 AND v_amount_electronic > 0 THEN 'mixed'
        WHEN v_amount_electronic > 0 THEN 'electronic'
        ELSE 'cash'
      END,
      v_amount_cash, v_amount_electronic, _client_op_id || ':cash'
    )
    ON CONFLICT (client_op_id) WHERE client_op_id IS NOT NULL DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'accepted', true,
    'duplicate', false,
    'sale_id', v_sale_id
  );
END;
$$;


--
-- Name: compose_article(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.compose_article(p_prefix text, p_seq integer) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  select case
    when p_prefix is null or p_seq is null then null
    else upper(p_prefix) || lpad(p_seq::text, 5, '0')
  end
$$;


--
-- Name: create_cash_operation_atomic(text, text, numeric, text, numeric, numeric, text, boolean, boolean, uuid, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_cash_operation_atomic(_client_op_id text, _type text, _amount numeric, _source text DEFAULT 'cash'::text, _amount_cash numeric DEFAULT 0, _amount_electronic numeric DEFAULT 0, _reason text DEFAULT NULL::text, _allow_seller boolean DEFAULT false, _save_preset boolean DEFAULT false, _operation_id uuid DEFAULT NULL::uuid, _created_at timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $_$
DECLARE
  v_user uuid := auth.uid();
  v_shop uuid := public.current_shop_id();
  v_profile public.profiles%ROWTYPE;
  v_existing public.cash_operations%ROWTYPE;
  v_operation_id uuid;
  v_amount numeric(14,2);
  v_cash numeric(14,2);
  v_electronic numeric(14,2);
  v_source text;
  v_reason text := btrim(_reason);
  v_cash_balance numeric;
  v_electronic_balance numeric;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user;
  IF v_user IS NULL OR NOT FOUND OR v_profile.status::text <> 'approved' OR v_shop IS NULL THEN
    RAISE EXCEPTION 'Нет доступа к магазину' USING ERRCODE = '42501';
  END IF;
  IF v_profile.role::text NOT IN ('admin', 'super_admin')
     AND NOT (coalesce(_allow_seller, false) AND _type = 'outcome') THEN
    RAISE EXCEPTION 'Недостаточно прав для кассовой операции' USING ERRCODE = '42501';
  END IF;
  IF _client_op_id IS NULL OR _client_op_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'Некорректный идентификатор операции' USING ERRCODE = '22023';
  END IF;
  _client_op_id := lower(_client_op_id);
  IF _type IS NULL OR _type NOT IN ('income', 'outcome', 'collection') THEN
    RAISE EXCEPTION 'Неверный тип операции' USING ERRCODE = '22023';
  END IF;
  IF _amount IS NULL OR _amount::text IN ('NaN', 'Infinity', '-Infinity') OR _amount <= 0 THEN
    RAISE EXCEPTION 'Укажите сумму больше нуля' USING ERRCODE = '22023';
  END IF;
  v_amount := round(_amount, 2);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'Сумма после округления должна быть больше нуля' USING ERRCODE = '22023';
  END IF;
  IF v_reason IS NULL OR length(v_reason) = 0 OR length(v_reason) > 300 THEN
    RAISE EXCEPTION 'Укажите причину операции (до 300 символов)' USING ERRCODE = '22023';
  END IF;
  v_source := CASE WHEN _type = 'collection' THEN 'cash' ELSE coalesce(_source, 'cash') END;
  IF v_source NOT IN ('cash', 'electronic', 'mixed') THEN
    RAISE EXCEPTION 'Неверный источник средств' USING ERRCODE = '22023';
  END IF;
  IF v_source = 'mixed' THEN
    IF coalesce(_amount_cash, 0)::text IN ('NaN', 'Infinity', '-Infinity')
       OR coalesce(_amount_electronic, 0)::text IN ('NaN', 'Infinity', '-Infinity') THEN
      RAISE EXCEPTION 'Некорректная разбивка суммы' USING ERRCODE = '22023';
    END IF;
    v_cash := round(coalesce(_amount_cash, 0), 2);
    v_electronic := round(coalesce(_amount_electronic, 0), 2);
    IF v_cash < 0 OR v_electronic < 0 OR v_cash + v_electronic <> v_amount THEN
      RAISE EXCEPTION 'Сумма наличных и электронных должна совпадать с общей суммой' USING ERRCODE = '22023';
    END IF;
  ELSE
    v_cash := CASE WHEN v_source = 'cash' THEN v_amount ELSE 0 END;
    v_electronic := CASE WHEN v_source = 'electronic' THEN v_amount ELSE 0 END;
  END IF;

  -- The lock is acquired BEFORE both idempotency lookup and balance reads.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_shop::text || ':cash-ledger', 0));
  SELECT * INTO v_existing FROM public.cash_operations WHERE client_op_id = _client_op_id;
  IF FOUND THEN
    IF v_existing.shop_id <> v_shop OR v_existing.created_by <> v_user THEN
      RAISE EXCEPTION 'Этот идентификатор операции уже используется' USING ERRCODE = '42501';
    END IF;
    IF v_existing.type::text IS DISTINCT FROM _type
       OR v_existing.amount IS DISTINCT FROM v_amount
       OR v_existing.source IS DISTINCT FROM v_source
       OR v_existing.amount_cash IS DISTINCT FROM v_cash
       OR v_existing.amount_electronic IS DISTINCT FROM v_electronic
       OR v_existing.reason IS DISTINCT FROM v_reason
       OR (_operation_id IS NOT NULL AND v_existing.id <> _operation_id) THEN
      RAISE EXCEPTION 'Нельзя повторно использовать идентификатор с другими данными' USING ERRCODE = '22023';
    END IF;
    -- Do not revive deleted operations or create another reason preset.
    RETURN jsonb_build_object('accepted', true, 'duplicate', true, 'operation_id', v_existing.id);
  END IF;

  SELECT cash, electronic INTO v_cash_balance, v_electronic_balance
    FROM public.cash_ledger_balances(v_shop);
  IF _type <> 'income' THEN
    IF v_cash > v_cash_balance THEN
      RAISE EXCEPTION 'Недостаточно наличных: доступно % с', v_cash_balance USING ERRCODE = '23514';
    END IF;
    IF v_electronic > v_electronic_balance THEN
      RAISE EXCEPTION 'Недостаточно электронных средств: доступно % с', v_electronic_balance USING ERRCODE = '23514';
    END IF;
  END IF;

  INSERT INTO public.cash_operations (
    id, shop_id, created_by, author_name, type, amount, source,
    amount_cash, amount_electronic, reason, client_op_id, created_at
  ) VALUES (
    coalesce(_operation_id, gen_random_uuid()), v_shop, v_user, v_profile.full_name,
    _type::public.cash_op_type, v_amount, v_source,
    v_cash, v_electronic, v_reason, _client_op_id, coalesce(_created_at, now())
  ) RETURNING id INTO v_operation_id;

  IF coalesce(_save_preset, false) THEN
    INSERT INTO public.cash_reason_presets (shop_id, created_by, text)
    VALUES (v_shop, v_user, v_reason);
  END IF;
  RETURN jsonb_build_object('accepted', true, 'duplicate', false, 'operation_id', v_operation_id);
END;
$_$;


--
-- Name: current_shop_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_shop_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT COALESCE(
    (SELECT impersonated_shop_id FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin'),
    (SELECT shop_id FROM public.profiles WHERE id = auth.uid())
  )
$$;


--
-- Name: delete_product(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_product(_product_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
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


--
-- Name: guard_profile_privileges(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_profile_privileges() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if public.is_shop_admin() then
    return new;
  end if;
  if old.status = 'pending' and not exists (
    select 1 from public.profiles
    where shop_id = old.shop_id and status = 'approved' and id <> old.id
  ) then
    return new;
  end if;
  new.role         := old.role;
  new.status       := old.status;
  new.shop_id      := old.shop_id;
  new.bonus_points := old.bonus_points;
  return new;
end $$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
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


--
-- Name: increment_customer_stats(uuid, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_customer_stats(_customer_id uuid, _amount numeric) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  UPDATE public.customers
  SET
    purchase_count   = purchase_count + 1,
    total_spent      = total_spent + _amount,
    last_purchase_at = now()
  WHERE id = _customer_id;
$$;


--
-- Name: is_approved(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_approved() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'approved')
$$;


--
-- Name: is_shop_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_shop_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and status = 'approved'
                   and role in ('admin','super_admin'))
$$;


--
-- Name: is_super_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_super_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'super_admin'
      AND status = 'approved'
  )
$$;


--
-- Name: next_article(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.next_article(p_prefix text) RETURNS TABLE(out_article text, out_prefix text, out_seq integer, out_reused boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
DECLARE
  v_shop    uuid    := public.current_shop_id();
  v_prefix text    := upper(btrim(coalesce(p_prefix, '')));
  v_seq    integer;
  v_reused boolean := false;
BEGIN
  IF NOT public.is_approved() THEN
    RAISE EXCEPTION 'Аккаунт не подтверждён' USING errcode = '42501';
  END IF;
  IF v_shop IS NULL THEN
    RAISE EXCEPTION 'У профиля не задан магазин' USING errcode = '42501';
  END IF;

  IF v_prefix !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'Некорректный префикс артикула: %. Используйте 2 латинские буквы (A-Z).', p_prefix
      USING errcode = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_shop::text || v_prefix, 0));

  SELECT s INTO v_seq
  FROM generate_series(1, 99999) AS s
  WHERE NOT EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.shop_id        = v_shop
      AND p.article_prefix = v_prefix
      AND p.article_seq    = s
  )
  ORDER BY s
  LIMIT 1;

  IF v_seq IS NULL THEN
    SELECT p.article_seq INTO v_seq
    FROM public.products p
    WHERE p.shop_id        = v_shop
      AND p.article_prefix = v_prefix
      AND p.status IN ('sold', 'archived')
    ORDER BY p.created_at ASC
    LIMIT 1;

    IF v_seq IS NOT NULL THEN
      v_reused := true;
      UPDATE public.products p
         SET article_prefix = null,
             article_seq    = null,
             status         = 'archived'
       WHERE p.shop_id        = v_shop
         AND p.article_prefix = v_prefix
         AND p.article_seq    = v_seq;
    END IF;
  END IF;

  IF v_seq IS NULL THEN
    RAISE EXCEPTION
      'Свободные артикулы для префикса % закончились (00001–99999).', v_prefix
      USING errcode = 'P0001';
  END IF;

  RETURN QUERY
    SELECT public.compose_article(v_prefix, v_seq), v_prefix, v_seq, v_reused;
END $_$;


--
-- Name: notify_pending_profile(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_pending_profile() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  -- Срабатывает только при переходе В статус pending
  IF NEW.status = 'pending' AND (TG_OP = 'INSERT' OR OLD.status <> 'pending') THEN
    -- Используем INSERT ... ON CONFLICT DO NOTHING (идемпотентность через уник. индекс)
    INSERT INTO public.superadmin_notifications
      (kind, profile_id, shop_id, full_name, shop_name, requested_role)
    VALUES (
      'pending_request',
      NEW.id,
      NEW.shop_id,
      NEW.full_name,
      NEW.shop_name,
      NEW.requested_role
    )
    ON CONFLICT (profile_id) WHERE is_processed = false DO NOTHING;
  END IF;

  -- При подтверждении или отклонении — помечаем уведомление как обработанное
  IF TG_OP = 'UPDATE' AND OLD.status = 'pending'
     AND NEW.status IN ('approved', 'rejected') THEN
    UPDATE public.superadmin_notifications
    SET is_processed = true,
        is_read      = true
    WHERE profile_id  = NEW.id
      AND is_processed = false;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: pay_supplier_debt(text, text, numeric, text, numeric, numeric, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pay_supplier_debt(_supplier_name text, _supplier_phone text, _amount numeric, _source text, _amount_cash numeric, _amount_electronic numeric, _reason text, _device_info text DEFAULT NULL::text) RETURNS public.supplier_debt_operations
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_shop uuid := public.current_shop_id();
  v_supplier_name text := btrim(_supplier_name);
  v_supplier_phone text := nullif(btrim(_supplier_phone), '');
  v_before numeric(14,2);
  v_amount numeric(14,2) := round(_amount, 2);
  v_cash numeric(14,2) := round(coalesce(_amount_cash, 0), 2);
  v_electronic numeric(14,2) := round(coalesce(_amount_electronic, 0), 2);
  v_cash_id uuid;
  v_operation public.supplier_debt_operations;
  v_profile public.profiles%ROWTYPE;
  v_cash_balance numeric;
  v_electronic_balance numeric;
BEGIN
  IF NOT public.is_shop_admin() OR v_shop IS NULL THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE id = auth.uid();
  IF nullif(v_supplier_name, '') IS NULL THEN RAISE EXCEPTION 'Укажите поставщика'; END IF;
  IF v_amount IS NULL OR v_amount::text = 'NaN' OR v_amount <= 0 THEN
    RAISE EXCEPTION 'Сумма должна быть больше нуля';
  END IF;
  IF _source IS NULL OR _source NOT IN ('cash', 'electronic', 'mixed') THEN
    RAISE EXCEPTION 'Неверный источник выплаты';
  END IF;
  IF _source = 'cash' THEN v_cash := v_amount; v_electronic := 0; END IF;
  IF _source = 'electronic' THEN v_cash := 0; v_electronic := v_amount; END IF;
  IF v_cash < 0 OR v_electronic < 0 OR v_cash::text = 'NaN' OR v_electronic::text = 'NaN'
     OR abs(v_cash + v_electronic - v_amount) > 0.01 THEN
    RAISE EXCEPTION 'Разбивка выплаты не совпадает с суммой';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_shop::text || ':cash-ledger', 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(
    v_shop::text || ':supplier:' || lower(v_supplier_name) || ':' ||
    coalesce(v_supplier_phone, ''), 0
  ));

  SELECT coalesce(sum(
    CASE WHEN operation_type IN ('consignment', 'adjustment') THEN amount ELSE -amount END
  ), 0)
    INTO v_before
    FROM public.supplier_debt_operations
   WHERE shop_id = v_shop
     AND lower(btrim(supplier_name)) = lower(v_supplier_name)
     AND nullif(btrim(supplier_phone), '') IS NOT DISTINCT FROM v_supplier_phone;

  IF v_amount > v_before + 0.01 THEN
    RAISE EXCEPTION 'Выплата больше остатка долга: доступно %', v_before;
  END IF;

  SELECT cash, electronic INTO v_cash_balance, v_electronic_balance
    FROM public.cash_ledger_balances(v_shop);
  IF v_cash > v_cash_balance THEN
    RAISE EXCEPTION 'Недостаточно наличных: доступно %', v_cash_balance;
  END IF;
  IF v_electronic > v_electronic_balance THEN
    RAISE EXCEPTION 'Недостаточно электронных средств: доступно %', v_electronic_balance;
  END IF;

  INSERT INTO public.cash_operations (
    shop_id, created_by, author_name, type, amount, reason, source,
    amount_cash, amount_electronic, supplier_name, supplier_phone
  ) VALUES (
    v_shop, auth.uid(), v_profile.full_name, 'outcome', v_amount,
    coalesce(nullif(btrim(_reason), ''), 'Выплата поставщику'), _source,
    v_cash, v_electronic, v_supplier_name, v_supplier_phone
  ) RETURNING id INTO v_cash_id;

  INSERT INTO public.supplier_debt_operations (
    shop_id, supplier_name, supplier_phone, operation_type, amount,
    balance_before, balance_after, cash_operation_id, source, amount_cash,
    amount_electronic, reason, created_by, author_name, device_info
  ) VALUES (
    v_shop, v_supplier_name, v_supplier_phone, 'payment', v_amount,
    v_before, v_before - v_amount, v_cash_id, _source, v_cash, v_electronic,
    coalesce(nullif(btrim(_reason), ''), 'Выплата поставщику'),
    auth.uid(), v_profile.full_name, left(_device_info, 500)
  ) RETURNING * INTO v_operation;

  UPDATE public.cash_operations
     SET supplier_debt_operation_id = v_operation.id
   WHERE id = v_cash_id;

  RETURN v_operation;
END;
$$;


--
-- Name: public_product(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.public_product(_shop_id uuid, _article text) RETURNS TABLE(id uuid, shop_id uuid, shop_seq_id integer, shop_name text, name text, category text, metal text, metal_color text, weight numeric, size text, sku text, stones text, description text, sale_price numeric, status text, images text[], image_url text, created_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
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


--
-- Name: public_product_by_seq(integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.public_product_by_seq(_shop_seq_id integer, _article text) RETURNS TABLE(id uuid, shop_id uuid, shop_seq_id integer, shop_name text, name text, category text, metal text, metal_color text, weight numeric, size text, sku text, stones text, description text, sale_price numeric, status text, images text[], image_url text, created_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: public_shop_is_enabled(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.public_shop_is_enabled(_shop_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
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


-- Name: public_shop_products(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.public_shop_products(_shop_id uuid, _limit integer DEFAULT 24) RETURNS TABLE(id uuid, shop_id uuid, shop_seq_id integer, shop_name text, name text, category text, metal text, metal_color text, weight numeric, size text, sku text, stones text, description text, sale_price numeric, status text, images text[], image_url text, created_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
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


--
-- Name: release_article(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.release_article(p_prefix text, p_seq integer) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_shop uuid := public.current_shop_id();
  v_cnt  integer;
begin
  if not public.is_approved() or v_shop is null then
    raise exception 'Нет доступа' using errcode = '42501';
  end if;
  update public.products p
     set status = 'archived',
         article_prefix = null,
         article_seq = null
   where p.shop_id = v_shop
     and p.article_prefix = upper(btrim(p_prefix))
     and p.article_seq = p_seq
     and p.status in ('sold', 'archived');
  get diagnostics v_cnt = row_count;
  return v_cnt;
end $$;


--
-- Name: reset_bonus_points(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reset_bonus_points(_user_id uuid) RETURNS numeric
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not public.is_shop_admin() then
    raise exception 'Обнулять бонусы может только администратор' using errcode = '42501';
  end if;
  update public.profiles set bonus_points = 0
   where id = _user_id and shop_id = public.current_shop_id();
  return 0;
end $$;


--
-- Name: sale_returns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sale_returns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_id uuid NOT NULL,
    sale_id uuid NOT NULL,
    product_id uuid,
    item_index integer NOT NULL,
    item_name text NOT NULL,
    item_metal text,
    item_weight numeric(8,2) DEFAULT 0 NOT NULL,
    amount numeric(14,2) DEFAULT 0 NOT NULL,
    cost numeric(14,2) DEFAULT 0 NOT NULL,
    cash_operation_id uuid,
    reason text DEFAULT ''::text NOT NULL,
    created_by uuid,
    author_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    client_op_id text,
    deleted_at timestamp with time zone,
    CONSTRAINT sale_returns_amount_check CHECK ((amount >= (0)::numeric)),
    CONSTRAINT sale_returns_item_index_check CHECK ((item_index >= 0))
);


--
-- Name: return_sale_item(uuid, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.return_sale_item(_sale_id uuid, _item_index integer, _reason text DEFAULT NULL::text) RETURNS public.sale_returns
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_shop        uuid := public.current_shop_id();
  v_user        uuid := auth.uid();
  v_sale        public.sales;
  v_item        jsonb;
  v_kind        text;
  v_price       numeric(14,2);
  v_cost        numeric(14,2);
  v_amount      numeric(14,2);
  v_ratio       numeric;
  v_cash        numeric(14,2) := 0;
  v_electronic  numeric(14,2) := 0;
  v_source      text := 'cash';
  v_op_id       uuid;
  v_reason      text;
  v_label       text;
  v_product_id  uuid;
  v_return      public.sale_returns;
BEGIN
  IF v_user IS NULL OR NOT public.is_approved() THEN
    RAISE EXCEPTION 'Аккаунт не подтверждён' USING errcode = '42501';
  END IF;
  IF v_shop IS NULL THEN
    RAISE EXCEPTION 'Профиль не привязан к магазину' USING errcode = '42501';
  END IF;
  IF _item_index IS NULL OR _item_index < 0 THEN
    RAISE EXCEPTION 'Некорректный номер позиции' USING errcode = '22023';
  END IF;

  -- Блокируем чек: параллельный возврат той же позиции невозможен.
  SELECT * INTO v_sale
    FROM public.sales
   WHERE id = _sale_id AND shop_id = v_shop
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Продажа не найдена' USING errcode = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.sale_returns
     WHERE sale_id = _sale_id AND item_index = _item_index
  ) THEN
    RAISE EXCEPTION 'Эта позиция уже возвращена' USING errcode = 'P0001';
  END IF;

  v_item := v_sale.items -> _item_index;
  IF v_item IS NULL OR jsonb_typeof(v_item) <> 'object' THEN
    RAISE EXCEPTION 'Позиция не найдена в чеке' USING errcode = 'P0002';
  END IF;

  v_kind  := coalesce(nullif(v_item ->> 'kind', ''), 'product');
  v_price := round(coalesce((v_item ->> 'price')::numeric, 0), 2);
  v_cost  := round(coalesce((v_item ->> 'cost')::numeric, 0), 2);

  -- Фактически оплаченная доля позиции (учитывает скидки чека и списанные бонусы).
  v_ratio := CASE
    WHEN coalesce(v_sale.subtotal, 0) > 0
      THEN least(1, greatest(0, v_sale.total / v_sale.subtotal))
    ELSE 1
  END;
  v_amount := round(v_price * v_ratio, 2);

  IF v_amount < 0 THEN
    RAISE EXCEPTION 'Некорректная сумма возврата' USING errcode = '22023';
  END IF;

  v_product_id := nullif(v_item ->> 'product_id', '')::uuid;

  -- Блокируем товар, чтобы параллельно его нельзя было продать повторно.
  -- Если товар удалён со склада — деньги всё равно возвращаем, склад не трогаем.
  IF v_kind = 'product' AND v_product_id IS NOT NULL THEN
    PERFORM 1 FROM public.products
      WHERE id = v_product_id AND shop_id = v_shop
      FOR UPDATE;
    IF NOT FOUND THEN
      v_product_id := NULL;
    END IF;
  END IF;

  v_label := coalesce(nullif(v_item ->> 'name', ''), 'Товар');
  v_reason := nullif(btrim(coalesce(_reason, '')), '');
  IF v_reason IS NULL THEN
    v_reason := 'Возврат товара: ' || v_label;
  ELSE
    v_reason := left('Возврат товара: ' || v_label || ' · ' || v_reason, 300);
  END IF;

  -- Источник возврата повторяет источник оплаты чека.
  IF v_sale.payment_method = 'mixed' THEN
    IF coalesce(v_sale.total, 0) > 0 THEN
      v_cash := round(coalesce(v_sale.amount_cash, 0) * (v_amount / v_sale.total), 2);
      v_cash := least(v_cash, v_amount);
    END IF;
    v_electronic := v_amount - v_cash;
    IF v_cash > 0 THEN
      v_cash := least(v_cash, round(coalesce(v_sale.amount_cash, 0), 2));
      v_electronic := v_amount - v_cash;
    END IF;
  ELSIF v_sale.payment_method IN ('card', 'transfer') THEN
    v_electronic := v_amount;
  ELSE
    v_cash := v_amount;
  END IF;

  v_source := CASE
    WHEN v_cash > 0 AND v_electronic > 0 THEN 'mixed'
    WHEN v_electronic > 0 THEN 'electronic'
    ELSE 'cash'
  END;

  -- 1) Денежное изъятие из кассы.
  INSERT INTO public.cash_operations (
    shop_id, created_by, author_name, type, amount, source,
    amount_cash, amount_electronic, reason
  )
  SELECT v_shop, p.id, p.full_name, 'outcome', v_amount, v_source,
         v_cash, v_electronic, v_reason
    FROM public.profiles p
   WHERE p.id = v_user
  RETURNING id INTO v_op_id;

  -- 2) Запись возврата.
  INSERT INTO public.sale_returns (
    shop_id, sale_id, product_id, item_index, item_name, item_metal,
    item_weight, amount, cost, cash_operation_id, reason, created_by, author_name
  )
  SELECT v_shop, v_sale.id, v_product_id, _item_index, v_label,
         nullif(v_item ->> 'metal', ''),
         round(coalesce((v_item ->> 'weight')::numeric, 0), 2),
         v_amount, v_cost, v_op_id, v_reason, p.id, p.full_name
    FROM public.profiles p
   WHERE p.id = v_user
  RETURNING * INTO v_return;

  -- 3) Себестоимость возвращённого товара снова учитывается на складе.
  IF v_kind = 'product' AND v_product_id IS NOT NULL THEN
    UPDATE public.products
       SET status = 'in_stock'
     WHERE id = v_product_id AND shop_id = v_shop;
  END IF;

  -- 4) Корректируем статистику клиента.
  IF v_sale.customer_id IS NOT NULL THEN
    UPDATE public.customers
       SET total_spent    = greatest(0, coalesce(total_spent, 0) - v_amount),
           purchase_count = greatest(0, coalesce(purchase_count, 0) - 1)
     WHERE id = v_sale.customer_id AND shop_id = v_shop;
  END IF;

  RETURN v_return;
END;
$$;


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_id uuid NOT NULL,
    created_by uuid NOT NULL,
    name text NOT NULL,
    category text,
    metal text,
    weight numeric(8,2) DEFAULT 0 NOT NULL,
    size text,
    sku text,
    purchase_price numeric(12,2) DEFAULT 0 NOT NULL,
    sale_price numeric(12,2) DEFAULT 0 NOT NULL,
    image_url text,
    status public.product_status DEFAULT 'in_stock'::public.product_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    metal_color text,
    purchase_price_visible numeric(12,2),
    price_per_gram_sale numeric(10,2),
    price_per_gram_purchase numeric(10,2),
    stones text,
    description text,
    images text[] DEFAULT '{}'::text[] NOT NULL,
    supplier_name public.citext,
    supplier_phone text,
    article_prefix text,
    article_seq integer,
    price_per_gram_purchase_visible numeric(10,2),
    is_hidden boolean DEFAULT false,
    consignment_operation_id uuid,
    consignment_at timestamp with time zone,
    consignment_by uuid,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    client_op_id text,
    CONSTRAINT products_article_seq_range CHECK (((article_seq IS NULL) OR ((article_seq >= 1) AND (article_seq <= 99999))))
);


--
-- Name: product_unit_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_unit_usage (
    product_id uuid NOT NULL,
    shop_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);


--
-- Name: sell_product(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sell_product(_product_id uuid) RETURNS public.products
    LANGUAGE plpgsql
    SET search_path TO 'public'
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


--
-- Name: set_bonus_points(uuid, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_bonus_points(_user_id uuid, _points numeric) RETURNS numeric
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_total numeric;
begin
  if not public.is_shop_admin() then
    raise exception 'Управлять бонусами может только администратор' using errcode = '42501';
  end if;
  if _points is null or _points < 0 then
    raise exception 'Некорректное количество баллов' using errcode = '22023';
  end if;
  update public.profiles
     set bonus_points = _points
   where id = _user_id
     and shop_id = public.current_shop_id()
  returning bonus_points into v_total;
  if v_total is null then
    raise exception 'Сотрудник не найден' using errcode = 'P0002';
  end if;
  return v_total;
end $$;


--
-- Name: set_bonus_rate(uuid, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_bonus_rate(_user_id uuid, _rate numeric) RETURNS numeric
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_rate numeric;
begin
  if not public.is_shop_admin() then
    raise exception 'Менять ставку бонусов может только администратор' using errcode = '42501';
  end if;
  if _rate is null or _rate < 0 or _rate > 100 then
    raise exception 'Ставка должна быть от 0 до 100' using errcode = '22023';
  end if;
  update public.profiles
     set bonus_rate = _rate
   where id = _user_id
     and shop_id = public.current_shop_id()
  returning bonus_rate into v_rate;
  if v_rate is null then
    raise exception 'Сотрудник не найден' using errcode = 'P0002';
  end if;
  return v_rate;
end $$;


--
-- Name: superadmin_approve_request(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.superadmin_approve_request(_profile_id uuid, _role text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  -- Проверка прав
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden: requires super_admin role'
      USING errcode = '42501';
  END IF;

  -- Валидация роли
  IF _role NOT IN ('admin', 'seller') THEN
    RAISE EXCEPTION 'Недопустимая роль: %. Допустимы: admin, seller', _role
      USING errcode = '22023';
  END IF;

  -- Проверить, что заявка существует и находится в состоянии pending
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = _profile_id AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'Заявка не найдена или уже обработана (id: %)', _profile_id
      USING errcode = 'P0002';
  END IF;

  -- Одобрить заявку — БЕЗ ограничения по shop_id
  UPDATE public.profiles
  SET
    status     = 'approved',
    role       = _role::public.app_role,
    manager_id = NULL   -- супер-админ не привязывает продавца к конкретному менеджеру
  WHERE id = _profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Профиль не найден: %', _profile_id
      USING errcode = 'P0002';
  END IF;
END;
$$;


--
-- Name: superadmin_get_notifications(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.superadmin_get_notifications(_limit integer DEFAULT 50, _offset integer DEFAULT 0) RETURNS TABLE(id uuid, kind text, profile_id uuid, shop_id uuid, full_name text, shop_name text, requested_role text, is_read boolean, is_processed boolean, created_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    id, kind, profile_id, shop_id, full_name, shop_name,
    requested_role, is_read, is_processed, created_at
  FROM public.superadmin_notifications
  WHERE public.is_super_admin()
  ORDER BY created_at DESC
  LIMIT  _limit
  OFFSET _offset;
$$;


--
-- Name: superadmin_get_unread_count(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.superadmin_get_unread_count() RETURNS bigint
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT COUNT(*)
  FROM public.superadmin_notifications
  WHERE public.is_super_admin()
    AND is_read = false;
$$;


--
-- Name: superadmin_impersonate(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.superadmin_impersonate(_target_shop_id uuid DEFAULT NULL::uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden: requires super_admin role';
  END IF;

  UPDATE public.profiles
  SET impersonated_shop_id = _target_shop_id
  WHERE id = auth.uid();
END;
$$;


--
-- Name: superadmin_list_shops(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.superadmin_list_shops() RETURNS TABLE(shop_id uuid, shop_name text, paid_until date, subscription_status text, auto_block boolean, is_frozen boolean, frozen_at timestamp with time zone, member_count integer, created_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT
    ss.shop_id,
    ss.shop_name,
    ss.paid_until,
    ss.subscription_status,
    ss.auto_block,
    ss.is_frozen,
    ss.frozen_at,
    COALESCE(mc.cnt, 0)::integer AS member_count,
    ss.updated_at               AS created_at
  FROM public.shop_settings ss
  LEFT JOIN (
    SELECT shop_id, COUNT(*)::integer AS cnt
    FROM public.profiles
    WHERE status = 'approved'
    GROUP BY shop_id
  ) mc ON mc.shop_id = ss.shop_id
  WHERE public.is_super_admin()
  ORDER BY ss.shop_name;
$$;


--
-- Name: superadmin_list_product_units(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.superadmin_list_product_units() RETURNS TABLE(shop_id uuid, units_used bigint)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
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


--
-- Name: record_new_product_unit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_new_product_unit() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  INSERT INTO public.product_unit_usage (product_id, shop_id)
  VALUES (NEW.id, NEW.shop_id)
  ON CONFLICT (product_id) DO NOTHING;
  RETURN NEW;
END;
$$;


--
-- Name: superadmin_mark_all_notifications_read(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.superadmin_mark_all_notifications_read() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden: requires super_admin role'
      USING errcode = '42501';
  END IF;

  UPDATE public.superadmin_notifications
  SET is_read = true
  WHERE is_read = false;
END;
$$;


--
-- Name: superadmin_mark_notification_read(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.superadmin_mark_notification_read(_notification_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden: requires super_admin role'
      USING errcode = '42501';
  END IF;

  UPDATE public.superadmin_notifications
  SET is_read = true
  WHERE id = _notification_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Notification not found: %', _notification_id
      USING errcode = 'P0002';
  END IF;
END;
$$;


--
-- Name: superadmin_reject_request(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.superadmin_reject_request(_profile_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  -- Проверка прав
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden: requires super_admin role'
      USING errcode = '42501';
  END IF;

  -- Проверить, что заявка существует и находится в состоянии pending
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = _profile_id AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'Заявка не найдена или уже обработана (id: %)', _profile_id
      USING errcode = 'P0002';
  END IF;

  -- Отклонить — БЕЗ ограничения по shop_id
  UPDATE public.profiles
  SET
    status = 'rejected',
    role   = NULL
  WHERE id = _profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Профиль не найден: %', _profile_id
      USING errcode = 'P0002';
  END IF;
END;
$$;


--
-- Name: superadmin_set_shop_frozen(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.superadmin_set_shop_frozen(_shop_id uuid, _frozen boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  _paid_until date;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden: requires super_admin role';
  END IF;

  IF _frozen IS NULL THEN
    RAISE EXCEPTION 'Parameter _frozen is required';
  END IF;

  SELECT ss.paid_until INTO _paid_until
  FROM public.shop_settings ss
  WHERE ss.shop_id = _shop_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shop not found: %', _shop_id;
  END IF;

  UPDATE public.shop_settings
  SET
    is_frozen           = _frozen,
    frozen_at           = CASE WHEN _frozen THEN COALESCE(frozen_at, now()) ELSE NULL END,
    frozen_by           = CASE WHEN _frozen THEN auth.uid()                 ELSE NULL END,
    subscription_status = CASE
                            WHEN _frozen THEN 'frozen'
                            WHEN _paid_until IS NULL THEN 'trial'
                            WHEN _paid_until >= CURRENT_DATE THEN 'active'
                            ELSE 'past_due'
                          END,
    updated_at          = now()
  WHERE shop_id = _shop_id;
END;
$$;


--
-- Name: FUNCTION superadmin_set_shop_frozen(_shop_id uuid, _frozen boolean); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.superadmin_set_shop_frozen(_shop_id uuid, _frozen boolean) IS 'Суперадмин: заморозить (true) или разморозить (false) магазин с корректным восстановлением subscription_status.';


--
-- Name: superadmin_update_shop_billing(uuid, date, text, boolean, boolean, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.superadmin_update_shop_billing(_shop_id uuid, _paid_until date DEFAULT NULL::date, _subscription_status text DEFAULT NULL::text, _auto_block boolean DEFAULT NULL::boolean, _is_frozen boolean DEFAULT NULL::boolean, _notes text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden: requires super_admin role';
  END IF;

  UPDATE public.shop_settings
  SET
    paid_until          = COALESCE(_paid_until,          paid_until),
    subscription_status = COALESCE(_subscription_status, subscription_status),
    auto_block          = COALESCE(_auto_block,          auto_block),
    is_frozen           = COALESCE(_is_frozen,           is_frozen),
    frozen_at           = CASE
                            WHEN _is_frozen IS NOT NULL AND _is_frozen = true  AND NOT is_frozen
                            THEN now()
                            WHEN _is_frozen IS NOT NULL AND _is_frozen = false
                            THEN NULL
                            ELSE frozen_at
                          END,
    frozen_by           = CASE
                            WHEN _is_frozen IS NOT NULL AND _is_frozen = true  AND NOT is_frozen
                            THEN auth.uid()
                            WHEN _is_frozen IS NOT NULL AND _is_frozen = false
                            THEN NULL
                            ELSE frozen_by
                          END,
    notes               = COALESCE(_notes, notes),
    updated_at          = now()
  WHERE shop_id = _shop_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shop not found: %', _shop_id;
  END IF;
END;
$$;


--
-- Name: sync_product_article(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_product_article() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if new.article_prefix is not null and new.article_seq is not null then
    new.sku := public.compose_article(new.article_prefix, new.article_seq);
  end if;
  return new;
end $$;


--
-- Name: take_product_on_consignment(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.take_product_on_consignment(_product_id uuid, _device_info text DEFAULT NULL::text) RETURNS public.supplier_debt_operations
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_shop uuid := public.current_shop_id();
  v_product public.products;
  v_before numeric(14,2);
  v_amount numeric(14,2);
  v_supplier_name text;
  v_supplier_phone text;
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
  v_supplier_phone := nullif(btrim(v_product.supplier_phone), '');

  IF v_product.consignment_operation_id IS NOT NULL THEN
    RAISE EXCEPTION 'Товар уже взят на реализацию';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    v_shop::text || ':supplier:' || lower(btrim(v_supplier_name)) || ':' ||
    coalesce(v_supplier_phone, ''), 0
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
     AND lower(btrim(supplier_name)) = lower(btrim(v_supplier_name))
     AND nullif(btrim(supplier_phone), '') IS NOT DISTINCT FROM v_supplier_phone;

  INSERT INTO public.supplier_debt_operations (
    shop_id, supplier_name, supplier_phone, operation_type, amount,
    balance_before, balance_after, product_id, reason, created_by, author_name, device_info
  )
  SELECT v_shop, v_supplier_name, v_supplier_phone,
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


--
-- Name: touch_presence(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_presence() RETURNS timestamp with time zone
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_at timestamptz := now();
begin
  update public.profiles set last_seen_at = v_at where id = auth.uid();
  return v_at;
end $$;


--
-- Name: undo_action(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.undo_action(_action_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
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


--
-- Name: FUNCTION undo_action(_action_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.undo_action(_action_id uuid) IS 'Undo a product creation by hard-deleting the unused product and recording a durable sync tombstone; delegate all other undo types to v40.';


--
-- Name: undo_action_v40(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.undo_action_v40(_action_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
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


--
-- Name: FUNCTION undo_action_v40(_action_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.undo_action_v40(_action_id uuid) IS 'Undo one shop-local history event: card/rate edits (v39), product creation, sale, or cash operation (v40, soft delete).';


--
-- Name: undo_edit_action(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.undo_edit_action(_action_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
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
$_$;


--
-- Name: FUNCTION undo_edit_action(_action_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.undo_edit_action(_action_id uuid) IS 'Undo one active shop-local card/rate edit. Requires an approved profile and matching active shop; locks entity, shop retention stream, then event, rejects conflicting edits, and restores only whitelisted changed fields. Purchase-price card edits do not alter supplier_debt_operations or other supplier accounting ledgers.';


--
-- Name: update_cash_reason_presets_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_cash_reason_presets_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
   NEW.updated_at = NOW();
   RETURN NEW;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: undo_guard; Type: TABLE; Schema: action_history_private; Owner: -
--

CREATE TABLE action_history_private.undo_guard (
    transaction_id bigint NOT NULL,
    backend_pid integer NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL
);


--
-- Name: action_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.action_history (
    seq bigint NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_id uuid NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    prev_state jsonb NOT NULL,
    next_state jsonb NOT NULL,
    changed_fields text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    employee_id uuid,
    employee_name text DEFAULT 'Система'::text NOT NULL,
    description text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    undone_at timestamp with time zone,
    undone_by uuid,
    CONSTRAINT action_history_entity_type_check CHECK ((entity_type = ANY (ARRAY['product'::text, 'metal_rate'::text, 'product_create'::text, 'sale'::text, 'cash_operation'::text]))),
    CONSTRAINT action_history_status_check CHECK ((status = ANY (ARRAY['active'::text, 'undone'::text])))
);


--
-- Name: TABLE action_history; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.action_history IS 'Shop-scoped product-card and metal-rate edit history. Retains at most the newest 50 events per shop; snapshots are intentionally not granted to authenticated clients.';


--
-- Name: COLUMN action_history.seq; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.action_history.seq IS 'Global identity ordering key; retention is independently enforced per shop.';


--
-- Name: COLUMN action_history.prev_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.action_history.prev_state IS 'Full row snapshot before the update. Never expose through authenticated SELECT grants.';


--
-- Name: COLUMN action_history.next_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.action_history.next_state IS 'Full row snapshot after the update. Undo restores only changed_fields, preserving later status, consignment, and sales lifecycle changes.';


--
-- Name: COLUMN action_history.changed_fields; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.action_history.changed_fields IS 'Whitelist of changed business fields. Only these fields are conflict-checked and restored.';


--
-- Name: COLUMN action_history.description; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.action_history.description IS 'Safe display description containing field labels only, never values such as purchase prices.';


--
-- Name: COLUMN action_history.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.action_history.status IS 'Undoable events remain in history and become undone rather than being deleted.';


--
-- Name: action_history_seq_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.action_history ALTER COLUMN seq ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.action_history_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: cash_operations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_operations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_id uuid NOT NULL,
    created_by uuid NOT NULL,
    author_name text,
    type public.cash_op_type NOT NULL,
    amount numeric(14,2) DEFAULT 0 NOT NULL,
    reason text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    source text DEFAULT 'cash'::text NOT NULL,
    amount_cash numeric(14,2),
    amount_electronic numeric(14,2),
    supplier_name text,
    supplier_phone text,
    supplier_debt_operation_id uuid,
    updated_at timestamp with time zone DEFAULT now(),
    client_op_id text,
    deleted_at timestamp with time zone,
    CONSTRAINT cash_operations_source_check CHECK ((source = ANY (ARRAY['cash'::text, 'electronic'::text, 'mixed'::text]))),
    CONSTRAINT cash_operations_type_check CHECK ((type = ANY (ARRAY['income'::public.cash_op_type, 'outcome'::public.cash_op_type, 'collection'::public.cash_op_type])))
);


--
-- Name: cash_reason_presets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_reason_presets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_id uuid NOT NULL,
    created_by uuid NOT NULL,
    text text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_id uuid NOT NULL,
    name text,
    phone text,
    bonus_points integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    gender text,
    whatsapp text,
    instagram text,
    email text,
    is_blacklisted boolean DEFAULT false NOT NULL,
    purchase_count integer DEFAULT 0 NOT NULL,
    total_spent numeric(14,2) DEFAULT 0 NOT NULL,
    last_purchase_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    client_op_id text,
    CONSTRAINT customers_gender_check CHECK ((gender = ANY (ARRAY['female'::text, 'male'::text, 'other'::text])))
);


--
-- Name: label_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.label_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_id uuid,
    scope_key text NOT NULL,
    category text DEFAULT 'Прочее'::text NOT NULL,
    size_key text NOT NULL,
    template_json text NOT NULL,
    created_by uuid,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: metal_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.metal_rates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_id uuid NOT NULL,
    metal text NOT NULL,
    price_per_gram numeric(10,2) DEFAULT 0 NOT NULL,
    scrap_price_per_gram numeric(10,2) DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: product_deletion_tombstones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_deletion_tombstones (
    shop_id uuid NOT NULL,
    product_id uuid NOT NULL,
    deleted_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    full_name text,
    shop_name text,
    shop_id uuid,
    phone text,
    requested_role text,
    role public.app_role,
    status public.profile_status DEFAULT 'pending'::public.profile_status NOT NULL,
    bonus_points numeric(10,2) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    bonus_rate numeric(5,2),
    manager_id uuid,
    last_seen_at timestamp with time zone,
    email text,
    impersonated_shop_id uuid
);


--
-- Name: sales; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_id uuid NOT NULL,
    seller_id uuid NOT NULL,
    seller_name text,
    customer_id uuid,
    customer_name text,
    customer_phone text,
    payment_method text DEFAULT 'cash'::text NOT NULL,
    subtotal numeric(14,2) DEFAULT 0 NOT NULL,
    discount numeric(14,2) DEFAULT 0 NOT NULL,
    total numeric(14,2) DEFAULT 0 NOT NULL,
    cost_total numeric(14,2) DEFAULT 0 NOT NULL,
    profit numeric(14,2) DEFAULT 0 NOT NULL,
    bonus_earned numeric(14,2) DEFAULT 0 NOT NULL,
    bonus_used numeric(14,2) DEFAULT 0 NOT NULL,
    items jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    amount_cash numeric(14,2),
    amount_electronic numeric(14,2),
    updated_at timestamp with time zone DEFAULT now(),
    client_op_id text,
    deleted_at timestamp with time zone,
    idx integer
);


--
-- Name: shop_seq_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.shop_seq_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: shop_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shop_settings (
    shop_id uuid NOT NULL,
    shop_name text,
    default_bonus_rate numeric(5,2) DEFAULT 2 NOT NULL,
    public_enabled boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    paid_until date,
    subscription_status text DEFAULT 'trial'::text NOT NULL,
    auto_block boolean DEFAULT true NOT NULL,
    is_frozen boolean DEFAULT false NOT NULL,
    frozen_at timestamp with time zone,
    frozen_by uuid,
    notes text,
    seq_id integer,
    CONSTRAINT shop_settings_subscription_status_check CHECK ((subscription_status = ANY (ARRAY['trial'::text, 'active'::text, 'past_due'::text, 'frozen'::text, 'cancelled'::text])))
);


--
-- Name: superadmin_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.superadmin_notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text NOT NULL,
    profile_id uuid NOT NULL,
    shop_id uuid,
    full_name text,
    shop_name text,
    requested_role text,
    is_read boolean DEFAULT false NOT NULL,
    is_processed boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT superadmin_notifications_kind_check CHECK ((kind = 'pending_request'::text))
);


--
-- Name: undo_guard undo_guard_pkey; Type: CONSTRAINT; Schema: action_history_private; Owner: -
--

ALTER TABLE ONLY action_history_private.undo_guard
    ADD CONSTRAINT undo_guard_pkey PRIMARY KEY (transaction_id, backend_pid, entity_type, entity_id);


--
-- Name: action_history action_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_history
    ADD CONSTRAINT action_history_pkey PRIMARY KEY (id);


--
-- Name: action_history action_history_seq_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_history
    ADD CONSTRAINT action_history_seq_key UNIQUE (seq);


--
-- Name: cash_operations cash_operations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_operations
    ADD CONSTRAINT cash_operations_pkey PRIMARY KEY (id);


--
-- Name: cash_reason_presets cash_reason_presets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_reason_presets
    ADD CONSTRAINT cash_reason_presets_pkey PRIMARY KEY (id);


--
-- Name: cash_reason_presets cash_reason_presets_shop_id_text_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_reason_presets
    ADD CONSTRAINT cash_reason_presets_shop_id_text_key UNIQUE (shop_id, text);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: customers customers_shop_id_phone_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_shop_id_phone_key UNIQUE (shop_id, phone);


--
-- Name: label_templates label_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.label_templates
    ADD CONSTRAINT label_templates_pkey PRIMARY KEY (id);


--
-- Name: metal_rates metal_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metal_rates
    ADD CONSTRAINT metal_rates_pkey PRIMARY KEY (id);


--
-- Name: metal_rates metal_rates_shop_id_metal_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metal_rates
    ADD CONSTRAINT metal_rates_shop_id_metal_key UNIQUE (shop_id, metal);


--
-- Name: product_deletion_tombstones product_deletion_tombstones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_deletion_tombstones
    ADD CONSTRAINT product_deletion_tombstones_pkey PRIMARY KEY (shop_id, product_id);


--
-- Name: product_unit_usage product_unit_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_unit_usage
    ADD CONSTRAINT product_unit_usage_pkey PRIMARY KEY (product_id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: sale_returns sale_returns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_returns
    ADD CONSTRAINT sale_returns_pkey PRIMARY KEY (id);


--
-- Name: sales sales_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales
    ADD CONSTRAINT sales_pkey PRIMARY KEY (id);


--
-- Name: shop_settings shop_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shop_settings
    ADD CONSTRAINT shop_settings_pkey PRIMARY KEY (shop_id);


--
-- Name: superadmin_notifications superadmin_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.superadmin_notifications
    ADD CONSTRAINT superadmin_notifications_pkey PRIMARY KEY (id);


--
-- Name: supplier_debt_operations supplier_debt_operations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_debt_operations
    ADD CONSTRAINT supplier_debt_operations_pkey PRIMARY KEY (id);


--
-- Name: action_history_shop_seq_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX action_history_shop_seq_idx ON public.action_history USING btree (shop_id, seq DESC);


--
-- Name: cash_operations_client_op_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX cash_operations_client_op_id_idx ON public.cash_operations USING btree (client_op_id) WHERE (client_op_id IS NOT NULL);


--
-- Name: cash_operations_shop_deleted_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cash_operations_shop_deleted_at_idx ON public.cash_operations USING btree (shop_id, deleted_at) WHERE (deleted_at IS NOT NULL);


--
-- Name: cash_operations_shop_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cash_operations_shop_updated_at_idx ON public.cash_operations USING btree (shop_id, updated_at);


--
-- Name: cash_ops_shop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cash_ops_shop_idx ON public.cash_operations USING btree (shop_id, created_at DESC);


--
-- Name: cash_presets_shop_text_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX cash_presets_shop_text_idx ON public.cash_reason_presets USING btree (shop_id, text);


--
-- Name: cash_reason_presets_shop_deleted_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cash_reason_presets_shop_deleted_at_idx ON public.cash_reason_presets USING btree (shop_id, deleted_at) WHERE (deleted_at IS NOT NULL);


--
-- Name: cash_reason_presets_shop_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cash_reason_presets_shop_updated_at_idx ON public.cash_reason_presets USING btree (shop_id, updated_at);


--
-- Name: customers_client_op_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX customers_client_op_id_idx ON public.customers USING btree (client_op_id) WHERE (client_op_id IS NOT NULL);


--
-- Name: customers_last_purchase_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customers_last_purchase_idx ON public.customers USING btree (shop_id, last_purchase_at DESC NULLS LAST);


--
-- Name: customers_shop_blacklist_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customers_shop_blacklist_idx ON public.customers USING btree (shop_id, is_blacklisted) WHERE (is_blacklisted = true);


--
-- Name: customers_shop_deleted_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customers_shop_deleted_at_idx ON public.customers USING btree (shop_id, deleted_at) WHERE (deleted_at IS NOT NULL);


--
-- Name: customers_shop_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX customers_shop_email_idx ON public.customers USING btree (shop_id, email) WHERE (email IS NOT NULL);


--
-- Name: customers_shop_phone_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX customers_shop_phone_idx ON public.customers USING btree (shop_id, phone) WHERE (phone IS NOT NULL);


--
-- Name: customers_shop_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customers_shop_updated_at_idx ON public.customers USING btree (shop_id, updated_at);


--
--
-- Name: label_templates_scope_category_size_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX label_templates_scope_category_size_idx ON public.label_templates USING btree (scope_key, category, size_key);


--
-- Name: label_templates_shop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX label_templates_shop_idx ON public.label_templates USING btree (shop_id, category, size_key);


--
-- Name: metal_rates_shop_deleted_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX metal_rates_shop_deleted_at_idx ON public.metal_rates USING btree (shop_id, deleted_at) WHERE (deleted_at IS NOT NULL);


--
-- Name: metal_rates_shop_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX metal_rates_shop_updated_at_idx ON public.metal_rates USING btree (shop_id, updated_at);


--
-- Name: product_deletion_tombstones_shop_deleted_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_deletion_tombstones_shop_deleted_idx ON public.product_deletion_tombstones USING btree (shop_id, deleted_at, product_id);


--
-- Name: products_client_op_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX products_client_op_id_idx ON public.products USING btree (client_op_id) WHERE (client_op_id IS NOT NULL);


--
-- Name: products_shop_article_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX products_shop_article_idx ON public.products USING btree (shop_id, article_prefix, article_seq) WHERE ((article_prefix IS NOT NULL) AND (article_seq IS NOT NULL));


--
-- Name: products_shop_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX products_shop_created_at_idx ON public.products USING btree (shop_id, created_at DESC);


--
-- Name: products_shop_deleted_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX products_shop_deleted_at_idx ON public.products USING btree (shop_id, deleted_at) WHERE (deleted_at IS NOT NULL);


--
-- Name: products_shop_sale_price_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX products_shop_sale_price_idx ON public.products USING btree (shop_id, sale_price);


--
-- Name: products_shop_sku_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX products_shop_sku_idx ON public.products USING btree (shop_id, sku);


--
-- Name: products_shop_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX products_shop_status_idx ON public.products USING btree (shop_id, status, created_at DESC);


--
-- Name: products_shop_supplier_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX products_shop_supplier_idx ON public.products USING btree (shop_id, supplier_name, supplier_phone);


--
-- Name: products_shop_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX products_shop_updated_at_idx ON public.products USING btree (shop_id, updated_at);


--
-- Name: products_shop_weight_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX products_shop_weight_idx ON public.products USING btree (shop_id, weight);


--
-- Name: product_unit_usage_shop_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_unit_usage_shop_id_idx ON public.product_unit_usage USING btree (shop_id);


--
-- Name: profiles_impersonated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX profiles_impersonated_idx ON public.profiles USING btree (impersonated_shop_id) WHERE (impersonated_shop_id IS NOT NULL);


--
-- Name: sale_returns_client_op_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sale_returns_client_op_id_idx ON public.sale_returns USING btree (client_op_id) WHERE (client_op_id IS NOT NULL);


--
-- Name: sale_returns_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sale_returns_product_idx ON public.sale_returns USING btree (product_id) WHERE (product_id IS NOT NULL);


--
-- Name: sale_returns_sale_item_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sale_returns_sale_item_idx ON public.sale_returns USING btree (sale_id, item_index);


--
-- Name: sale_returns_shop_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sale_returns_shop_created_idx ON public.sale_returns USING btree (shop_id, created_at DESC);


--
-- Name: sale_returns_shop_deleted_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sale_returns_shop_deleted_at_idx ON public.sale_returns USING btree (shop_id, deleted_at) WHERE (deleted_at IS NOT NULL);


--
-- Name: sale_returns_shop_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sale_returns_shop_updated_at_idx ON public.sale_returns USING btree (shop_id, updated_at);


--
-- Name: sales_client_op_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sales_client_op_id_idx ON public.sales USING btree (client_op_id) WHERE (client_op_id IS NOT NULL);


--
-- Name: sales_customer_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sales_customer_created_idx ON public.sales USING btree (customer_id, created_at DESC) WHERE (customer_id IS NOT NULL);


--

-- Shop-scoped customer receipt history, matching the CRM query filters.
CREATE INDEX sales_shop_customer_created_idx
  ON public.sales (shop_id, customer_id, created_at DESC)
  WHERE customer_id IS NOT NULL;
-- Name: sales_shop_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sales_shop_created_idx ON public.sales USING btree (shop_id, created_at DESC);


--
-- Name: sales_shop_deleted_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sales_shop_deleted_at_idx ON public.sales USING btree (shop_id, deleted_at) WHERE (deleted_at IS NOT NULL);


--
-- Name: sales_shop_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sales_shop_updated_at_idx ON public.sales USING btree (shop_id, updated_at);


--
-- Name: shop_settings_paid_until_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX shop_settings_paid_until_idx ON public.shop_settings USING btree (paid_until) WHERE (paid_until IS NOT NULL);


--
-- Name: shop_settings_seq_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX shop_settings_seq_id_idx ON public.shop_settings USING btree (seq_id) WHERE (seq_id IS NOT NULL);


--
-- Name: sn_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sn_created_idx ON public.superadmin_notifications USING btree (created_at DESC);


--
-- Name: sn_profile_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sn_profile_active_idx ON public.superadmin_notifications USING btree (profile_id) WHERE (is_processed = false);


--
-- Name: sn_unread_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sn_unread_idx ON public.superadmin_notifications USING btree (is_read, created_at DESC) WHERE (is_read = false);


--
-- Name: supplier_debt_operations_client_op_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX supplier_debt_operations_client_op_id_idx ON public.supplier_debt_operations USING btree (client_op_id) WHERE (client_op_id IS NOT NULL);


--
-- Name: supplier_debt_operations_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX supplier_debt_operations_product_idx ON public.supplier_debt_operations USING btree (product_id);


--
-- Name: supplier_debt_operations_shop_deleted_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX supplier_debt_operations_shop_deleted_at_idx ON public.supplier_debt_operations USING btree (shop_id, deleted_at) WHERE (deleted_at IS NOT NULL);


--
-- Name: supplier_debt_operations_shop_supplier_identity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX supplier_debt_operations_shop_supplier_identity_idx ON public.supplier_debt_operations USING btree (shop_id, lower(btrim((supplier_name)::text)), NULLIF(btrim(supplier_phone), ''::text), created_at DESC);


--
-- Name: supplier_debt_operations_shop_supplier_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX supplier_debt_operations_shop_supplier_idx ON public.supplier_debt_operations USING btree (shop_id, supplier_name, supplier_phone, created_at DESC);


--
-- Name: supplier_debt_operations_shop_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX supplier_debt_operations_shop_updated_at_idx ON public.supplier_debt_operations USING btree (shop_id, updated_at);


--
--
-- Name: cash_operations cash_operations_capture_action_history_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER cash_operations_capture_action_history_insert AFTER INSERT ON public.cash_operations FOR EACH ROW EXECUTE FUNCTION public.capture_action_history_insert('cash_operation');


--
-- Name: profiles guard_profile_privileges; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER guard_profile_privileges BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.guard_profile_privileges();


--
-- Name: metal_rates metal_rates_capture_action_history; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER metal_rates_capture_action_history AFTER UPDATE ON public.metal_rates FOR EACH ROW EXECUTE FUNCTION public.capture_action_history_update('metal_rate');


--
-- Name: products products_capture_action_history; Type: TRIGGER; Schema: public; Owner: -
--

-- Keep this predicate aligned with capture_action_history_update's product whitelist.
-- Evaluate typed OLD/NEW values before invoking the JSON snapshot trigger function.
-- supplier_name is citext; cast to text to preserve case-only edits like JSONB does.
CREATE TRIGGER products_capture_action_history AFTER UPDATE ON public.products
FOR EACH ROW
WHEN (
  ROW(
    OLD.name, OLD.category, OLD.metal, OLD.metal_color, OLD.weight, OLD.size,
    OLD.purchase_price, OLD.purchase_price_visible, OLD.price_per_gram_sale,
    OLD.price_per_gram_purchase, OLD.price_per_gram_purchase_visible,
    OLD.stones, OLD.description, OLD.sale_price, OLD.image_url, OLD.images,
    OLD.supplier_name::text, OLD.supplier_phone, OLD.is_hidden
  ) IS DISTINCT FROM ROW(
    NEW.name, NEW.category, NEW.metal, NEW.metal_color, NEW.weight, NEW.size,
    NEW.purchase_price, NEW.purchase_price_visible, NEW.price_per_gram_sale,
    NEW.price_per_gram_purchase, NEW.price_per_gram_purchase_visible,
    NEW.stones, NEW.description, NEW.sale_price, NEW.image_url, NEW.images,
    NEW.supplier_name::text, NEW.supplier_phone, NEW.is_hidden
  )
)
EXECUTE FUNCTION public.capture_action_history_update('product');


--
-- Name: products products_capture_action_history_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER products_capture_action_history_insert AFTER INSERT ON public.products FOR EACH ROW EXECUTE FUNCTION public.capture_action_history_insert('product_create');


--
-- Name: products products_record_new_unit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER products_record_new_unit AFTER INSERT ON public.products FOR EACH ROW EXECUTE FUNCTION public.record_new_product_unit();


--
-- Name: sales sales_capture_action_history_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sales_capture_action_history_insert AFTER INSERT ON public.sales FOR EACH ROW EXECUTE FUNCTION public.capture_action_history_insert('sale');


--
-- Name: cash_reason_presets set_cash_reason_presets_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_cash_reason_presets_updated_at BEFORE UPDATE ON public.cash_reason_presets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: customers set_customers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_customers_updated_at BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: products sync_product_article; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sync_product_article BEFORE INSERT OR UPDATE OF article_prefix, article_seq ON public.products FOR EACH ROW EXECUTE FUNCTION public.sync_product_article();


--
-- Name: shop_settings trg_assign_shop_seq_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_assign_shop_seq_id BEFORE INSERT ON public.shop_settings FOR EACH ROW EXECUTE FUNCTION public.assign_shop_seq_id();


--
-- Name: profiles trg_notify_pending_profile; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notify_pending_profile AFTER INSERT OR UPDATE OF status ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.notify_pending_profile();


--
-- Name: cash_operations update_cash_operations_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_cash_operations_updated_at BEFORE UPDATE ON public.cash_operations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: cash_reason_presets update_cash_reason_presets_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_cash_reason_presets_updated_at BEFORE UPDATE ON public.cash_reason_presets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: customers update_customers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: metal_rates update_metal_rates_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_metal_rates_updated_at BEFORE UPDATE ON public.metal_rates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: products update_products_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: sale_returns update_sale_returns_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_sale_returns_updated_at BEFORE UPDATE ON public.sale_returns FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: sales update_sales_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_sales_updated_at BEFORE UPDATE ON public.sales FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: supplier_debt_operations update_supplier_debt_operations_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_supplier_debt_operations_updated_at BEFORE UPDATE ON public.supplier_debt_operations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: cash_operations cash_operations_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_operations
    ADD CONSTRAINT cash_operations_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: cash_reason_presets cash_reason_presets_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_reason_presets
    ADD CONSTRAINT cash_reason_presets_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: products products_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_impersonated_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_impersonated_shop_id_fkey FOREIGN KEY (impersonated_shop_id) REFERENCES public.shop_settings(shop_id) ON DELETE SET NULL;


--
-- Name: profiles profiles_manager_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_manager_id_fkey FOREIGN KEY (manager_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: sale_returns sale_returns_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_returns
    ADD CONSTRAINT sale_returns_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: sales sales_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales
    ADD CONSTRAINT sales_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: shop_settings shop_settings_frozen_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shop_settings
    ADD CONSTRAINT shop_settings_frozen_by_fkey FOREIGN KEY (frozen_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: undo_guard; Type: ROW SECURITY; Schema: action_history_private; Owner: -
--

ALTER TABLE action_history_private.undo_guard ENABLE ROW LEVEL SECURITY;

--
-- Name: action_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.action_history ENABLE ROW LEVEL SECURITY;

--
-- Name: action_history action_history_shop_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY action_history_shop_read ON public.action_history FOR SELECT TO authenticated USING (((shop_id = public.current_shop_id()) AND public.is_approved()));


--
-- Name: cash_operations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cash_operations ENABLE ROW LEVEL SECURITY;

--
-- Name: cash_operations cash_operations: insert own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "cash_operations: insert own" ON public.cash_operations FOR INSERT TO authenticated WITH CHECK ((public.is_approved() AND (created_by = auth.uid()) AND (shop_id = public.current_shop_id())));


--
-- Name: cash_operations cash_operations: shop read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "cash_operations: shop read" ON public.cash_operations FOR SELECT TO authenticated USING ((public.is_approved() AND (shop_id = public.current_shop_id())));


--
-- Name: cash_operations cash_operations: shop update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "cash_operations: shop update" ON public.cash_operations FOR UPDATE TO authenticated USING ((public.is_approved() AND (shop_id = public.current_shop_id()))) WITH CHECK ((public.is_approved() AND (shop_id = public.current_shop_id())));


--
-- Name: cash_reason_presets cash_presets: shop access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "cash_presets: shop access" ON public.cash_reason_presets TO authenticated USING ((public.is_approved() AND (shop_id = public.current_shop_id()))) WITH CHECK ((public.is_approved() AND (shop_id = public.current_shop_id())));


--
-- Name: cash_reason_presets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cash_reason_presets ENABLE ROW LEVEL SECURITY;

--
-- Name: customers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

--
-- Name: customers customers: shop access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "customers: shop access" ON public.customers TO authenticated USING ((public.is_approved() AND (shop_id = public.current_shop_id()))) WITH CHECK ((public.is_approved() AND (shop_id = public.current_shop_id())));


--
-- Name: label_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.label_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: label_templates label_templates_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY label_templates_select ON public.label_templates FOR SELECT TO authenticated USING ((public.is_approved() AND ((shop_id IS NULL) OR (shop_id = public.current_shop_id()))));


--
-- Name: label_templates label_templates_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY label_templates_write ON public.label_templates TO authenticated USING ((public.is_approved() AND (((shop_id IS NULL) AND public.is_super_admin()) OR ((shop_id = public.current_shop_id()) AND public.is_shop_admin())))) WITH CHECK ((public.is_approved() AND (((shop_id IS NULL) AND public.is_super_admin()) OR ((shop_id = public.current_shop_id()) AND public.is_shop_admin()))));


--
-- Name: metal_rates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.metal_rates ENABLE ROW LEVEL SECURITY;

--
-- Name: metal_rates metal_rates: admin writes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "metal_rates: admin writes" ON public.metal_rates TO authenticated USING ((public.is_shop_admin() AND (shop_id = public.current_shop_id()))) WITH CHECK ((public.is_shop_admin() AND (shop_id = public.current_shop_id())));


--
-- Name: metal_rates metal_rates: shop read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "metal_rates: shop read" ON public.metal_rates FOR SELECT TO authenticated USING ((public.is_approved() AND (shop_id = public.current_shop_id())));


--
-- Name: product_deletion_tombstones product deletion tombstones: shop read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "product deletion tombstones: shop read" ON public.product_deletion_tombstones FOR SELECT TO authenticated USING ((public.is_approved() AND (shop_id = public.current_shop_id())));


--
-- Name: product_unit_usage product_unit_usage_read_own_shop; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY product_unit_usage_read_own_shop ON public.product_unit_usage FOR SELECT TO authenticated USING (((shop_id = public.current_shop_id()) AND public.is_approved()));


--
-- Name: product_deletion_tombstones; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_deletion_tombstones ENABLE ROW LEVEL SECURITY;


--
-- Name: product_unit_usage; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_unit_usage ENABLE ROW LEVEL SECURITY;


--
-- Name: products; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

--
-- Name: products products: admin delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "products: admin delete" ON public.products FOR DELETE TO authenticated USING ((public.is_shop_admin() AND (shop_id = public.current_shop_id())));


--
-- Name: products products: shop insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "products: shop insert" ON public.products FOR INSERT TO authenticated WITH CHECK ((public.is_approved() AND (shop_id = public.current_shop_id())));


--
-- Name: products products: shop read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "products: shop read" ON public.products FOR SELECT TO authenticated USING ((public.is_approved() AND (shop_id = public.current_shop_id())));


--
-- Name: products products: shop update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "products: shop update" ON public.products FOR UPDATE TO authenticated USING ((public.is_approved() AND (shop_id = public.current_shop_id()))) WITH CHECK ((shop_id = public.current_shop_id()));


--
-- Name: products products_consignment_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY products_consignment_update ON public.products FOR UPDATE TO authenticated USING (((shop_id = public.current_shop_id()) AND public.is_approved())) WITH CHECK (((shop_id = public.current_shop_id()) AND public.is_approved()));


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles: admin manages shop; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "profiles: admin manages shop" ON public.profiles FOR UPDATE TO authenticated USING ((public.is_shop_admin() AND (shop_id = public.current_shop_id()))) WITH CHECK ((public.is_shop_admin() AND (shop_id = public.current_shop_id())));


--
-- Name: profiles profiles: read own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "profiles: read own" ON public.profiles FOR SELECT TO authenticated USING ((id = auth.uid()));


--
-- Name: profiles profiles: read shop; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "profiles: read shop" ON public.profiles FOR SELECT TO authenticated USING (((shop_id IS NOT NULL) AND (shop_id = public.current_shop_id())));


--
-- Name: profiles profiles: super_admin manages all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "profiles: super_admin manages all" ON public.profiles FOR UPDATE TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: profiles profiles: super_admin reads all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "profiles: super_admin reads all" ON public.profiles FOR SELECT TO authenticated USING (public.is_super_admin());


--
-- Name: profiles profiles: update own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "profiles: update own" ON public.profiles FOR UPDATE TO authenticated USING ((id = auth.uid())) WITH CHECK ((id = auth.uid()));


--
-- Name: sale_returns; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sale_returns ENABLE ROW LEVEL SECURITY;

--
-- Name: sale_returns sale_returns: admin delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "sale_returns: admin delete" ON public.sale_returns FOR DELETE TO authenticated USING ((public.is_shop_admin() AND (shop_id = public.current_shop_id())));


--
-- Name: sale_returns sale_returns: shop insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "sale_returns: shop insert" ON public.sale_returns FOR INSERT TO authenticated WITH CHECK ((public.is_approved() AND (shop_id = public.current_shop_id())));


--
-- Name: sale_returns sale_returns: shop read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "sale_returns: shop read" ON public.sale_returns FOR SELECT TO authenticated USING ((public.is_approved() AND (shop_id = public.current_shop_id())));


--
-- Name: sale_returns sale_returns: shop update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "sale_returns: shop update" ON public.sale_returns FOR UPDATE TO authenticated USING ((public.is_approved() AND (shop_id = public.current_shop_id()))) WITH CHECK ((public.is_approved() AND (shop_id = public.current_shop_id())));


--
-- Name: sales; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;

--
-- Name: sales sales: admin reads shop; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "sales: admin reads shop" ON public.sales FOR SELECT TO authenticated USING ((public.is_shop_admin() AND (shop_id = public.current_shop_id())));


--
-- Name: sales sales: insert own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "sales: insert own" ON public.sales FOR INSERT TO authenticated WITH CHECK ((public.is_approved() AND (seller_id = auth.uid()) AND (shop_id = public.current_shop_id())));


--
-- Name: sales sales: seller reads own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "sales: seller reads own" ON public.sales FOR SELECT TO authenticated USING ((public.is_approved() AND (seller_id = auth.uid()) AND (shop_id = public.current_shop_id())));


--
-- Name: sales sales: shop read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "sales: shop read" ON public.sales FOR SELECT TO authenticated USING ((public.is_approved() AND (shop_id = public.current_shop_id())));


--
-- Name: sales sales: shop update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "sales: shop update" ON public.sales FOR UPDATE TO authenticated USING ((public.is_approved() AND (shop_id = public.current_shop_id()))) WITH CHECK ((public.is_approved() AND (shop_id = public.current_shop_id())));


--
-- Name: shop_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shop_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: shop_settings shop_settings: admin writes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "shop_settings: admin writes" ON public.shop_settings TO authenticated USING ((public.is_shop_admin() AND (shop_id = public.current_shop_id()))) WITH CHECK ((public.is_shop_admin() AND (shop_id = public.current_shop_id())));


--
-- Name: shop_settings shop_settings: public read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "shop_settings: public read" ON public.shop_settings FOR SELECT TO anon USING (public_enabled);


--
-- Name: shop_settings shop_settings: shop read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "shop_settings: shop read" ON public.shop_settings FOR SELECT TO authenticated USING ((shop_id = public.current_shop_id()));


--
-- Name: shop_settings shop_settings: super_admin read all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "shop_settings: super_admin read all" ON public.shop_settings FOR SELECT TO authenticated USING (public.is_super_admin());


--
-- Name: shop_settings shop_settings: super_admin write all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "shop_settings: super_admin write all" ON public.shop_settings TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: superadmin_notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.superadmin_notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: superadmin_notifications superadmin_notifications: super_admin all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "superadmin_notifications: super_admin all" ON public.superadmin_notifications TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: supplier_debt_operations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.supplier_debt_operations ENABLE ROW LEVEL SECURITY;

--
-- Name: supplier_debt_operations supplier_debt_operations_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY supplier_debt_operations_select ON public.supplier_debt_operations FOR SELECT TO authenticated USING (((shop_id = public.current_shop_id()) AND public.is_approved()));


--

-- Create the CRM profile after Supabase Auth creates a user.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Product image bucket and shop-folder upload access.
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Allow authenticated selects to product-images 16wiy3a_0" ON storage.objects;
CREATE POLICY "Allow authenticated selects to product-images 16wiy3a_0"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'product-images');

DROP POLICY IF EXISTS "Allow authenticated uploads to product-images 16wiy3a_0" ON storage.objects;
DROP POLICY IF EXISTS product_images_shop_upload ON storage.objects;
CREATE POLICY product_images_shop_upload
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'product-images'
    AND (storage.foldername(name))[1] = public.current_shop_id()::text
  );

-- Keep CRM tables in the existing Supabase realtime publication when available.
DO $realtime$
DECLARE
  table_name text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH table_name IN ARRAY ARRAY[
      'cash_operations', 'cash_reason_presets', 'customers', 'metal_rates',
      'product_deletion_tombstones', 'products', 'sale_returns', 'sales',
      'shop_settings', 'superadmin_notifications', 'supplier_debt_operations'
    ] LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = table_name
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', table_name);
      END IF;
    END LOOP;
  END IF;
END
$realtime$;
