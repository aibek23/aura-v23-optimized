-- AURA GOLD CRM — учёт поставщиков и долгов по товарам, взятым на реализацию.
-- Каждая операция неизменяема: приём товара, ручная корректировка и выплата
-- записываются отдельными строками с остатком до/после и данными устройства.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'supplier_debt_operation_type') THEN
    CREATE TYPE public.supplier_debt_operation_type AS ENUM ('consignment', 'adjustment', 'payment');
  END IF;
END $$;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS consignment_operation_id uuid,
  ADD COLUMN IF NOT EXISTS consignment_at timestamptz,
  ADD COLUMN IF NOT EXISTS consignment_by uuid;

ALTER TABLE public.cash_operations
  ADD COLUMN IF NOT EXISTS supplier_name text,
  ADD COLUMN IF NOT EXISTS supplier_phone text,
  ADD COLUMN IF NOT EXISTS supplier_debt_operation_id uuid;

CREATE TABLE IF NOT EXISTS public.supplier_debt_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL,
  supplier_name text NOT NULL,
  supplier_phone text,
  operation_type public.supplier_debt_operation_type NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  balance_before numeric(14,2) NOT NULL DEFAULT 0,
  balance_after numeric(14,2) NOT NULL DEFAULT 0 CHECK (balance_after >= 0),
  product_id uuid,
  cash_operation_id uuid,
  source text CHECK (source IS NULL OR source IN ('cash', 'electronic', 'mixed')),
  amount_cash numeric(14,2) NOT NULL DEFAULT 0,
  amount_electronic numeric(14,2) NOT NULL DEFAULT 0,
  reason text NOT NULL DEFAULT '',
  created_by uuid NOT NULL,
  author_name text,
  device_info text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS supplier_debt_operations_shop_supplier_idx
  ON public.supplier_debt_operations(shop_id, supplier_name, supplier_phone, created_at DESC);
CREATE INDEX IF NOT EXISTS supplier_debt_operations_product_idx
  ON public.supplier_debt_operations(product_id);

ALTER TABLE public.supplier_debt_operations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS supplier_debt_operations_select ON public.supplier_debt_operations;
CREATE POLICY supplier_debt_operations_select ON public.supplier_debt_operations
  FOR SELECT TO authenticated
  USING (shop_id = public.current_shop_id() AND public.is_approved());

DROP POLICY IF EXISTS products_consignment_update ON public.products;
CREATE POLICY products_consignment_update ON public.products
  FOR UPDATE TO authenticated
  USING (shop_id = public.current_shop_id() AND public.is_approved())
  WITH CHECK (shop_id = public.current_shop_id() AND public.is_approved());

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
  v_operation public.supplier_debt_operations;
BEGIN
  IF NOT public.is_approved() THEN
    RAISE EXCEPTION 'Аккаунт не подтверждён' USING errcode = '42501';
  END IF;
  SELECT * INTO v_product FROM public.products
   WHERE id = _product_id AND shop_id = v_shop FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Товар не найден'; END IF;
  IF NULLIF(btrim(v_product.supplier_name), '') IS NULL THEN
    RAISE EXCEPTION 'У товара не указан поставщик';
  END IF;
  IF v_product.consignment_operation_id IS NOT NULL THEN
    RAISE EXCEPTION 'Товар уже взят на реализацию';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    v_shop::text || ':supplier:' || btrim(v_product.supplier_name) || ':' ||
    coalesce(nullif(btrim(v_product.supplier_phone), ''), ''), 0
  ));
  v_amount := round(coalesce(v_product.purchase_price, 0) * greatest(coalesce(v_product.quantity, 1), 1), 2);
  IF v_amount <= 0 THEN RAISE EXCEPTION 'Закупочная стоимость товара должна быть больше нуля'; END IF;

  SELECT coalesce(sum(CASE WHEN operation_type IN ('consignment','adjustment') THEN amount ELSE -amount END), 0)
    INTO v_before
    FROM public.supplier_debt_operations
   WHERE shop_id = v_shop
     AND supplier_name = btrim(v_product.supplier_name)
     AND supplier_phone IS NOT DISTINCT FROM nullif(btrim(v_product.supplier_phone), '');

  INSERT INTO public.supplier_debt_operations (
    shop_id, supplier_name, supplier_phone, operation_type, amount,
    balance_before, balance_after, product_id, reason, created_by, author_name, device_info
  )
  SELECT v_shop, btrim(v_product.supplier_name), nullif(btrim(v_product.supplier_phone), ''),
         'consignment', v_amount, v_before, v_before + v_amount, v_product.id,
         'Товар взят на реализацию', p.id, p.full_name, left(_device_info, 500)
    FROM public.profiles p WHERE p.id = auth.uid()
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
  v_before numeric(14,2);
  v_operation public.supplier_debt_operations;
BEGIN
  IF NOT public.is_shop_admin() THEN RAISE EXCEPTION 'Недостаточно прав' USING errcode = '42501'; END IF;
  IF nullif(btrim(_supplier_name), '') IS NULL THEN RAISE EXCEPTION 'Укажите поставщика'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Сумма должна быть больше нуля'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    v_shop::text || ':supplier:' || btrim(_supplier_name) || ':' ||
    coalesce(nullif(btrim(_supplier_phone), ''), ''), 0
  ));
  SELECT coalesce(sum(CASE WHEN operation_type IN ('consignment','adjustment') THEN amount ELSE -amount END), 0)
    INTO v_before
    FROM public.supplier_debt_operations
   WHERE shop_id = v_shop AND supplier_name = btrim(_supplier_name)
     AND supplier_phone IS NOT DISTINCT FROM nullif(btrim(_supplier_phone), '');
  INSERT INTO public.supplier_debt_operations (
    shop_id, supplier_name, supplier_phone, operation_type, amount,
    balance_before, balance_after, reason, created_by, author_name, device_info
  )
  SELECT v_shop, btrim(_supplier_name), nullif(btrim(_supplier_phone), ''),
         'adjustment', round(_amount, 2), v_before, v_before + round(_amount, 2),
         left(btrim(_reason), 500), p.id, p.full_name, left(_device_info, 500)
    FROM public.profiles p WHERE p.id = auth.uid()
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
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_shop uuid := public.current_shop_id();
  v_before numeric(14,2);
  v_amount numeric(14,2) := round(_amount, 2);
  v_cash numeric(14,2) := round(coalesce(_amount_cash, 0), 2);
  v_electronic numeric(14,2) := round(coalesce(_amount_electronic, 0), 2);
  v_cash_id uuid;
  v_operation public.supplier_debt_operations;
  v_profile public.profiles;
  v_cash_balance numeric(14,2);
  v_electronic_balance numeric(14,2);
BEGIN
  IF NOT public.is_shop_admin() THEN RAISE EXCEPTION 'Недостаточно прав' USING errcode = '42501'; END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE id = auth.uid();
  IF nullif(btrim(_supplier_name), '') IS NULL THEN RAISE EXCEPTION 'Укажите поставщика'; END IF;
  IF v_amount <= 0 THEN RAISE EXCEPTION 'Сумма должна быть больше нуля'; END IF;
  IF _source NOT IN ('cash', 'electronic', 'mixed') THEN RAISE EXCEPTION 'Неверный источник выплаты'; END IF;
  IF _source = 'cash' THEN v_cash := v_amount; v_electronic := 0; END IF;
  IF _source = 'electronic' THEN v_cash := 0; v_electronic := v_amount; END IF;
  IF abs(v_cash + v_electronic - v_amount) > 0.01 THEN RAISE EXCEPTION 'Разбивка выплаты не совпадает с суммой'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    v_shop::text || ':supplier:' || btrim(_supplier_name) || ':' ||
    coalesce(nullif(btrim(_supplier_phone), ''), ''), 0
  ));

  SELECT coalesce(sum(CASE WHEN operation_type IN ('consignment','adjustment') THEN amount ELSE -amount END), 0)
    INTO v_before
    FROM public.supplier_debt_operations
   WHERE shop_id = v_shop AND supplier_name = btrim(_supplier_name)
     AND supplier_phone IS NOT DISTINCT FROM nullif(btrim(_supplier_phone), '');
  IF v_amount > v_before + 0.01 THEN
    RAISE EXCEPTION 'Выплата больше остатка долга: доступно %', v_before;
  END IF;

  SELECT coalesce(sum(
      CASE
        WHEN type = 'collection' THEN -coalesce(amount_cash, amount)
        WHEN type = 'income' THEN
          CASE WHEN source = 'mixed' THEN coalesce(amount_cash, 0)
               WHEN source = 'cash' OR source IS NULL THEN amount ELSE 0 END
        ELSE -CASE WHEN source = 'mixed' THEN coalesce(amount_cash, 0)
                   WHEN source = 'cash' OR source IS NULL THEN amount ELSE 0 END
      END
    ), 0),
    coalesce(sum(
      CASE
        WHEN type = 'collection' THEN coalesce(amount_cash, amount)
        WHEN type = 'income' THEN
          CASE WHEN source = 'mixed' THEN coalesce(amount_electronic, 0)
               WHEN source = 'electronic' THEN amount ELSE 0 END
        ELSE -CASE WHEN source = 'mixed' THEN coalesce(amount_electronic, 0)
                   WHEN source = 'electronic' THEN amount ELSE 0 END
      END
    ), 0)
    INTO v_cash_balance, v_electronic_balance
    FROM public.cash_operations WHERE shop_id = v_shop;
  IF v_cash > v_cash_balance + 0.01 THEN RAISE EXCEPTION 'Недостаточно наличных: доступно %', v_cash_balance; END IF;
  IF v_electronic > v_electronic_balance + 0.01 THEN RAISE EXCEPTION 'Недостаточно электронных средств: доступно %', v_electronic_balance; END IF;

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

GRANT EXECUTE ON FUNCTION public.take_product_on_consignment(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_supplier_debt(text, text, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pay_supplier_debt(text, text, numeric, text, numeric, numeric, text, text) TO authenticated;