-- =============================================================================
-- v38: Calculate supplier payouts from the same cash ledger as the app.
--
-- Legacy sales live only in public.sales, while new atomic offline sales also
-- create a linked cash_operations row. Include unrepresented sales and omit the
-- linked cash mirror so each receipt changes the balance exactly once.
-- =============================================================================

BEGIN;

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

  -- Mirror lib/cash.ts: use sales as the canonical receipt and skip only
  -- cash_operations entries linked to those sales by the :cash idempotency key.
  WITH operation_splits AS (
    SELECT co.*,
      CASE
        WHEN co.source = 'electronic' THEN 0
        WHEN co.source = 'mixed' THEN
          CASE
            WHEN coalesce(co.amount_cash, 0) + coalesce(co.amount_electronic, 0) <= 0 THEN co.amount
            ELSE coalesce(co.amount_cash, 0)
          END
        ELSE co.amount
      END AS cash_part,
      CASE
        WHEN co.source = 'electronic' THEN co.amount
        WHEN co.source = 'mixed' THEN
          CASE
            WHEN coalesce(co.amount_cash, 0) + coalesce(co.amount_electronic, 0) <= 0 THEN 0
            ELSE coalesce(co.amount_electronic, 0)
          END
        ELSE 0
      END AS electronic_part
    FROM public.cash_operations AS co
    WHERE co.shop_id = v_shop
      AND co.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1
          FROM public.sales AS s
         WHERE s.shop_id = co.shop_id
           AND s.deleted_at IS NULL
           AND s.client_op_id IS NOT NULL
           AND co.client_op_id = s.client_op_id || ':cash'
      )
  ),
  operation_balance AS (
    SELECT
      coalesce(sum(
        CASE
          WHEN type = 'collection' THEN -(cash_part + electronic_part)
          WHEN type = 'income' THEN cash_part
          ELSE -cash_part
        END
      ), 0) AS cash,
      coalesce(sum(
        CASE
          WHEN type = 'collection' THEN cash_part + electronic_part
          WHEN type = 'income' THEN electronic_part
          ELSE -electronic_part
        END
      ), 0) AS electronic
    FROM operation_splits
  ),
  sale_balance AS (
    SELECT
      coalesce(sum(
        CASE
          WHEN s.payment_method = 'mixed' THEN
            CASE
              WHEN coalesce(s.amount_cash, 0) + coalesce(s.amount_electronic, 0) <= 0 THEN coalesce(s.total, 0)
              ELSE coalesce(s.amount_cash, 0)
            END
          WHEN s.payment_method IN ('card', 'transfer') THEN 0
          ELSE coalesce(s.total, 0)
        END
      ), 0) AS cash,
      coalesce(sum(
        CASE
          WHEN s.payment_method = 'mixed' THEN
            CASE
              WHEN coalesce(s.amount_cash, 0) + coalesce(s.amount_electronic, 0) <= 0 THEN 0
              ELSE coalesce(s.amount_electronic, 0)
            END
          WHEN s.payment_method IN ('card', 'transfer') THEN coalesce(s.total, 0)
          ELSE 0
        END
      ), 0) AS electronic
    FROM public.sales AS s
    WHERE s.shop_id = v_shop
      AND s.deleted_at IS NULL
  )
  SELECT operation_balance.cash + sale_balance.cash,
         operation_balance.electronic + sale_balance.electronic
    INTO v_cash_balance, v_electronic_balance
    FROM operation_balance CROSS JOIN sale_balance;

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

GRANT EXECUTE ON FUNCTION public.pay_supplier_debt(text, text, numeric, text, numeric, numeric, text, text)
  TO authenticated;

COMMIT;