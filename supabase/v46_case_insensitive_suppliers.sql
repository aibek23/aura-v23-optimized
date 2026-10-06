-- Merge supplier identities that differ only by letter case.
-- Names keep their original display spelling; matching uses lower(trim(name)).
-- Phone remains part of the identity.
BEGIN;

CREATE INDEX IF NOT EXISTS supplier_debt_operations_shop_supplier_identity_idx
  ON public.supplier_debt_operations (
    shop_id,
    lower(btrim(supplier_name)),
    (nullif(btrim(supplier_phone), '')),
    created_at DESC
  );

CREATE OR REPLACE FUNCTION public.take_product_on_consignment(
  _product_id uuid,
  _device_info text DEFAULT NULL
) RETURNS public.supplier_debt_operations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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

CREATE OR REPLACE FUNCTION public.adjust_supplier_debt(
  _supplier_name text,
  _supplier_phone text,
  _amount numeric,
  _reason text,
  _device_info text DEFAULT NULL
) RETURNS public.supplier_debt_operations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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

CREATE OR REPLACE FUNCTION public.pay_supplier_debt(
  _supplier_name text,
  _supplier_phone text,
  _amount numeric,
  _source text,
  _amount_cash numeric,
  _amount_electronic numeric,
  _reason text,
  _device_info text DEFAULT NULL
) RETURNS public.supplier_debt_operations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
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

GRANT EXECUTE ON FUNCTION public.take_product_on_consignment(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_supplier_debt(text, text, numeric, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.pay_supplier_debt(text, text, numeric, text, numeric, numeric, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pay_supplier_debt(text, text, numeric, text, numeric, numeric, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
