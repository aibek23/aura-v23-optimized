-- Apply after v35-v44, before deploying the new application.
-- Uses the same ledger as lib/cash.ts. All new cash operations and supplier
-- payouts take the SAME per-shop lock before checking available funds.
BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS cash_operations_client_op_id_idx
  ON public.cash_operations (client_op_id) WHERE client_op_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.cash_ledger_balances(_shop uuid)
RETURNS TABLE (cash numeric, electronic numeric)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
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

REVOKE ALL ON FUNCTION public.cash_ledger_balances(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cash_ledger_balances(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_cash_operation_atomic(
  _client_op_id text,
  _type text,
  _amount numeric,
  _source text DEFAULT 'cash',
  _amount_cash numeric DEFAULT 0,
  _amount_electronic numeric DEFAULT 0,
  _reason text DEFAULT NULL,
  _allow_seller boolean DEFAULT false,
  _save_preset boolean DEFAULT false,
  _operation_id uuid DEFAULT NULL,
  _created_at timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.create_cash_operation_atomic(text, text, numeric, text, numeric, numeric, text, boolean, boolean, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_cash_operation_atomic(text, text, numeric, text, numeric, numeric, text, boolean, boolean, uuid, timestamptz) TO authenticated;

-- v38 used a supplier-specific lock. That did not serialize payouts to two
-- different suppliers, or a supplier payout against a manual withdrawal.
CREATE OR REPLACE FUNCTION public.pay_supplier_debt(
  _supplier_name text, _supplier_phone text, _amount numeric, _source text,
  _amount_cash numeric, _amount_electronic numeric, _reason text,
  _device_info text DEFAULT NULL
) RETURNS public.supplier_debt_operations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_shop uuid := public.current_shop_id();
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
  IF nullif(btrim(_supplier_name), '') IS NULL THEN RAISE EXCEPTION 'Укажите поставщика'; END IF;
  IF v_amount IS NULL OR v_amount::text = 'NaN' OR v_amount <= 0 THEN RAISE EXCEPTION 'Сумма должна быть больше нуля'; END IF;
  IF _source IS NULL OR _source NOT IN ('cash', 'electronic', 'mixed') THEN RAISE EXCEPTION 'Неверный источник выплаты'; END IF;
  IF _source = 'cash' THEN v_cash := v_amount; v_electronic := 0; END IF;
  IF _source = 'electronic' THEN v_cash := 0; v_electronic := v_amount; END IF;
  IF v_cash < 0 OR v_electronic < 0 OR v_cash::text = 'NaN' OR v_electronic::text = 'NaN'
     OR abs(v_cash + v_electronic - v_amount) > 0.01 THEN
    RAISE EXCEPTION 'Разбивка выплаты не совпадает с суммой';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_shop::text || ':cash-ledger', 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(
    v_shop::text || ':supplier:' || btrim(_supplier_name) || ':' ||
    coalesce(nullif(btrim(_supplier_phone), ''), ''), 0
  ));
  SELECT coalesce(sum(CASE WHEN operation_type IN ('consignment', 'adjustment') THEN amount ELSE -amount END), 0)
    INTO v_before FROM public.supplier_debt_operations
    WHERE shop_id = v_shop AND supplier_name = btrim(_supplier_name)
      AND supplier_phone IS NOT DISTINCT FROM nullif(btrim(_supplier_phone), '');
  IF v_amount > v_before + 0.01 THEN
    RAISE EXCEPTION 'Выплата больше остатка долга: доступно %', v_before;
  END IF;
  SELECT cash, electronic INTO v_cash_balance, v_electronic_balance
    FROM public.cash_ledger_balances(v_shop);
  IF v_cash > v_cash_balance THEN RAISE EXCEPTION 'Недостаточно наличных: доступно %', v_cash_balance; END IF;
  IF v_electronic > v_electronic_balance THEN RAISE EXCEPTION 'Недостаточно электронных средств: доступно %', v_electronic_balance; END IF;

  INSERT INTO public.cash_operations (
    shop_id, created_by, author_name, type, amount, reason, source,
    amount_cash, amount_electronic, supplier_name, supplier_phone
  ) VALUES (
    v_shop, auth.uid(), v_profile.full_name, 'outcome', v_amount,
    coalesce(nullif(btrim(_reason), ''), 'Выплата поставщику'), _source,
    v_cash, v_electronic, btrim(_supplier_name), nullif(btrim(_supplier_phone), '')
  ) RETURNING id INTO v_cash_id;
  INSERT INTO public.supplier_debt_operations (
    shop_id, supplier_name, supplier_phone, operation_type, amount,
    balance_before, balance_after, cash_operation_id, source, amount_cash,
    amount_electronic, reason, created_by, author_name, device_info
  ) VALUES (
    v_shop, btrim(_supplier_name), nullif(btrim(_supplier_phone), ''),
    'payment', v_amount, v_before, v_before - v_amount, v_cash_id, _source,
    v_cash, v_electronic, coalesce(nullif(btrim(_reason), ''), 'Выплата поставщику'),
    auth.uid(), v_profile.full_name, left(_device_info, 500)
  ) RETURNING * INTO v_operation;
  UPDATE public.cash_operations SET supplier_debt_operation_id = v_operation.id WHERE id = v_cash_id;
  RETURN v_operation;
END;
$$;
REVOKE ALL ON FUNCTION public.pay_supplier_debt(text, text, numeric, text, numeric, numeric, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pay_supplier_debt(text, text, numeric, text, numeric, numeric, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;