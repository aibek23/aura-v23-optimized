-- Credit sales, customer debt ledger, partial repayments and debt-aware returns.
BEGIN;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS debt_balance numeric(14,2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'customers_debt_balance_nonnegative'
      AND conrelid = 'public.customers'::regclass
  ) THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_debt_balance_nonnegative CHECK (debt_balance >= 0);
  END IF;
END;
$$;

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS credit_balance numeric(14,2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sales_credit_balance_nonnegative'
      AND conrelid = 'public.sales'::regclass
  ) THEN
    ALTER TABLE public.sales
      ADD CONSTRAINT sales_credit_balance_nonnegative CHECK (credit_balance >= 0);
  END IF;
END;
$$;

ALTER TABLE public.cash_operations
  ADD COLUMN IF NOT EXISTS customer_debt_operation_id uuid;

CREATE TABLE IF NOT EXISTS public.customer_debt_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  sale_id uuid REFERENCES public.sales(id) ON DELETE RESTRICT,
  sale_return_id uuid REFERENCES public.sale_returns(id) ON DELETE RESTRICT,
  operation_type text NOT NULL CHECK (operation_type IN ('credit_sale', 'payment', 'credit_return')),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  balance_before numeric(14,2) NOT NULL CHECK (balance_before >= 0),
  balance_after numeric(14,2) NOT NULL CHECK (balance_after >= 0),
  cash_operation_id uuid REFERENCES public.cash_operations(id) ON DELETE SET NULL,
  source text CHECK (source IS NULL OR source IN ('cash', 'electronic', 'mixed')),
  amount_cash numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount_cash >= 0),
  amount_electronic numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount_electronic >= 0),
  reason text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  author_name text,
  device_info text,
  created_at timestamptz NOT NULL DEFAULT now(),
  client_op_id text
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cash_operations_customer_debt_operation_id_fkey'
      AND conrelid = 'public.cash_operations'::regclass
  ) THEN
    ALTER TABLE public.cash_operations
      ADD CONSTRAINT cash_operations_customer_debt_operation_id_fkey
      FOREIGN KEY (customer_debt_operation_id)
      REFERENCES public.customer_debt_operations(id) ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS customer_debt_operations_shop_client_op_idx
  ON public.customer_debt_operations (shop_id, client_op_id)
  WHERE client_op_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS customer_debt_operations_credit_sale_idx
  ON public.customer_debt_operations (sale_id)
  WHERE operation_type = 'credit_sale' AND sale_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS customer_debt_operations_credit_return_idx
  ON public.customer_debt_operations (sale_return_id)
  WHERE operation_type = 'credit_return' AND sale_return_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS customer_debt_operations_customer_created_idx
  ON public.customer_debt_operations (shop_id, customer_id, created_at DESC);

ALTER TABLE public.customer_debt_operations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "customer debt: shop select" ON public.customer_debt_operations;
CREATE POLICY "customer debt: shop select"
  ON public.customer_debt_operations FOR SELECT TO authenticated
  USING (shop_id = public.current_shop_id() AND public.is_approved());
DROP POLICY IF EXISTS "customer debt: shop insert" ON public.customer_debt_operations;
CREATE POLICY "customer debt: shop insert"
  ON public.customer_debt_operations FOR INSERT TO authenticated
  WITH CHECK (
    shop_id = public.current_shop_id()
    AND public.is_approved()
    AND operation_type = 'credit_sale'
    AND EXISTS (
      SELECT 1 FROM public.sales s
      WHERE s.id = customer_debt_operations.sale_id
        AND s.customer_id = customer_debt_operations.customer_id
        AND s.shop_id = customer_debt_operations.shop_id
        AND s.payment_method = 'credit'
    )
  );
GRANT SELECT, INSERT ON public.customer_debt_operations TO authenticated;
REVOKE UPDATE, DELETE ON public.customer_debt_operations FROM authenticated;


CREATE OR REPLACE FUNCTION public.cash_ledger_balances(_shop uuid) RETURNS TABLE(cash numeric, electronic numeric)
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
        WHEN payment_method IN ('card', 'transfer', 'credit') THEN 0
        ELSE coalesce(total, 0) END), 0) AS cash,
      coalesce(sum(CASE
        WHEN payment_method = 'mixed' THEN
          CASE WHEN coalesce(amount_cash, 0) + coalesce(amount_electronic, 0) <= 0
            THEN 0 ELSE coalesce(amount_electronic, 0) END
        WHEN payment_method IN ('card', 'transfer') THEN coalesce(total, 0)
        WHEN payment_method = 'credit' THEN 0
        ELSE 0 END), 0) AS electronic
    FROM public.sales
    WHERE shop_id = _shop AND deleted_at IS NULL
  )
  SELECT ob.cash + sb.cash, ob.electronic + sb.electronic
  FROM operation_balance ob CROSS JOIN sale_balance sb;
$$;

CREATE OR REPLACE FUNCTION public.commit_offline_sale(_client_op_id text, _sale jsonb) RETURNS jsonb
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
  v_customer_balance_before numeric(14,2) := 0;
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
  IF v_payment_method NOT IN ('cash', 'card', 'transfer', 'mixed', 'credit') THEN
    RAISE EXCEPTION 'Некорректный способ оплаты' USING ERRCODE = '22023';
  END IF;

  -- Lock customer rows before product rows; returns and repayments use the same
  -- order, preventing deadlocks when the returned item is sold again.
  v_customer_id := nullif(_sale->>'customer_id', '')::uuid;
  v_customer_name := nullif(btrim(_sale->>'customer_name'), '');
  v_customer_phone := nullif(btrim(_sale->>'customer_phone'), '');
  IF v_payment_method = 'credit' AND v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Для продажи в долг выберите клиента из списка' USING ERRCODE = '22023';
  END IF;
  IF v_customer_id IS NOT NULL THEN
    SELECT coalesce(v_customer_name, c.name),
           coalesce(v_customer_phone, c.phone),
           coalesce(c.debt_balance, 0)
      INTO v_customer_name, v_customer_phone, v_customer_balance_before
      FROM public.customers c
     WHERE c.id = v_customer_id AND c.shop_id = v_shop_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Клиент не найден в этом магазине' USING ERRCODE = '22023';
    END IF;
  ELSIF v_customer_phone IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended('offline-customer:' || v_shop_id::text || ':' || v_customer_phone, 0)
    );
    SELECT c.id, coalesce(v_customer_name, c.name),
           coalesce(v_customer_phone, c.phone),
           coalesce(c.debt_balance, 0)
      INTO v_customer_id, v_customer_name, v_customer_phone, v_customer_balance_before
      FROM public.customers c
     WHERE c.shop_id = v_shop_id AND c.phone = v_customer_phone
     ORDER BY c.created_at
     LIMIT 1
     FOR UPDATE;
    IF NOT FOUND THEN
      v_customer_id := NULL;
      v_customer_name := nullif(btrim(_sale->>'customer_name'), '');
      v_customer_phone := nullif(btrim(_sale->>'customer_phone'), '');
      v_customer_balance_before := 0;
    END IF;
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
  ELSIF v_payment_method = 'credit' THEN
    IF v_total <= 0 THEN
      RAISE EXCEPTION 'Сумма долга должна быть больше нуля' USING ERRCODE = '22023';
    END IF;
    v_amount_cash := 0;
    v_amount_electronic := 0;
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
  IF v_customer_id IS NULL AND v_customer_phone IS NOT NULL AND v_customer_name IS NOT NULL THEN
    INSERT INTO public.customers (shop_id, name, phone, bonus_points)
    VALUES (v_shop_id, v_customer_name, v_customer_phone, 0)
    RETURNING id INTO v_customer_id;
  ELSIF v_customer_id IS NOT NULL
        AND nullif(_sale->>'customer_id', '') IS NULL
        AND v_customer_name IS NOT NULL THEN
    UPDATE public.customers
       SET name = v_customer_name
     WHERE id = v_customer_id AND shop_id = v_shop_id;
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
    bonus_used, items, created_at, client_op_id, credit_balance
  ) VALUES (
    v_sale_id, v_shop_id, v_user_id, v_profile.full_name, v_customer_id,
    v_customer_name,
    v_customer_phone,
    v_payment_method, v_amount_cash, v_amount_electronic,
    v_subtotal, 0, v_total, v_cost_total, v_total - v_cost_total, v_bonus_earned,
    v_bonus_used, v_validated_items, v_created_at, _client_op_id,
    CASE WHEN v_payment_method = 'credit' THEN v_total ELSE 0 END
  );

  IF v_customer_id IS NOT NULL THEN
    PERFORM public.increment_customer_stats(v_customer_id, v_total);
  END IF;

  IF v_payment_method = 'credit' THEN
    UPDATE public.customers
       SET debt_balance = round(v_customer_balance_before + v_total, 2)
     WHERE id = v_customer_id AND shop_id = v_shop_id;

    INSERT INTO public.customer_debt_operations (
      shop_id, customer_id, sale_id, operation_type, amount,
      balance_before, balance_after, source, amount_cash, amount_electronic,
      reason, created_by, author_name, client_op_id
    ) VALUES (
      v_shop_id, v_customer_id, v_sale_id, 'credit_sale', v_total,
      v_customer_balance_before, round(v_customer_balance_before + v_total, 2),
      NULL, 0, 0, 'Продажа в долг #' || left(v_sale_id::text, 8),
      v_user_id, v_profile.full_name, _client_op_id || ':debt'
    );
  END IF;

  IF v_bonus_earned > 0 THEN
    UPDATE public.profiles
       SET bonus_points = coalesce(bonus_points, 0) + v_bonus_earned
     WHERE id = v_user_id;
  END IF;

  IF v_total > 0 AND v_payment_method <> 'credit' THEN
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

CREATE OR REPLACE FUNCTION public.pay_customer_debt(
  _client_op_id text,
  _customer_id uuid,
  _amount numeric,
  _source text,
  _amount_cash numeric DEFAULT 0,
  _amount_electronic numeric DEFAULT 0,
  _device_info text DEFAULT NULL
) RETURNS public.customer_debt_operations
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_shop uuid := public.current_shop_id();
  v_customer public.customers;
  v_operation public.customer_debt_operations;
  v_cash_operation_id uuid;
  v_amount numeric(14,2);
  v_cash numeric(14,2) := 0;
  v_electronic numeric(14,2) := 0;
  v_before numeric(14,2);
  v_after numeric(14,2);
  v_author text;
  v_source text;
  v_remaining numeric(14,2);
  v_applied numeric(14,2);
  v_credit_sale record;
BEGIN
  IF v_user IS NULL OR NOT public.is_approved() OR v_shop IS NULL THEN
    RAISE EXCEPTION 'Нет доступа к магазину' USING ERRCODE = '42501';
  END IF;
  IF _client_op_id IS NULL OR btrim(_client_op_id) = '' THEN
    RAISE EXCEPTION 'Не указан идентификатор платежа' USING ERRCODE = '22023';
  END IF;
  v_amount := round(coalesce(_amount, 0), 2);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'Сумма платежа должна быть больше нуля' USING ERRCODE = '22023';
  END IF;
  v_source := coalesce(_source, '');
  IF v_source NOT IN ('cash', 'electronic', 'mixed') THEN
    RAISE EXCEPTION 'Некорректный источник оплаты' USING ERRCODE = '22023';
  END IF;

  IF v_source = 'cash' THEN
    v_cash := v_amount;
  ELSIF v_source = 'electronic' THEN
    v_electronic := v_amount;
  ELSE
    v_cash := round(coalesce(_amount_cash, 0), 2);
    v_electronic := round(coalesce(_amount_electronic, 0), 2);
    IF v_cash < 0 OR v_electronic < 0 OR abs(v_cash + v_electronic - v_amount) > 0.01 THEN
      RAISE EXCEPTION 'Разбивка оплаты не совпадает с суммой' USING ERRCODE = '22023';
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('customer-debt-payment:' || v_shop::text || ':' || _client_op_id, 0)
  );
  SELECT * INTO v_operation
    FROM public.customer_debt_operations
   WHERE shop_id = v_shop AND client_op_id = _client_op_id
   LIMIT 1;
  IF FOUND THEN
    RETURN v_operation;
  END IF;

  SELECT * INTO v_customer
    FROM public.customers
   WHERE id = _customer_id AND shop_id = v_shop
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Клиент не найден в этом магазине' USING ERRCODE = '22023';
  END IF;
  v_before := greatest(0, coalesce(v_customer.debt_balance, 0));
  IF v_amount > v_before THEN
    RAISE EXCEPTION 'Сумма платежа больше текущего долга (%).', v_before USING ERRCODE = '22023';
  END IF;
  v_after := round(v_before - v_amount, 2);
  SELECT full_name INTO v_author FROM public.profiles WHERE id = v_user;

  -- Apply repayments to oldest outstanding credit sales first so returns can
  -- distinguish an unpaid item from one the customer has already repaid.
  v_remaining := v_amount;
  FOR v_credit_sale IN
    SELECT id, credit_balance
      FROM public.sales
     WHERE shop_id = v_shop
       AND customer_id = _customer_id
       AND payment_method = 'credit'
       AND credit_balance > 0
     ORDER BY created_at, id
     FOR UPDATE
  LOOP
    v_applied := least(v_remaining, coalesce(v_credit_sale.credit_balance, 0));
    UPDATE public.sales
       SET credit_balance = greatest(0, round(credit_balance - v_applied, 2))
     WHERE id = v_credit_sale.id AND shop_id = v_shop;
    v_remaining := round(v_remaining - v_applied, 2);
    EXIT WHEN v_remaining <= 0;
  END LOOP;
  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Долг не совпадает с остатком по продажам' USING ERRCODE = '23514';
  END IF;

  UPDATE public.customers
     SET debt_balance = v_after
   WHERE id = _customer_id AND shop_id = v_shop;

  INSERT INTO public.customer_debt_operations (
    shop_id, customer_id, operation_type, amount, balance_before, balance_after,
    source, amount_cash, amount_electronic, reason, created_by, author_name,
    device_info, client_op_id
  ) VALUES (
    v_shop, _customer_id, 'payment', v_amount, v_before, v_after,
    v_source, v_cash, v_electronic,
    left('Погашение долга: ' || coalesce(v_customer.name, 'Клиент'), 300),
    v_user, v_author, _device_info, _client_op_id
  )
  RETURNING * INTO v_operation;

  INSERT INTO public.cash_operations (
    shop_id, created_by, author_name, type, amount, source,
    amount_cash, amount_electronic, reason, customer_debt_operation_id, client_op_id
  ) VALUES (
    v_shop, v_user, v_author, 'income', v_amount, v_source,
    v_cash, v_electronic, v_operation.reason, v_operation.id, _client_op_id || ':cash'
  )
  RETURNING id INTO v_cash_operation_id;

  UPDATE public.customer_debt_operations
     SET cash_operation_id = v_cash_operation_id
   WHERE id = v_operation.id
  RETURNING * INTO v_operation;

  RETURN v_operation;
END;
$$;

REVOKE ALL ON FUNCTION public.pay_customer_debt(text, uuid, numeric, text, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pay_customer_debt(text, uuid, numeric, text, numeric, numeric, text) TO authenticated;


CREATE OR REPLACE FUNCTION public.return_sale_item(_sale_id uuid, _item_index integer, _reason text DEFAULT NULL::text) RETURNS public.sale_returns
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
  v_debt_before numeric(14,2) := 0;
  v_debt_reduction numeric(14,2) := 0;
  v_credit_due numeric(14,2) := 0;
  v_cash_refund numeric(14,2) := 0;
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

  -- Сначала блокируем клиента, затем чек: тот же порядок используется при
  -- погашении долга и предотвращает конфликтующие блокировки.
  SELECT * INTO v_sale
    FROM public.sales
   WHERE id = _sale_id AND shop_id = v_shop;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Продажа не найдена' USING errcode = 'P0002';
  END IF;

  IF v_sale.customer_id IS NOT NULL THEN
    SELECT coalesce(debt_balance, 0) INTO v_debt_before
      FROM public.customers
     WHERE id = v_sale.customer_id AND shop_id = v_shop
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Клиент не найден в этом магазине' USING errcode = 'P0002';
    END IF;
  END IF;

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

  -- Сначала уменьшаем непогашенный долг; только уже оплаченная часть
  -- возвращается в кассу. Кредитный возврат не создаёт фиктивный расход.
  IF v_sale.payment_method = 'credit' AND v_sale.customer_id IS NOT NULL THEN
    v_credit_due := greatest(0, coalesce(v_sale.credit_balance, 0));
    v_debt_reduction := least(v_amount, v_credit_due);
    IF v_debt_reduction > v_debt_before THEN
      RAISE EXCEPTION 'Остаток долга по продаже больше долга клиента' USING errcode = '23514';
    END IF;
    v_cash := v_amount - v_debt_reduction;
    v_electronic := 0;
  ELSIF v_sale.payment_method = 'mixed' THEN
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

  v_cash_refund := v_cash + v_electronic;
  v_source := CASE
    WHEN v_cash > 0 AND v_electronic > 0 THEN 'mixed'
    WHEN v_electronic > 0 THEN 'electronic'
    ELSE 'cash'
  END;

  -- 1) Денежное изъятие из кассы.
  IF v_cash_refund > 0 THEN
    INSERT INTO public.cash_operations (
      shop_id, created_by, author_name, type, amount, source,
      amount_cash, amount_electronic, reason
    )
    SELECT v_shop, p.id, p.full_name, 'outcome', v_cash_refund, v_source,
           v_cash, v_electronic, v_reason
      FROM public.profiles p
     WHERE p.id = v_user
    RETURNING id INTO v_op_id;
  END IF;

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

  IF v_debt_reduction > 0 AND v_sale.customer_id IS NOT NULL THEN
    UPDATE public.sales
       SET credit_balance = greatest(0, round(coalesce(credit_balance, 0) - v_debt_reduction, 2))
     WHERE id = v_sale.id AND shop_id = v_shop;

    UPDATE public.customers
       SET debt_balance = greatest(0, round(v_debt_before - v_debt_reduction, 2))
     WHERE id = v_sale.customer_id AND shop_id = v_shop;

    INSERT INTO public.customer_debt_operations (
      shop_id, customer_id, sale_id, sale_return_id, operation_type, amount,
      balance_before, balance_after, source, amount_cash, amount_electronic,
      reason, created_by, author_name
    )
    SELECT v_shop, v_sale.customer_id, v_sale.id, v_return.id, 'credit_return',
           v_debt_reduction, v_debt_before,
           greatest(0, round(v_debt_before - v_debt_reduction, 2)),
           NULL, 0, 0, v_reason, p.id, p.full_name
      FROM public.profiles p
     WHERE p.id = v_user;
  END IF;

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

COMMIT;
