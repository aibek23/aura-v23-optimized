-- =============================================================================
-- v36: Atomic confirmation for sales created while devices were offline.
--
-- Two sellers may both record the same unique item locally. This RPC serializes
-- each operation, locks its product rows in a stable order, and commits the
-- stock change, receipt and cash entry in one PostgreSQL transaction. The first
-- queued sale to reach the server wins; later copies receive a stock_conflict.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.commit_offline_sale(
  _client_op_id text,
  _sale jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
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

  IF NOT FOUND OR v_profile.status::text <> 'approved' OR v_profile.shop_id IS NULL THEN
    RAISE EXCEPTION 'Нет доступа к магазину' USING ERRCODE = '42501';
  END IF;
  v_shop_id := v_profile.shop_id;

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

REVOKE ALL ON FUNCTION public.commit_offline_sale(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commit_offline_sale(text, jsonb) TO authenticated;

COMMIT;