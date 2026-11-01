-- Защита долгов клиентов и исправление возвратов по продажам в долг.
--
-- Запускать ПОСЛЕ 20261019_customer_credit_sales.sql и 20261022_customer_credit_due_dates.sql.
-- Файл можно запускать повторно: все изменения выполняются одной транзакцией.
--
-- Что делает:
-- 1. Сотрудник больше не может напрямую (в обход приложения) менять долг клиента,
--    остаток долга по продаже, срок оплаты, способ оплаты «в долг» и удалять продажу в долг.
--    Эти данные меняют только функции приложения: продажа, погашение, возврат,
--    продление срока и отмена через историю действий.
-- 2. Возврат по продаже в долг: уже оплаченная часть возвращается тем же способом,
--    каким клиент платил (наличные / безнал), а не всегда наличными.
-- 3. Отмена продажи в долг через историю действий теперь снимает долг клиента.
--    Если по продаже уже были погашения, отмена запрещена — нужно оформить возврат.
-- 4. Возврат по отменённой (удалённой) продаже запрещён — раньше можно было
--    вернуть деньги второй раз.
--
-- ВАЖНО: если в будущем файл обновления снова пересоздаст функцию
-- commit_offline_sale через CREATE OR REPLACE, добавьте в неё SECURITY DEFINER
-- (или запустите этот файл ещё раз), иначе продажи в долг из офлайн-очереди
-- перестанут проходить.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Продажа выполняется с правами функции: у неё есть свои проверки магазина и
--    подтверждённого аккаунта, а долг клиента меняется только внутри неё.
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.commit_offline_sale(text, jsonb) SECURITY DEFINER;
REVOKE ALL ON FUNCTION public.commit_offline_sale(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commit_offline_sale(text, jsonb) TO authenticated;

-- Записи журнала долга создают только функции приложения.
DROP POLICY IF EXISTS "customer debt: shop insert" ON public.customer_debt_operations;
REVOKE INSERT, UPDATE, DELETE ON public.customer_debt_operations FROM authenticated, anon;

-- ---------------------------------------------------------------------------
-- 2. Запрет прямого изменения долга клиента.
--    Триггер НЕ security definer: current_user показывает, кто реально меняет
--    строку. Запрос из приложения напрямую = authenticated, функция приложения
--    (security definer) = её владелец.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_customer_debt_balance()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' AND coalesce(NEW.debt_balance, 0) <> 0 THEN
      RAISE EXCEPTION 'Долг клиента меняется только через продажу в долг или погашение'
        USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.debt_balance IS DISTINCT FROM OLD.debt_balance THEN
      RAISE EXCEPTION 'Долг клиента меняется только через продажу в долг или погашение'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS customers_guard_debt_balance ON public.customers;
CREATE TRIGGER customers_guard_debt_balance
  BEFORE INSERT OR UPDATE ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_customer_debt_balance();

-- ---------------------------------------------------------------------------
-- 3. Продажи в долг: запрет прямых изменений + снятие долга при отмене продажи.
--    Имя триггера идёт по алфавиту после sales_default_customer_credit_due_date,
--    поэтому проверка видит уже проставленный срок оплаты.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_sales_credit_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_untrusted boolean := current_user IN ('authenticated', 'anon');
  v_debt_before numeric(14,2);
  v_reduction numeric(14,2);
  v_actor uuid;
  v_author text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_untrusted
       AND (NEW.payment_method = 'credit' OR coalesce(NEW.credit_balance, 0) <> 0) THEN
      RAISE EXCEPTION 'Продажа в долг оформляется только через кассу приложения'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF v_untrusted AND (
       NEW.credit_balance IS DISTINCT FROM OLD.credit_balance
    OR NEW.credit_due_date IS DISTINCT FROM OLD.credit_due_date
    OR ((OLD.payment_method = 'credit' OR NEW.payment_method = 'credit')
        AND NEW.payment_method IS DISTINCT FROM OLD.payment_method)
    OR (OLD.payment_method = 'credit' AND (
             NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
          OR NEW.total IS DISTINCT FROM OLD.total
          OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
          OR NEW.items IS DISTINCT FROM OLD.items
          OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
          OR NEW.shop_id IS DISTINCT FROM OLD.shop_id))
  ) THEN
    RAISE EXCEPTION 'Продажу в долг можно изменить только через функции приложения (погашение, возврат, продление срока)'
      USING ERRCODE = '42501';
  END IF;

  -- Отмена продажи в долг (история действий ставит deleted_at).
  IF OLD.payment_method = 'credit'
     AND OLD.deleted_at IS NULL
     AND NEW.deleted_at IS NOT NULL THEN
    IF round(coalesce(OLD.credit_balance, 0), 2) < round(coalesce(OLD.total, 0), 2) THEN
      RAISE EXCEPTION 'По этой продаже в долг уже были погашения. Отменить её нельзя — оформите возврат товара.'
        USING ERRCODE = 'P0001';
    END IF;

    IF OLD.customer_id IS NOT NULL AND coalesce(OLD.credit_balance, 0) > 0 THEN
      SELECT coalesce(debt_balance, 0) INTO v_debt_before
        FROM public.customers
       WHERE id = OLD.customer_id AND shop_id = OLD.shop_id
       FOR UPDATE;

      IF FOUND THEN
        v_reduction := least(round(OLD.credit_balance, 2), v_debt_before);
        IF v_reduction > 0 THEN
          UPDATE public.customers
             SET debt_balance = round(v_debt_before - v_reduction, 2)
           WHERE id = OLD.customer_id AND shop_id = OLD.shop_id;

          v_actor := coalesce(auth.uid(), OLD.seller_id);
          SELECT full_name INTO v_author FROM public.profiles WHERE id = v_actor;

          INSERT INTO public.customer_debt_operations (
            shop_id, customer_id, sale_id, operation_type, amount,
            balance_before, balance_after, source, amount_cash, amount_electronic,
            reason, created_by, author_name
          ) VALUES (
            OLD.shop_id, OLD.customer_id, OLD.id, 'credit_return', v_reduction,
            v_debt_before, round(v_debt_before - v_reduction, 2), NULL, 0, 0,
            'Отмена продажи в долг #' || left(OLD.id::text, 8), v_actor, v_author
          );
        END IF;
      END IF;
    END IF;

    NEW.credit_balance := 0;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sales_guard_credit_fields ON public.sales;
CREATE TRIGGER sales_guard_credit_fields
  BEFORE INSERT OR UPDATE ON public.sales
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_sales_credit_fields();

REVOKE ALL ON FUNCTION public.guard_customer_debt_balance() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_sales_credit_fields() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Возврат товара. Изменения относительно 20261019:
--    • возврат по отменённой продаже запрещён;
--    • по продаже в долг оплаченная часть возвращается в той же пропорции
--      наличные/безнал, в какой клиент погашал долг после этой продажи.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.return_sale_item(_sale_id uuid, _item_index integer, _reason text DEFAULT NULL::text) RETURNS public.sale_returns
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
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
  v_paid_part   numeric(14,2) := 0;
  v_paid_cash   numeric := 0;
  v_paid_electronic numeric := 0;
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
  IF v_sale.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Продажа отменена — возврат по ней невозможен' USING errcode = 'P0001';
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
  -- возвращается из кассы. Кредитный возврат не создаёт фиктивный расход.
  IF v_sale.payment_method = 'credit' AND v_sale.customer_id IS NOT NULL THEN
    v_credit_due := greatest(0, coalesce(v_sale.credit_balance, 0));
    v_debt_reduction := least(v_amount, v_credit_due);
    IF v_debt_reduction > v_debt_before THEN
      RAISE EXCEPTION 'Остаток долга по продаже больше долга клиента' USING errcode = '23514';
    END IF;
    v_paid_part := v_amount - v_debt_reduction;

    IF v_paid_part > 0 THEN
      -- Как клиент платил по долгу после этой продажи (раньше она не могла быть оплачена).
      SELECT coalesce(sum(amount_cash), 0), coalesce(sum(amount_electronic), 0)
        INTO v_paid_cash, v_paid_electronic
        FROM public.customer_debt_operations
       WHERE shop_id = v_shop
         AND customer_id = v_sale.customer_id
         AND operation_type = 'payment'
         AND created_at >= v_sale.created_at;

      IF v_paid_cash + v_paid_electronic > 0 THEN
        v_cash := round(v_paid_part * v_paid_cash / (v_paid_cash + v_paid_electronic), 2);
        v_cash := least(greatest(v_cash, 0), v_paid_part);
      ELSE
        v_cash := v_paid_part;
      END IF;
      v_electronic := v_paid_part - v_cash;
    ELSE
      v_cash := 0;
      v_electronic := 0;
    END IF;
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

REVOKE ALL ON FUNCTION public.return_sale_item(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.return_sale_item(uuid, integer, text) TO authenticated;

COMMIT;
