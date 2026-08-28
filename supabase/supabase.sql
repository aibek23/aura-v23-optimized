-- ============================================================================
-- AURA GOLD CRM — ПОЛНАЯ СХЕМА БАЗЫ ДАННЫХ (v23)
-- Включает все изменения v20, v21, v22.
-- Этот файл — единственный файл для развёртывания в новом проекте.
-- ============================================================================

-- ============================================================================
-- 1. СХЕМЫ И ТИПЫ ДАННЫХ
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS public;

CREATE TYPE public.app_role AS ENUM (
    'seller',
    'admin',
    'super_admin'
);

CREATE TYPE public.cash_op_type AS ENUM (
    'income',
    'outcome',
    'collection'
);

CREATE TYPE public.product_status AS ENUM (
    'in_stock',
    'reserved',
    'sold',
    'archived',
    'draft'
);

CREATE TYPE public.profile_status AS ENUM (
    'pending',
    'approved',
    'rejected'
);

-- ============================================================================
-- 2. СОЗДАНИЕ ТАБЛИЦ
-- ============================================================================

-- Настройки магазина (биллинг, подписка, бонусы)
CREATE TABLE IF NOT EXISTS public.shop_settings (
    shop_id uuid NOT NULL,
    shop_name text,
    default_bonus_rate numeric(5,2) DEFAULT 2 NOT NULL,
    public_enabled boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    paid_until date,
    subscription_status text DEFAULT 'trial'::text NOT NULL,
    auto_block boolean DEFAULT true NOT NULL,
    is_frozen boolean DEFAULT false NOT NULL,
    frozen_at timestamp with time zone,
    frozen_by uuid,
    notes text,
    CONSTRAINT shop_settings_subscription_status_check CHECK ((subscription_status = ANY (ARRAY['trial'::text, 'active'::text, 'past_due'::text, 'frozen'::text, 'cancelled'::text])))
);

-- Профили сотрудников (привязаны к auth.users)
-- v20: bonus_points → NUMERIC(10,2), bonus_rate → NUMERIC(5,2)
CREATE TABLE IF NOT EXISTS public.profiles (
    id uuid NOT NULL,
    full_name text,
    shop_name text,
    shop_id uuid,
    phone text,
    requested_role text,
    role public.app_role,
    status public.profile_status DEFAULT 'pending'::public.profile_status NOT NULL,
    bonus_points numeric(10,2) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    bonus_rate numeric(5,2),
    manager_id uuid,
    last_seen_at timestamp with time zone,
    email text,
    impersonated_shop_id uuid
);

-- Кассовые операции (приход / расход / инкассация)
-- v20: amount/amount_cash/amount_electronic → NUMERIC(14,2)
CREATE TABLE IF NOT EXISTS public.cash_operations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_id uuid NOT NULL,
    created_by uuid NOT NULL,
    author_name text,
    type public.cash_op_type NOT NULL,
    amount numeric(14,2) DEFAULT 0 NOT NULL,
    reason text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    source text DEFAULT 'cash'::text NOT NULL,
    amount_cash numeric(14,2),
    amount_electronic numeric(14,2),
    CONSTRAINT cash_operations_source_check CHECK ((source = ANY (ARRAY['cash'::text, 'electronic'::text, 'mixed'::text]))),
    CONSTRAINT cash_operations_type_check CHECK ((type = ANY (ARRAY['income'::public.cash_op_type, 'outcome'::public.cash_op_type, 'collection'::public.cash_op_type])))
);

-- Шаблоны причин кассовых операций
CREATE TABLE IF NOT EXISTS public.cash_reason_presets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_id uuid NOT NULL,
    created_by uuid NOT NULL,
    text text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Клиенты магазина (CRM)
-- v20: bonus_points → INTEGER, total_spent → NUMERIC(14,2)
CREATE TABLE IF NOT EXISTS public.customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_id uuid NOT NULL,
    name text,
    phone text,
    bonus_points integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    gender text,
    whatsapp text,
    instagram text,
    email text,
    is_blacklisted boolean DEFAULT false NOT NULL,
    purchase_count integer DEFAULT 0 NOT NULL,
    total_spent numeric(14,2) DEFAULT 0 NOT NULL,
    last_purchase_at timestamp with time zone,
    CONSTRAINT customers_gender_check CHECK ((gender = ANY (ARRAY['female'::text, 'male'::text, 'other'::text])))
);

-- Курсы металлов
-- v20: price_per_gram/scrap_price_per_gram → NUMERIC(10,2)
CREATE TABLE IF NOT EXISTS public.metal_rates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_id uuid NOT NULL,
    metal text NOT NULL,
    price_per_gram numeric(10,2) DEFAULT 0 NOT NULL,
    scrap_price_per_gram numeric(10,2) DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Товары на складе
-- v20: удалено is_secondary; переименованы purchase_price_seller →
--      purchase_price_visible, price_per_gram_purchase_seller →
--      price_per_gram_purchase_visible; числа → NUMERIC(n,d)
CREATE TABLE IF NOT EXISTS public.products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_id uuid NOT NULL,
    created_by uuid NOT NULL,
    name text NOT NULL,
    category text,
    metal text,
    purity text,
    weight numeric(8,2) DEFAULT 0 NOT NULL,
    size text,
    sku text,
    quantity integer DEFAULT 1 NOT NULL,
    purchase_price numeric(12,2) DEFAULT 0 NOT NULL,
    sale_price numeric(12,2) DEFAULT 0 NOT NULL,
    image_url text,
    status public.product_status DEFAULT 'in_stock'::public.product_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    metal_color text,
    purchase_price_visible numeric(12,2),
    price_per_gram_sale numeric(10,2),
    price_per_gram_purchase numeric(10,2),
    stones text,
    description text,
    images text[] DEFAULT '{}'::text[] NOT NULL,
    supplier_name text,
    supplier_phone text,
    article_prefix text,
    article_seq integer,
    price_per_gram_purchase_visible numeric(10,2),
    is_hidden boolean DEFAULT false,
    CONSTRAINT products_article_seq_range CHECK (((article_seq IS NULL) OR ((article_seq >= 1) AND (article_seq <= 99999))))
);

-- Продажи
-- v20: все суммовые поля → NUMERIC(14,2)
CREATE TABLE IF NOT EXISTS public.sales (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_id uuid NOT NULL,
    seller_id uuid NOT NULL,
    seller_name text,
    customer_id uuid,
    customer_name text,
    customer_phone text,
    payment_method text DEFAULT 'cash'::text NOT NULL,
    subtotal numeric(14,2) DEFAULT 0 NOT NULL,
    discount numeric(14,2) DEFAULT 0 NOT NULL,
    total numeric(14,2) DEFAULT 0 NOT NULL,
    cost_total numeric(14,2) DEFAULT 0 NOT NULL,
    profit numeric(14,2) DEFAULT 0 NOT NULL,
    bonus_earned numeric(14,2) DEFAULT 0 NOT NULL,
    bonus_used numeric(14,2) DEFAULT 0 NOT NULL,
    items jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    amount_cash numeric(14,2),
    amount_electronic numeric(14,2)
);

-- v22: Уведомления суперадмина (заявки на регистрацию и т.д.)
CREATE TABLE IF NOT EXISTS public.superadmin_notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text NOT NULL,
    profile_id uuid NOT NULL,
    shop_id uuid,
    full_name text,
    shop_name text,
    requested_role text,
    is_read boolean DEFAULT false NOT NULL,
    is_processed boolean DEFAULT false NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT superadmin_notifications_pkey PRIMARY KEY (id),
    CONSTRAINT superadmin_notifications_kind_check CHECK (kind IN ('pending_request'))
);

-- ============================================================================
-- 3. ПОЛЬЗОВАТЕЛЬСКИЕ ФУНКЦИИ
-- ============================================================================
CREATE OR REPLACE FUNCTION public.add_bonus_points(_amount numeric) RETURNS numeric
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_total numeric;
begin
  if not public.is_approved() then
    raise exception 'Аккаунт не подтверждён' using errcode = '42501';
  end if;
  if _amount is null or _amount < 0 then
    raise exception 'Некорректное количество бонусов' using errcode = '22023';
  end if;
  update public.profiles
     set bonus_points = coalesce(bonus_points,0) + _amount
   where id = auth.uid()
  returning bonus_points into v_total;
  return coalesce(v_total, 0);
end $$;

-- v22: триггерная функция — создаёт уведомление при переходе профиля в pending
CREATE OR REPLACE FUNCTION public.notify_pending_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Срабатывает только при переходе В статус pending
  IF NEW.status = 'pending' AND (TG_OP = 'INSERT' OR OLD.status <> 'pending') THEN
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

  -- При подтверждении или отклонении — помечаем уведомление обработанным
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

CREATE OR REPLACE FUNCTION public.compose_article(p_prefix text, p_seq integer) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  select case
    when p_prefix is null or p_seq is null then null
    else upper(p_prefix) || lpad(p_seq::text, 5, '0')
  end
$$;

CREATE OR REPLACE FUNCTION public.current_shop_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT COALESCE(
    (SELECT impersonated_shop_id FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin'),
    (SELECT shop_id FROM public.profiles WHERE id = auth.uid())
  )
$$;

CREATE OR REPLACE FUNCTION public.guard_profile_privileges() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if public.is_shop_admin() then
    return new;
  end if;
  if old.status = 'pending' and not exists (
    select 1 from public.profiles
    where shop_id = old.shop_id and status = 'approved' and id <> old.id
  ) then
    return new;
  end if;
  new.role         := old.role;
  new.status       := old.status;
  new.shop_id      := old.shop_id;
  new.bonus_points := old.bonus_points;
  return new;
end $$;

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_shop_name text := nullif(new.raw_user_meta_data ->> 'shop_name', '');
  v_shop_id   uuid;
begin
  select shop_id into v_shop_id
  from public.profiles
  where shop_name is not distinct from v_shop_name and shop_id is not null
  limit 1;

  insert into public.profiles (id, full_name, shop_name, shop_id, phone, requested_role, email, status)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    v_shop_name,
    coalesce(v_shop_id, gen_random_uuid()),
    new.raw_user_meta_data ->> 'phone',
    new.raw_user_meta_data ->> 'requested_role',
    new.email,
    'pending'
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- v20: increment_customer_stats работает с INTEGER purchase_count
CREATE OR REPLACE FUNCTION public.increment_customer_stats(_customer_id uuid, _amount numeric) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  UPDATE public.customers
  SET
    purchase_count   = purchase_count + 1,
    total_spent      = total_spent + _amount,
    last_purchase_at = now()
  WHERE id = _customer_id;
$$;

CREATE OR REPLACE FUNCTION public.is_approved() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'approved')
$$;

CREATE OR REPLACE FUNCTION public.is_shop_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and status = 'approved'
                   and role in ('admin','super_admin'))
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'super_admin'
      AND status = 'approved'
  )
$$;

CREATE OR REPLACE FUNCTION public.next_article(p_prefix text) RETURNS TABLE(out_article text, out_prefix text, out_seq integer, out_reused boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_shop   uuid := public.current_shop_id();
  v_prefix text := upper(btrim(coalesce(p_prefix, '')));
  v_seq    integer;
  v_reused boolean := false;
begin
  if not public.is_approved() then
    raise exception 'Аккаунт не подтверждён' using errcode = '42501';
  end if;
  if v_shop is null then
    raise exception 'У профиля не задан магазин' using errcode = '42501';
  end if;
  if v_prefix !~ '^[А-ЯЁ]{2}$' then
    raise exception 'Некорректный префикс артикула: %', p_prefix using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_shop::text || v_prefix, 0));

  select s into v_seq
  from generate_series(1, 99999) as s
  where not exists (
    select 1 from public.products p
    where p.shop_id = v_shop
      and p.article_prefix = v_prefix
      and p.article_seq = s
  )
  order by s
  limit 1;

  if v_seq is null then
    select p.article_seq into v_seq
    from public.products p
    where p.shop_id = v_shop
      and p.article_prefix = v_prefix
      and p.status in ('sold', 'archived')
    order by p.created_at asc
    limit 1;

    if v_seq is not null then
      v_reused := true;
      update public.products p
         set article_prefix = null,
             article_seq    = null,
             status         = 'archived'
       where p.shop_id = v_shop
         and p.article_prefix = v_prefix
         and p.article_seq = v_seq;
    end if;
  end if;

  if v_seq is null then
    raise exception
      'Свободные артикулы для префикса % закончились (00001–99999).', v_prefix
      using errcode = 'P0001';
  end if;

  return query
    select public.compose_article(v_prefix, v_seq), v_prefix, v_seq, v_reused;
end $_$;

CREATE OR REPLACE FUNCTION public.public_product(_shop_id uuid, _article text) RETURNS TABLE(id uuid, shop_id uuid, shop_name text, name text, category text, metal text, metal_color text, purity text, weight numeric, size text, sku text, stones text, description text, sale_price numeric, quantity integer, status text, images text[], image_url text, created_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  select
    p.id,
    p.shop_id,
    s.shop_name,
    p.name,
    p.category,
    p.metal,
    p.metal_color,
    p.purity,
    p.weight,
    p.size,
    p.sku,
    p.stones,
    p.description,
    p.sale_price,
    p.quantity,
    p.status::text,
    p.images,
    p.image_url,
    p.created_at
  from public.products p
  left join public.shop_settings s on s.shop_id = p.shop_id
  where p.shop_id = _shop_id
    and p.sku     = _article
    and coalesce(p.is_hidden, false) = false
  limit 1;
$$;

CREATE OR REPLACE FUNCTION public.public_shop_products(_shop_id uuid, _limit integer DEFAULT 24) RETURNS TABLE(id uuid, shop_id uuid, shop_name text, name text, category text, metal text, metal_color text, purity text, weight numeric, size text, sku text, stones text, description text, sale_price numeric, quantity integer, status text, images text[], image_url text, created_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  select
    p.id,
    p.shop_id,
    s.shop_name,
    p.name,
    p.category,
    p.metal,
    p.metal_color,
    p.purity,
    p.weight,
    p.size,
    p.sku,
    p.stones,
    p.description,
    p.sale_price,
    p.quantity,
    p.status::text,
    p.images,
    p.image_url,
    p.created_at
  from public.products p
  left join public.shop_settings s on s.shop_id = p.shop_id
  where p.shop_id  = _shop_id
    and p.status   = 'in_stock'
    and p.quantity > 0
    and coalesce(p.is_hidden, false) = false
  order by p.created_at desc
  limit _limit;
$$;

CREATE OR REPLACE FUNCTION public.release_article(p_prefix text, p_seq integer) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_shop uuid := public.current_shop_id();
  v_cnt  integer;
begin
  if not public.is_approved() or v_shop is null then
    raise exception 'Нет доступа' using errcode = '42501';
  end if;
  update public.products p
     set status = 'archived',
         article_prefix = null,
         article_seq = null
   where p.shop_id = v_shop
     and p.article_prefix = upper(btrim(p_prefix))
     and p.article_seq = p_seq
     and p.status in ('sold', 'archived');
  get diagnostics v_cnt = row_count;
  return v_cnt;
end $$;

CREATE OR REPLACE FUNCTION public.reset_bonus_points(_user_id uuid) RETURNS numeric
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not public.is_shop_admin() then
    raise exception 'Обнулять бонусы может только администратор' using errcode = '42501';
  end if;
  update public.profiles set bonus_points = 0
   where id = _user_id and shop_id = public.current_shop_id();
  return 0;
end $$;

CREATE OR REPLACE FUNCTION public.set_bonus_points(_user_id uuid, _points numeric) RETURNS numeric
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_total numeric;
begin
  if not public.is_shop_admin() then
    raise exception 'Управлять бонусами может только администратор' using errcode = '42501';
  end if;
  if _points is null or _points < 0 then
    raise exception 'Некорректное количество баллов' using errcode = '22023';
  end if;
  update public.profiles
     set bonus_points = _points
   where id = _user_id
     and shop_id = public.current_shop_id()
  returning bonus_points into v_total;
  if v_total is null then
    raise exception 'Сотрудник не найден' using errcode = 'P0002';
  end if;
  return v_total;
end $$;

CREATE OR REPLACE FUNCTION public.set_bonus_rate(_user_id uuid, _rate numeric) RETURNS numeric
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_rate numeric;
begin
  if not public.is_shop_admin() then
    raise exception 'Менять ставку бонусов может только администратор' using errcode = '42501';
  end if;
  if _rate is null or _rate < 0 or _rate > 100 then
    raise exception 'Ставка должна быть от 0 до 100' using errcode = '22023';
  end if;
  update public.profiles
     set bonus_rate = _rate
   where id = _user_id
     and shop_id = public.current_shop_id()
  returning bonus_rate into v_rate;
  if v_rate is null then
    raise exception 'Сотрудник не найден' using errcode = 'P0002';
  end if;
  return v_rate;
end $$;

CREATE OR REPLACE FUNCTION public.superadmin_impersonate(_target_shop_id uuid DEFAULT NULL::uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden: requires super_admin role';
  END IF;

  UPDATE public.profiles
  SET impersonated_shop_id = _target_shop_id
  WHERE id = auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION public.superadmin_list_shops() RETURNS TABLE(shop_id uuid, shop_name text, paid_until date, subscription_status text, auto_block boolean, is_frozen boolean, frozen_at timestamp with time zone, member_count integer, created_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT
    ss.shop_id,
    ss.shop_name,
    ss.paid_until,
    ss.subscription_status,
    ss.auto_block,
    ss.is_frozen,
    ss.frozen_at,
    COALESCE(mc.cnt, 0)::integer AS member_count,
    ss.updated_at               AS created_at
  FROM public.shop_settings ss
  LEFT JOIN (
    SELECT shop_id, COUNT(*)::integer AS cnt
    FROM public.profiles
    WHERE status = 'approved'
    GROUP BY shop_id
  ) mc ON mc.shop_id = ss.shop_id
  WHERE public.is_super_admin()
  ORDER BY ss.shop_name;
$$;

CREATE OR REPLACE FUNCTION public.superadmin_update_shop_billing(_shop_id uuid, _paid_until date DEFAULT NULL::date, _subscription_status text DEFAULT NULL::text, _auto_block boolean DEFAULT NULL::boolean, _is_frozen boolean DEFAULT NULL::boolean, _notes text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden: requires super_admin role';
  END IF;

  UPDATE public.shop_settings
  SET
    paid_until          = COALESCE(_paid_until,          paid_until),
    subscription_status = COALESCE(_subscription_status, subscription_status),
    auto_block          = COALESCE(_auto_block,          auto_block),
    is_frozen           = COALESCE(_is_frozen,           is_frozen),
    frozen_at           = CASE
                            WHEN _is_frozen IS NOT NULL AND _is_frozen = true  AND NOT is_frozen
                            THEN now()
                            WHEN _is_frozen IS NOT NULL AND _is_frozen = false
                            THEN NULL
                            ELSE frozen_at
                          END,
    frozen_by           = CASE
                            WHEN _is_frozen IS NOT NULL AND _is_frozen = true  AND NOT is_frozen
                            THEN auth.uid()
                            WHEN _is_frozen IS NOT NULL AND _is_frozen = false
                            THEN NULL
                            ELSE frozen_by
                          END,
    notes               = COALESCE(_notes, notes),
    updated_at          = now()
  WHERE shop_id = _shop_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shop not found: %', _shop_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_product_article() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if new.article_prefix is not null and new.article_seq is not null then
    new.sku := public.compose_article(new.article_prefix, new.article_seq);
  end if;
  return new;
end $$;

CREATE OR REPLACE FUNCTION public.touch_presence() RETURNS timestamp with time zone
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_at timestamptz := now();
begin
  update public.profiles set last_seen_at = v_at where id = auth.uid();
  return v_at;
end $$;

-- ============================================================================
-- 3b. ФУНКЦИИ v21: одобрение/отклонение заявок из ЛЮБОГО магазина
-- ============================================================================

CREATE OR REPLACE FUNCTION public.superadmin_approve_request(
  _profile_id uuid,
  _role       text
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
  IF _role NOT IN ('admin', 'seller') THEN
    RAISE EXCEPTION 'Недопустимая роль: %. Допустимы: admin, seller', _role
      USING errcode = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = _profile_id AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'Заявка не найдена или уже обработана (id: %)', _profile_id
      USING errcode = 'P0002';
  END IF;
  UPDATE public.profiles
  SET status = 'approved', role = _role::public.app_role, manager_id = NULL
  WHERE id = _profile_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.superadmin_reject_request(
  _profile_id uuid
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
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = _profile_id AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'Заявка не найдена или уже обработана (id: %)', _profile_id
      USING errcode = 'P0002';
  END IF;
  UPDATE public.profiles
  SET status = 'rejected', role = NULL
  WHERE id = _profile_id;
END;
$$;

-- ============================================================================
-- 3c. ФУНКЦИИ v22: RPC для уведомлений суперадмина
-- ============================================================================

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
END;
$$;

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

-- ============================================================================
-- 4. ПЕРВИЧНЫЕ КЛЮЧИ И ОГРАНИЧЕНИЯ (CONSTRAINTS)
-- ============================================================================
ALTER TABLE ONLY public.cash_operations ADD CONSTRAINT cash_operations_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.cash_reason_presets ADD CONSTRAINT cash_reason_presets_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.cash_reason_presets ADD CONSTRAINT cash_reason_presets_shop_id_text_key UNIQUE (shop_id, text);
ALTER TABLE ONLY public.customers ADD CONSTRAINT customers_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.customers ADD CONSTRAINT customers_shop_id_phone_key UNIQUE (shop_id, phone);
ALTER TABLE ONLY public.metal_rates ADD CONSTRAINT metal_rates_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.metal_rates ADD CONSTRAINT metal_rates_shop_id_metal_key UNIQUE (shop_id, metal);
ALTER TABLE ONLY public.products ADD CONSTRAINT products_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.profiles ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.sales ADD CONSTRAINT sales_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.shop_settings ADD CONSTRAINT shop_settings_pkey PRIMARY KEY (shop_id);

-- ============================================================================
-- 5. ИНДЕКСЫ
-- ============================================================================
-- Кассовые операции
CREATE INDEX IF NOT EXISTS cash_ops_shop_idx ON public.cash_operations USING btree (shop_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS cash_presets_shop_text_idx ON public.cash_reason_presets USING btree (shop_id, text);

-- Клиенты (v20: оставлен только last_purchase; purchase_count_idx удалён как малоиспользуемый)
CREATE INDEX IF NOT EXISTS customers_last_purchase_idx ON public.customers USING btree (shop_id, last_purchase_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS customers_shop_blacklist_idx ON public.customers USING btree (shop_id, is_blacklisted) WHERE (is_blacklisted = true);
CREATE UNIQUE INDEX IF NOT EXISTS customers_shop_email_idx ON public.customers USING btree (shop_id, email) WHERE (email IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS customers_shop_phone_idx ON public.customers USING btree (shop_id, phone) WHERE (phone IS NOT NULL);

-- Товары (v20: удалены products_shop_idx и products_shop_hidden_idx, добавлен составной products_shop_status_idx)
CREATE UNIQUE INDEX IF NOT EXISTS products_shop_article_idx ON public.products USING btree (shop_id, article_prefix, article_seq) WHERE ((article_prefix IS NOT NULL) AND (article_seq IS NOT NULL));
CREATE INDEX IF NOT EXISTS products_shop_status_idx ON public.products USING btree (shop_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS products_shop_sku_idx ON public.products USING btree (shop_id, sku);

-- Профили
CREATE INDEX IF NOT EXISTS profiles_impersonated_idx ON public.profiles USING btree (impersonated_shop_id) WHERE (impersonated_shop_id IS NOT NULL);

-- Продажи (v20: sales_shop_idx удалён как дубль sales_shop_created_idx)
CREATE INDEX IF NOT EXISTS sales_customer_created_idx ON public.sales USING btree (customer_id, created_at DESC) WHERE (customer_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS sales_shop_created_idx ON public.sales USING btree (shop_id, created_at DESC);

-- Настройки магазина
CREATE INDEX IF NOT EXISTS shop_settings_paid_until_idx ON public.shop_settings USING btree (paid_until) WHERE (paid_until IS NOT NULL);

-- v22: Индексы для таблицы уведомлений
CREATE INDEX IF NOT EXISTS sn_unread_idx ON public.superadmin_notifications (is_read, created_at DESC) WHERE is_read = false;
CREATE INDEX IF NOT EXISTS sn_created_idx ON public.superadmin_notifications (created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS sn_profile_active_idx ON public.superadmin_notifications (profile_id) WHERE is_processed = false;

-- ============================================================================
-- 6. ТРИГГЕРЫ
-- ============================================================================
DROP TRIGGER IF EXISTS guard_profile_privileges ON public.profiles;
CREATE TRIGGER guard_profile_privileges BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.guard_profile_privileges();

DROP TRIGGER IF EXISTS sync_product_article ON public.products;
CREATE TRIGGER sync_product_article BEFORE INSERT OR UPDATE OF article_prefix, article_seq ON public.products FOR EACH ROW EXECUTE FUNCTION public.sync_product_article();

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- v22: уведомление суперадмина при смене статуса профиля
DROP TRIGGER IF EXISTS trg_notify_pending_profile ON public.profiles;
CREATE TRIGGER trg_notify_pending_profile
  AFTER INSERT OR UPDATE OF status
  ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_pending_profile();

-- ============================================================================
-- 7. ВНЕШНИЕ КЛЮЧИ (FOREIGN KEYS)
-- ============================================================================
ALTER TABLE ONLY public.cash_operations ADD CONSTRAINT cash_operations_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.cash_reason_presets ADD CONSTRAINT cash_reason_presets_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.products ADD CONSTRAINT products_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.profiles ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.profiles ADD CONSTRAINT profiles_impersonated_shop_id_fkey FOREIGN KEY (impersonated_shop_id) REFERENCES public.shop_settings(shop_id) ON DELETE SET NULL;
ALTER TABLE ONLY public.profiles ADD CONSTRAINT profiles_manager_id_fkey FOREIGN KEY (manager_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.sales ADD CONSTRAINT sales_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.sales ADD CONSTRAINT sales_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.shop_settings ADD CONSTRAINT shop_settings_frozen_by_fkey FOREIGN KEY (frozen_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- ============================================================================
-- 8. БЕЗОПАСНОСТЬ И РЕЖИМ RLS (ROW LEVEL SECURITY)
-- ============================================================================
ALTER TABLE public.cash_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_reason_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metal_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_settings ENABLE ROW LEVEL SECURITY;
-- v22: уведомления — только через RLS (super_admin)
ALTER TABLE public.superadmin_notifications ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 9. ПОЛИТИКИ ДОСТУПА RLS
-- ============================================================================
CREATE POLICY "cash_operations: insert own" ON public.cash_operations FOR INSERT TO authenticated WITH CHECK ((public.is_approved() AND (created_by = auth.uid()) AND (shop_id = public.current_shop_id())));
CREATE POLICY "cash_operations: shop read" ON public.cash_operations FOR SELECT TO authenticated USING ((public.is_approved() AND (shop_id = public.current_shop_id())));
CREATE POLICY "cash_presets: shop access" ON public.cash_reason_presets TO authenticated USING ((public.is_approved() AND (shop_id = public.current_shop_id()))) WITH CHECK ((public.is_approved() AND (shop_id = public.current_shop_id())));
CREATE POLICY "customers: shop access" ON public.customers TO authenticated USING ((public.is_approved() AND (shop_id = public.current_shop_id()))) WITH CHECK ((public.is_approved() AND (shop_id = public.current_shop_id())));
CREATE POLICY "metal_rates: admin writes" ON public.metal_rates TO authenticated USING ((public.is_shop_admin() AND (shop_id = public.current_shop_id()))) WITH CHECK ((public.is_shop_admin() AND (shop_id = public.current_shop_id())));
CREATE POLICY "metal_rates: shop read" ON public.metal_rates FOR SELECT TO authenticated USING ((public.is_approved() AND (shop_id = public.current_shop_id())));
CREATE POLICY "products: admin delete" ON public.products FOR DELETE TO authenticated USING ((public.is_shop_admin() AND (shop_id = public.current_shop_id())));
CREATE POLICY "products: shop insert" ON public.products FOR INSERT TO authenticated WITH CHECK ((public.is_approved() AND (shop_id = public.current_shop_id())));
CREATE POLICY "products: shop read" ON public.products FOR SELECT TO authenticated USING ((public.is_approved() AND (shop_id = public.current_shop_id())));
CREATE POLICY "products: shop update" ON public.products FOR UPDATE TO authenticated USING ((public.is_approved() AND (shop_id = public.current_shop_id()))) WITH CHECK ((shop_id = public.current_shop_id()));
CREATE POLICY "profiles: admin manages shop" ON public.profiles FOR UPDATE TO authenticated USING ((public.is_shop_admin() AND (shop_id = public.current_shop_id()))) WITH CHECK ((public.is_shop_admin() AND (shop_id = public.current_shop_id())));
CREATE POLICY "profiles: read own" ON public.profiles FOR SELECT TO authenticated USING ((id = auth.uid()));
CREATE POLICY "profiles: read shop" ON public.profiles FOR SELECT TO authenticated USING (((shop_id IS NOT NULL) AND (shop_id = public.current_shop_id())));
CREATE POLICY "profiles: update own" ON public.profiles FOR UPDATE TO authenticated USING ((id = auth.uid())) WITH CHECK ((id = auth.uid()));
CREATE POLICY "sales: admin reads shop" ON public.sales FOR SELECT TO authenticated USING ((public.is_shop_admin() AND (shop_id = public.current_shop_id())));
CREATE POLICY "sales: insert own" ON public.sales FOR INSERT TO authenticated WITH CHECK ((public.is_approved() AND (seller_id = auth.uid()) AND (shop_id = public.current_shop_id())));
CREATE POLICY "sales: seller reads own" ON public.sales FOR SELECT TO authenticated USING ((public.is_approved() AND (seller_id = auth.uid())));
CREATE POLICY "sales: shop read" ON public.sales FOR SELECT TO authenticated USING ((public.is_approved() AND (shop_id = public.current_shop_id())));
CREATE POLICY "shop_settings: admin writes" ON public.shop_settings TO authenticated USING ((public.is_shop_admin() AND (shop_id = public.current_shop_id()))) WITH CHECK ((public.is_shop_admin() AND (shop_id = public.current_shop_id())));
CREATE POLICY "shop_settings: public read" ON public.shop_settings FOR SELECT TO anon USING (public_enabled);
CREATE POLICY "shop_settings: shop read" ON public.shop_settings FOR SELECT TO authenticated USING ((shop_id = public.current_shop_id()));
CREATE POLICY "shop_settings: super_admin read all" ON public.shop_settings FOR SELECT TO authenticated USING (public.is_super_admin());
CREATE POLICY "shop_settings: super_admin write all" ON public.shop_settings FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
-- v21: супер-админ читает и обновляет профили из ЛЮБОГО магазина
CREATE POLICY "profiles: super_admin reads all" ON public.profiles FOR SELECT TO authenticated USING (public.is_super_admin());
CREATE POLICY "profiles: super_admin manages all" ON public.profiles FOR UPDATE TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
-- v22: уведомления доступны только суперадмину
CREATE POLICY "superadmin_notifications: super_admin all" ON public.superadmin_notifications FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- ============================================================================
-- 10. ПРАВА ДОСТУПА (GRANTS)
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.superadmin_notifications TO authenticated;
GRANT ALL ON public.superadmin_notifications TO service_role;

GRANT EXECUTE ON FUNCTION public.superadmin_get_notifications(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.superadmin_get_unread_count() TO authenticated;
GRANT EXECUTE ON FUNCTION public.superadmin_mark_notification_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.superadmin_mark_all_notifications_read() TO authenticated;
GRANT EXECUTE ON FUNCTION public.superadmin_approve_request(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.superadmin_reject_request(uuid) TO authenticated;

-- ============================================================================
-- 11. REALTIME — публикация таблицы уведомлений
-- ============================================================================
-- Выполнить вручную в Supabase Dashboard → Database → Replication
-- или через SQL:
--   ALTER PUBLICATION supabase_realtime ADD TABLE public.superadmin_notifications;
-- (Команда закомментирована, т.к. supabase_realtime может не существовать
--  в локальной среде без инициализации Supabase CLI)
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.superadmin_notifications;

-- ============================================================================
-- 12. РЕТРОСПЕКТИВА: уведомления для уже существующих pending-профилей
-- ============================================================================
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
