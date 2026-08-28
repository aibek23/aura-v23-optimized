-- =============================================================================
-- МИГРАЦИЯ v22_notifications.sql
-- Версия: 22
-- Описание: Система уведомлений для суперадмина
--
-- Новые возможности:
--   1. Таблица superadmin_notifications — хранит уведомления для супер-админа.
--   2. Триггерная функция notify_pending_profile() — при переходе профиля в
--      статус 'pending' (или при создании нового pending-профиля) автоматически
--      создаёт запись в superadmin_notifications.
--   3. RPC superadmin_get_notifications(_limit, _offset) — постраничная
--      выборка уведомлений (только для super_admin).
--   4. RPC superadmin_mark_notification_read(_notification_id) — пометить
--      одно уведомление как прочитанное.
--   5. RPC superadmin_mark_all_notifications_read() — пометить все как
--      прочитанные.
--   6. RPC superadmin_get_unread_count() — быстрый счётчик непрочитанных.
--   7. Supabase Realtime публикация таблицы для live-обновлений.
--
-- Нулевой ломающий эффект:
--   • Все существующие таблицы и политики сохранены.
--   • Новые объекты создаются через CREATE OR REPLACE / IF NOT EXISTS.
--   • Фронтенд получает готовые RPC + Realtime-подписку.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Таблица уведомлений
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.superadmin_notifications (
  id           uuid    DEFAULT gen_random_uuid() NOT NULL,
  kind         text    NOT NULL,           -- тип события: 'pending_request', ...
  profile_id   uuid    NOT NULL,           -- кого касается уведомление
  shop_id      uuid,                       -- магазин (может быть NULL у первого pending)
  full_name    text,                       -- ФИО из профиля (денормализовано)
  shop_name    text,                       -- название магазина (денормализовано)
  requested_role text,                     -- запрошенная роль
  is_read      boolean DEFAULT false NOT NULL,
  is_processed boolean DEFAULT false NOT NULL, -- true после подтверждения/отклонения
  created_at   timestamptz DEFAULT now()   NOT NULL,

  CONSTRAINT superadmin_notifications_pkey PRIMARY KEY (id),
  CONSTRAINT superadmin_notifications_kind_check CHECK (
    kind IN ('pending_request')
  )
);

-- Индексы для быстрой выборки непрочитанных и по дате
CREATE INDEX IF NOT EXISTS sn_unread_idx
  ON public.superadmin_notifications (is_read, created_at DESC)
  WHERE is_read = false;

CREATE INDEX IF NOT EXISTS sn_created_idx
  ON public.superadmin_notifications (created_at DESC);

-- Уникальность: один pending = одно активное (не обработанное) уведомление
CREATE UNIQUE INDEX IF NOT EXISTS sn_profile_active_idx
  ON public.superadmin_notifications (profile_id)
  WHERE is_processed = false;

-- ---------------------------------------------------------------------------
-- 2. RLS — только super_admin имеет доступ к таблице
-- ---------------------------------------------------------------------------

ALTER TABLE public.superadmin_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "superadmin_notifications: super_admin all" ON public.superadmin_notifications;
CREATE POLICY "superadmin_notifications: super_admin all"
  ON public.superadmin_notifications
  FOR ALL
  TO authenticated
  USING  (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 3. Realtime — разрешить подписку на таблицу
-- ---------------------------------------------------------------------------

ALTER PUBLICATION supabase_realtime ADD TABLE public.superadmin_notifications;

-- ---------------------------------------------------------------------------
-- 4. Триггерная функция: создаёт уведомление при pending-профиле
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_pending_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Срабатывает только при переходе В статус pending
  IF NEW.status = 'pending' AND (TG_OP = 'INSERT' OR OLD.status <> 'pending') THEN
    -- Используем INSERT ... ON CONFLICT DO NOTHING (идемпотентность через уник. индекс)
    INSERT INTO public.superadmin_notifications
      (kind, profile_id, shop_id, full_name, shop_name, requested_role)
    VALUES (
      'pending_request',
      NEW.id,
      NEW.shop_id,
      NEW.full_name,
      NEW.shop_name,
      NEW.requested_role
    )
    ON CONFLICT (profile_id) WHERE is_processed = false DO NOTHING;
  END IF;

  -- При подтверждении или отклонении — помечаем уведомление как обработанное
  IF TG_OP = 'UPDATE' AND OLD.status = 'pending'
     AND NEW.status IN ('approved', 'rejected') THEN
    UPDATE public.superadmin_notifications
    SET is_processed = true,
        is_read      = true
    WHERE profile_id  = NEW.id
      AND is_processed = false;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Триггер на таблицу profiles
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_notify_pending_profile ON public.profiles;

CREATE TRIGGER trg_notify_pending_profile
  AFTER INSERT OR UPDATE OF status
  ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_pending_profile();

-- ---------------------------------------------------------------------------
-- 6. RPC: получить уведомления (только super_admin)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.superadmin_get_notifications(
  _limit  integer DEFAULT 50,
  _offset integer DEFAULT 0
) RETURNS TABLE (
  id             uuid,
  kind           text,
  profile_id     uuid,
  shop_id        uuid,
  full_name      text,
  shop_name      text,
  requested_role text,
  is_read        boolean,
  is_processed   boolean,
  created_at     timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    id, kind, profile_id, shop_id, full_name, shop_name,
    requested_role, is_read, is_processed, created_at
  FROM public.superadmin_notifications
  WHERE public.is_super_admin()
  ORDER BY created_at DESC
  LIMIT  _limit
  OFFSET _offset;
$$;

-- ---------------------------------------------------------------------------
-- 7. RPC: количество непрочитанных (только super_admin)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.superadmin_get_unread_count()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COUNT(*)
  FROM public.superadmin_notifications
  WHERE public.is_super_admin()
    AND is_read = false;
$$;

-- ---------------------------------------------------------------------------
-- 8. RPC: пометить одно уведомление прочитанным (только super_admin)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.superadmin_mark_notification_read(
  _notification_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden: requires super_admin role'
      USING errcode = '42501';
  END IF;

  UPDATE public.superadmin_notifications
  SET is_read = true
  WHERE id = _notification_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Notification not found: %', _notification_id
      USING errcode = 'P0002';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. RPC: пометить ВСЕ уведомления прочитанными (только super_admin)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.superadmin_mark_all_notifications_read()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden: requires super_admin role'
      USING errcode = '42501';
  END IF;

  UPDATE public.superadmin_notifications
  SET is_read = true
  WHERE is_read = false;
END;
$$;

-- ---------------------------------------------------------------------------
-- 10. Ретроспектива: создать уведомления для уже существующих pending-профилей
--     (чтобы при первом запуске v22 в колоколе сразу появились старые заявки)
-- ---------------------------------------------------------------------------

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
ON CONFLICT (profile_id) WHERE is_processed = false DO NOTHING;

-- ---------------------------------------------------------------------------
-- Права доступа (Data API): таблица читается только супер-админом через RLS
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.superadmin_notifications TO authenticated;
GRANT ALL ON public.superadmin_notifications TO service_role;

GRANT EXECUTE ON FUNCTION public.superadmin_get_notifications(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.superadmin_get_unread_count() TO authenticated;
GRANT EXECUTE ON FUNCTION public.superadmin_mark_notification_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.superadmin_mark_all_notifications_read() TO authenticated;

COMMIT;

-- =============================================================================
-- ОТЧЁТ ОБ ИЗМЕНЕНИЯХ v22
-- =============================================================================
-- Таблицы добавлены:        1
--   • superadmin_notifications
-- Функции добавлены:        6
--   • notify_pending_profile()                       — триггер
--   • superadmin_get_notifications(_limit, _offset)  — RPC список
--   • superadmin_get_unread_count()                  — RPC счётчик
--   • superadmin_mark_notification_read(_id)         — RPC прочитано
--   • superadmin_mark_all_notifications_read()       — RPC все прочитаны
-- Триггеры добавлены:       1
--   • trg_notify_pending_profile ON profiles AFTER INSERT OR UPDATE OF status
-- Realtime:                 включён для superadmin_notifications
-- Ретроспектива:            pending-профили конвертированы в уведомления
-- =============================================================================
