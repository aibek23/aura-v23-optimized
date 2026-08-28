-- =============================================================================
-- МИГРАЦИЯ v21_db_optimization.sql
-- Версия: 21
-- Описание: Права супер-администратора — одобрение заявок из любого магазина
--
-- Проблема (v20):
--   approveRequest / rejectRequest в cabinet.ts фильтровали UPDATE по
--   .eq("shop_id", profile.shop_id), т.е. супер-админ мог одобрять заявки
--   ТОЛЬКО из собственного магазина. Заявки из других магазинов были недоступны.
--
-- Решение (v21):
--   1. Добавлены две SECURITY DEFINER-функции:
--      • superadmin_approve_request(_profile_id, _role)
--      • superadmin_reject_request(_profile_id)
--      Функции сами проверяют роль вызывающего (is_super_admin()) и обновляют
--      profiles БЕЗ ограничения по shop_id — любой pending-профиль, из
--      любого магазина.
--
--   2. Добавлена RLS-политика "profiles: super_admin manages all" —
--      разрешает UPDATE по таблице profiles для super_admin без ограничения
--      по shop_id. Это необходимо, чтобы прямые UPDATE (вне SECURITY DEFINER)
--      тоже проходили.
--
-- Нулевой ломающий эффект:
--   • Существующие политики не удаляются, добавляется только новая.
--   • Функции создаются через CREATE OR REPLACE — безопасно при повторном запуске.
--   • Фронтенд: cabinet.ts переключён на вызов RPC вместо прямого UPDATE,
--     что совместимо со всеми существующими экранами.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. RLS-политика: супер-админ может обновлять любой профиль (любой магазин)
-- ---------------------------------------------------------------------------

-- Удаляем если уже существует (идемпотентность)
DROP POLICY IF EXISTS "profiles: super_admin manages all" ON public.profiles;

CREATE POLICY "profiles: super_admin manages all"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING  (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 2. RLS-политика: супер-админ может читать профили из ВСЕХ магазинов
--    (нужно для getCabinetData — выборка pending из всех магазинов)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "profiles: super_admin reads all" ON public.profiles;

CREATE POLICY "profiles: super_admin reads all"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 3. Функция: одобрить заявку (любой магазин) — только для super_admin
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.superadmin_approve_request(
  _profile_id uuid,
  _role       text          -- 'admin' | 'seller'
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  -- Проверка прав
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden: requires super_admin role'
      USING errcode = '42501';
  END IF;

  -- Валидация роли
  IF _role NOT IN ('admin', 'seller') THEN
    RAISE EXCEPTION 'Недопустимая роль: %. Допустимы: admin, seller', _role
      USING errcode = '22023';
  END IF;

  -- Проверить, что заявка существует и находится в состоянии pending
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = _profile_id AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'Заявка не найдена или уже обработана (id: %)', _profile_id
      USING errcode = 'P0002';
  END IF;

  -- Одобрить заявку — БЕЗ ограничения по shop_id
  UPDATE public.profiles
  SET
    status     = 'approved',
    role       = _role::public.app_role,
    manager_id = NULL   -- супер-админ не привязывает продавца к конкретному менеджеру
  WHERE id = _profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Профиль не найден: %', _profile_id
      USING errcode = 'P0002';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Функция: отклонить заявку (любой магазин) — только для super_admin
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.superadmin_reject_request(
  _profile_id uuid
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  -- Проверка прав
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden: requires super_admin role'
      USING errcode = '42501';
  END IF;

  -- Проверить, что заявка существует и находится в состоянии pending
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = _profile_id AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'Заявка не найдена или уже обработана (id: %)', _profile_id
      USING errcode = 'P0002';
  END IF;

  -- Отклонить — БЕЗ ограничения по shop_id
  UPDATE public.profiles
  SET
    status = 'rejected',
    role   = NULL
  WHERE id = _profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Профиль не найден: %', _profile_id
      USING errcode = 'P0002';
  END IF;
END;
$$;

COMMIT;

-- =============================================================================
-- ОТЧЁТ ОБ ИЗМЕНЕНИЯХ v21
-- =============================================================================
-- RLS-политики добавлены:   2
--   • "profiles: super_admin manages all" — UPDATE любого профиля
--   • "profiles: super_admin reads all"   — SELECT всех профилей
-- Функции добавлены:        2
--   • superadmin_approve_request(_profile_id, _role)
--   • superadmin_reject_request(_profile_id)
-- Фронтенд изменён:
--   • app/actions/cabinet.ts:
--     - getCabinetData: super_admin запрашивает pending без фильтра по shop_id
--     - approveRequest: вызывает RPC superadmin_approve_request
--     - rejectRequest:  вызывает RPC superadmin_reject_request
-- Нулевой ломающий эффект:  все существующие политики и функции сохранены
-- =============================================================================
