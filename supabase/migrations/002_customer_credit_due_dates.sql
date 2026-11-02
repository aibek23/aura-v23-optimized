-- Срок оплаты по каждой кредитной продаже, отображение просрочки и продление срока.
BEGIN;

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS credit_due_date date;

-- Для уже существующих неоплаченных продаж отсчёт срока начинается с даты продажи.
UPDATE public.sales
   SET credit_due_date = created_at::date + 30
 WHERE payment_method = 'credit'
   AND coalesce(credit_balance, 0) > 0
   AND credit_due_date IS NULL;

CREATE INDEX IF NOT EXISTS sales_open_credit_due_date_idx
  ON public.sales (shop_id, customer_id, credit_due_date)
  WHERE payment_method = 'credit' AND credit_balance > 0 AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.set_default_customer_credit_due_date()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.payment_method = 'credit' THEN
    NEW.credit_due_date := coalesce(NEW.credit_due_date, CURRENT_DATE + 30);
  ELSE
    NEW.credit_due_date := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sales_default_customer_credit_due_date ON public.sales;
CREATE TRIGGER sales_default_customer_credit_due_date
  BEFORE INSERT OR UPDATE OF payment_method, credit_due_date ON public.sales
  FOR EACH ROW
  EXECUTE FUNCTION public.set_default_customer_credit_due_date();

-- Оборачиваем существующий атомарный checkout: продажа и выбранный срок
-- фиксируются одной транзакцией, а повторный client_op_id не меняет срок.
CREATE OR REPLACE FUNCTION public.commit_offline_credit_sale(
  _client_op_id text,
  _sale jsonb,
  _due_date date
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_result jsonb;
  v_sale_id uuid;
  v_shop_id uuid := public.current_shop_id();
BEGIN
  IF coalesce(_sale->>'payment_method', '') <> 'credit' THEN
    RAISE EXCEPTION 'Функция предназначена только для продажи в долг' USING ERRCODE = '22023';
  END IF;
  IF _due_date IS NULL OR _due_date < CURRENT_DATE THEN
    RAISE EXCEPTION 'Срок оплаты не может быть в прошлом' USING ERRCODE = '22023';
  END IF;

  v_result := public.commit_offline_sale(_client_op_id, _sale);

  IF v_result->>'accepted' = 'true'
     AND coalesce((v_result->>'duplicate')::boolean, false) = false THEN
    v_sale_id := nullif(v_result->>'sale_id', '')::uuid;
    UPDATE public.sales
       SET credit_due_date = _due_date
     WHERE id = v_sale_id
       AND shop_id = v_shop_id
       AND payment_method = 'credit'
       AND deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Не удалось сохранить срок оплаты по продаже' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.extend_customer_credit_due_date(
  _sale_id uuid,
  _due_date date
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_shop_id uuid := public.current_shop_id();
  v_profile_status text;
BEGIN
  IF v_user_id IS NULL OR v_shop_id IS NULL THEN
    RAISE EXCEPTION 'Требуется авторизация и выбранный магазин' USING ERRCODE = '42501';
  END IF;

  SELECT status::text INTO v_profile_status
    FROM public.profiles
   WHERE id = v_user_id;
  IF v_profile_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'Аккаунт не подтверждён' USING ERRCODE = '42501';
  END IF;
  IF _due_date IS NULL OR _due_date < CURRENT_DATE THEN
    RAISE EXCEPTION 'Новая дата оплаты не может быть в прошлом' USING ERRCODE = '22023';
  END IF;

  UPDATE public.sales
     SET credit_due_date = _due_date
   WHERE id = _sale_id
     AND shop_id = v_shop_id
     AND payment_method = 'credit'
     AND credit_balance > 0
     AND deleted_at IS NULL
     AND credit_due_date < _due_date;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Выберите неоплаченную продажу и дату позже текущего срока' USING ERRCODE = '22023';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.commit_offline_credit_sale(text, jsonb, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commit_offline_credit_sale(text, jsonb, date) TO authenticated;
REVOKE ALL ON FUNCTION public.extend_customer_credit_due_date(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.extend_customer_credit_due_date(uuid, date) TO authenticated;

COMMIT;
