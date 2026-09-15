-- =============================================================================
-- МИГРАЦИЯ v33_sale_returns.sql
-- Версия: 33
-- Описание: Возврат товара (refund) для кассового модуля Aura Gold CRM.
--
-- Модель:
--   1. Таблица public.sale_returns хранит каждую возвращённую позицию чека.
--   2. Функция public.return_sale_item(...) выполняет АТОМАРНО:
--        • изъятие денег из кассы (cash_operations.type = 'outcome');
--        • запись возврата (sale_returns);
--        • перевод товара обратно в статус 'in_stock' (себестоимость снова
--          учитывается на складе);
--        • пересчёт статистики клиента (total_spent / purchase_count).
--      Всё внутри одной транзакции plpgsql — частичного применения быть не может.
--   3. Сумма возврата считается по ФАКТИЧЕСКИ оплаченной цене позиции:
--      продажа хранит item.price уже со скидкой позиции, а общая скидка/бонусы
--      уменьшают sale.total, поэтому возврат пропорционален total / subtotal.
--   4. Повторная продажа возвращённого товара — обычный checkout: создаётся
--      новая продажа и новый денежный приход.
--
-- Пример денежного потока: продажа +100 → возврат −100 → повторная продажа +100
-- = итоговый поток +100.
--
-- Все числовые поля — NUMERIC(14,2), согласованы с sales / cash_operations.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Таблица возвратов
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sale_returns (
    id                uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_id           uuid NOT NULL,
    sale_id           uuid NOT NULL,
    product_id        uuid,
    item_index        integer NOT NULL,
    item_name         text NOT NULL,
    item_metal        text,
    item_weight       numeric(8,2) DEFAULT 0 NOT NULL,
    amount            numeric(14,2) DEFAULT 0 NOT NULL,
    cost              numeric(14,2) DEFAULT 0 NOT NULL,
    cash_operation_id uuid,
    reason            text DEFAULT ''::text NOT NULL,
    created_by        uuid NOT NULL,
    author_name       text,
    created_at        timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sale_returns_pkey PRIMARY KEY (id),
    CONSTRAINT sale_returns_item_index_check CHECK (item_index >= 0),
    CONSTRAINT sale_returns_amount_check      CHECK (amount >= 0),
    CONSTRAINT sale_returns_sale_id_fkey      FOREIGN KEY (sale_id) REFERENCES public.sales(id) ON DELETE CASCADE,
    CONSTRAINT sale_returns_product_id_fkey   FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL,
    CONSTRAINT sale_returns_created_by_fkey   FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT sale_returns_cash_op_fkey      FOREIGN KEY (cash_operation_id) REFERENCES public.cash_operations(id) ON DELETE SET NULL
);

-- Позицию чека можно вернуть ровно один раз.
CREATE UNIQUE INDEX IF NOT EXISTS sale_returns_sale_item_idx
  ON public.sale_returns (sale_id, item_index);

CREATE INDEX IF NOT EXISTS sale_returns_shop_created_idx
  ON public.sale_returns (shop_id, created_at DESC);

CREATE INDEX IF NOT EXISTS sale_returns_product_idx
  ON public.sale_returns (product_id) WHERE product_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Атомарная функция возврата позиции чека
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.return_sale_item(
  _sale_id    uuid,
  _item_index integer,
  _reason     text DEFAULT NULL
) RETURNS public.sale_returns
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

REVOKE ALL ON FUNCTION public.return_sale_item(uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.return_sale_item(uuid, integer, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.sale_returns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sale_returns: shop read"   ON public.sale_returns;
DROP POLICY IF EXISTS "sale_returns: shop insert" ON public.sale_returns;
DROP POLICY IF EXISTS "sale_returns: admin delete" ON public.sale_returns;

CREATE POLICY "sale_returns: shop read" ON public.sale_returns
  FOR SELECT TO authenticated
  USING (public.is_approved() AND shop_id = public.current_shop_id());

CREATE POLICY "sale_returns: shop insert" ON public.sale_returns
  FOR INSERT TO authenticated
  WITH CHECK (public.is_approved() AND shop_id = public.current_shop_id());

CREATE POLICY "sale_returns: admin delete" ON public.sale_returns
  FOR DELETE TO authenticated
  USING (public.is_shop_admin() AND shop_id = public.current_shop_id());

GRANT SELECT, INSERT, DELETE ON public.sale_returns TO authenticated;
GRANT ALL ON public.sale_returns TO service_role;

COMMIT;

-- =============================================================================
-- ИТОГ
-- =============================================================================
-- Таблиц создано:       1  (sale_returns)
-- Функций создано:      1  (return_sale_item — атомарный возврат)
-- Индексов создано:     3  (уникальный sale+item, shop+created, product)
-- Политик RLS создано:  3  (read / insert / admin delete)
-- =============================================================================
