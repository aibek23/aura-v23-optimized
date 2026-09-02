-- ===========================================================================
-- v24: Заморозка / разморозка магазина одной операцией
-- ---------------------------------------------------------------------------
-- Проблема: разморозка выполнялась через superadmin_update_shop_billing и
-- оставляла subscription_status = 'frozen', поэтому магазин продолжал
-- считаться замороженным (бейдж «Заморожен», блокировки биллинга).
--
-- Решение: отдельная security-definer функция superadmin_set_shop_frozen,
-- которая атомарно переключает флаг и корректно восстанавливает статус
-- подписки при разморозке:
--   paid_until IS NULL           -> 'trial'
--   paid_until >= сегодня        -> 'active'
--   paid_until <  сегодня        -> 'past_due'
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.superadmin_set_shop_frozen(
  _shop_id uuid,
  _frozen  boolean
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
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

REVOKE ALL ON FUNCTION public.superadmin_set_shop_frozen(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.superadmin_set_shop_frozen(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.superadmin_set_shop_frozen(uuid, boolean) TO service_role;

COMMENT ON FUNCTION public.superadmin_set_shop_frozen(uuid, boolean) IS
  'Суперадмин: заморозить (true) или разморозить (false) магазин с корректным восстановлением subscription_status.';
