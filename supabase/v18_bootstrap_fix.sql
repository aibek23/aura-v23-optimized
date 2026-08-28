-- ============================================================================
-- AURA v18 — Патч: Уведомления суперадмина + правильный триггер регистрации
-- Запускать ОДИН РАЗ после supabase.sql (или поверх любой v22/v23 базы).
--
-- ПОЛИТИКА: Любой пользователь (включая основателя магазина) должен быть
-- подтверждён суперадмином. Авто-подтверждение НЕ применяется ни для кого.
-- Суперадмин получает уведомление о каждой новой заявке.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Исправляем функцию handle_new_user():
--    Все пользователи (включая основателей) регистрируются со status='pending'.
--    shop_settings создаётся сразу при регистрации нового магазина.
--    Авто-подтверждение убрано полностью.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_shop_name text := nullif(new.raw_user_meta_data ->> 'shop_name', '');
  v_shop_id   uuid;
  v_is_new_shop boolean := false;
BEGIN
  -- Ищем существующий магазин по имени
  SELECT shop_id INTO v_shop_id
  FROM public.profiles
  WHERE shop_name IS NOT DISTINCT FROM v_shop_name
    AND shop_id IS NOT NULL
  LIMIT 1;

  -- Если магазин не нашли — создаём новый
  IF v_shop_id IS NULL THEN
    v_shop_id     := gen_random_uuid();
    v_is_new_shop := true;
  END IF;

  -- Все пользователи всегда pending — суперадмин подтверждает вручную
  INSERT INTO public.profiles (
    id, full_name, shop_name, shop_id, phone, requested_role, email,
    status, role
  )
  VALUES (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    v_shop_name,
    v_shop_id,
    new.raw_user_meta_data ->> 'phone',
    new.raw_user_meta_data ->> 'requested_role',
    new.email,
    'pending'::public.profile_status,
    NULL
  )
  ON CONFLICT (id) DO NOTHING;

  -- Создаём запись в shop_settings для нового магазина
  IF v_is_new_shop THEN
    INSERT INTO public.shop_settings (shop_id, shop_name)
    VALUES (v_shop_id, v_shop_name)
    ON CONFLICT (shop_id) DO NOTHING;
  END IF;

  RETURN new;
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. Убеждаемся, что для каждого магазина существует запись shop_settings.
--    (Защита от случаев, когда shop_settings не была создана триггером.)
-- ----------------------------------------------------------------------------
INSERT INTO public.shop_settings (shop_id, shop_name)
SELECT DISTINCT p.shop_id, p.shop_name
FROM public.profiles p
WHERE p.shop_id IS NOT NULL
ON CONFLICT (shop_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3. GRANT — убеждаемся, что anon/authenticated могут читать shop_settings
--    для публичной витрины (уже должно быть в supabase.sql, но на всякий случай).
-- ----------------------------------------------------------------------------
GRANT SELECT ON public.shop_settings TO anon, authenticated;
GRANT SELECT ON public.profiles       TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. Уведомления: помечаем обработанными все pending_request для только что
--    подтверждённых пользователей (чтобы колокольчик не показывал устаревшие).
-- ----------------------------------------------------------------------------
UPDATE public.superadmin_notifications sn
SET    is_processed = true,
       is_read      = true
WHERE  sn.kind          = 'pending_request'
  AND  sn.is_processed  = false
  AND  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id     = sn.profile_id
      AND p.status = 'approved'
  );

-- ----------------------------------------------------------------------------
-- 5. Realtime: убеждаемся что таблица уведомлений опубликована.
--    Это необходимо для работы live-колокольчика у суперадмина.
--    Безопасно запускать повторно — IF NOT EXISTS защищает от ошибки.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_publication_tables
    WHERE  pubname   = 'supabase_realtime'
      AND  schemaname = 'public'
      AND  tablename  = 'superadmin_notifications'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.superadmin_notifications';
    RAISE NOTICE 'v18: superadmin_notifications добавлена в supabase_realtime';
  ELSE
    RAISE NOTICE 'v18: superadmin_notifications уже в supabase_realtime, пропускаем';
  END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. Исправляем notify_pending_profile(): всегда создаёт/обновляет уведомление
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_pending_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Срабатывает только при переходе В статус pending
  IF NEW.status = 'pending' AND (TG_OP = 'INSERT' OR OLD.status <> 'pending') THEN
    -- Сначала снимаем флаг is_processed со старых уведомлений этого профиля,
    -- чтобы уведомление снова появилось у суперадмина
    UPDATE public.superadmin_notifications
    SET    is_processed = false,
           is_read      = false,
           full_name      = NEW.full_name,
           shop_name      = NEW.shop_name,
           requested_role = NEW.requested_role
    WHERE  profile_id   = NEW.id
      AND  kind         = 'pending_request';

    -- Если записи не было — создаём новую
    IF NOT FOUND THEN
      INSERT INTO public.superadmin_notifications
        (kind, profile_id, shop_id, full_name, shop_name, requested_role)
      VALUES (
        'pending_request',
        NEW.id,
        NEW.shop_id,
        NEW.full_name,
        NEW.shop_name,
        NEW.requested_role
      );
    END IF;
  END IF;

  -- При подтверждении или отклонении — помечаем уведомление обработанным
  IF TG_OP = 'UPDATE' AND OLD.status = 'pending'
     AND NEW.status IN ('approved', 'rejected') THEN
    UPDATE public.superadmin_notifications
    SET    is_processed = true,
           is_read      = true
    WHERE  profile_id   = NEW.id
      AND  kind         = 'pending_request'
      AND  is_processed = false;
  END IF;

  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. Ретроспектива: создаём уведомления для текущих pending-пользователей
--    которые зарегистрировались после v18 и ещё не имеют уведомлений.
-- ----------------------------------------------------------------------------
INSERT INTO public.superadmin_notifications
  (kind, profile_id, shop_id, full_name, shop_name, requested_role)
SELECT
  'pending_request',
  p.id,
  p.shop_id,
  p.full_name,
  p.shop_name,
  p.requested_role
FROM public.profiles p
WHERE p.status = 'pending'
  AND NOT EXISTS (
    SELECT 1 FROM public.superadmin_notifications sn
    WHERE  sn.profile_id   = p.id
      AND  sn.kind         = 'pending_request'
      AND  sn.is_processed = false
  );
