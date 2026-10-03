-- TEST DATABASE ONLY. Minimal schema for integration tests, never a migration.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END; $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
CREATE TYPE public.cash_op_type AS ENUM ('income', 'outcome', 'collection');
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY, shop_id uuid, impersonated_shop_id uuid,
  role text, status text, full_name text, bonus_points numeric DEFAULT 0, bonus_rate numeric
);
CREATE TABLE public.products (
  id uuid PRIMARY KEY, shop_id uuid, name text, sku text, status text,
  sale_price numeric, purchase_price numeric, weight numeric, metal text, deleted_at timestamptz
);
CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid, name text, phone text,
  bonus_points numeric DEFAULT 0, purchase_count integer DEFAULT 0,
  total_spent numeric DEFAULT 0, last_purchase_at timestamptz, created_at timestamptz DEFAULT now()
);
CREATE TABLE public.shop_settings (shop_id uuid PRIMARY KEY, default_bonus_rate numeric);
CREATE TABLE public.sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid, seller_id uuid, seller_name text,
  customer_id uuid, customer_name text, customer_phone text, payment_method text,
  amount_cash numeric, amount_electronic numeric, subtotal numeric, discount numeric,
  total numeric, cost_total numeric, profit numeric, bonus_earned numeric, bonus_used numeric,
  items jsonb, created_at timestamptz DEFAULT now(), deleted_at timestamptz, client_op_id text
);
CREATE UNIQUE INDEX sales_client_op_id_idx ON public.sales(client_op_id) WHERE client_op_id IS NOT NULL;
CREATE TABLE public.cash_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid NOT NULL, created_by uuid NOT NULL,
  author_name text, type public.cash_op_type NOT NULL, amount numeric(14,2) NOT NULL,
  reason text NOT NULL, source text DEFAULT 'cash', amount_cash numeric(14,2), amount_electronic numeric(14,2),
  client_op_id text, deleted_at timestamptz, created_at timestamptz DEFAULT now(),
  supplier_name text, supplier_phone text, supplier_debt_operation_id uuid
);
CREATE UNIQUE INDEX cash_operations_client_op_id_idx ON public.cash_operations(client_op_id) WHERE client_op_id IS NOT NULL;
CREATE TABLE public.cash_reason_presets (
  id uuid DEFAULT gen_random_uuid(), shop_id uuid, created_by uuid,
  text text CHECK (text <> 'force-preset-failure')
);
CREATE TABLE public.supplier_debt_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid, supplier_name text, supplier_phone text,
  operation_type text, amount numeric, balance_before numeric, balance_after numeric,
  cash_operation_id uuid, source text, amount_cash numeric, amount_electronic numeric,
  reason text, created_by uuid, author_name text, device_info text
);
CREATE FUNCTION public.current_shop_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT CASE WHEN role = 'super_admin' THEN coalesce(impersonated_shop_id, shop_id) ELSE shop_id END
  FROM public.profiles WHERE id = auth.uid();
$$;
CREATE FUNCTION public.is_shop_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND status = 'approved' AND role IN ('admin', 'super_admin'));
$$;
CREATE FUNCTION public.increment_customer_stats(_customer_id uuid, _amount numeric) RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE public.customers SET purchase_count = purchase_count + 1,
    total_spent = total_spent + _amount, last_purchase_at = now() WHERE id = _customer_id;
$$;
CREATE FUNCTION public.test_assert(_ok boolean, _message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF _ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST FAILED: %', _message; END IF; END;
$$;
CREATE FUNCTION public.test_reject_sale_cash() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reason LIKE 'Продажа чека #%' AND NEW.amount = 777 THEN
    RAISE EXCEPTION 'Injected cash failure' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER test_sale_cash_failure BEFORE INSERT ON public.cash_operations
FOR EACH ROW EXECUTE FUNCTION public.test_reject_sale_cash();

GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
ALTER TABLE public.cash_operations ENABLE ROW LEVEL SECURITY;
CREATE POLICY cash_scope ON public.cash_operations TO authenticated
  USING (shop_id = public.current_shop_id()) WITH CHECK (shop_id = public.current_shop_id() AND created_by = auth.uid());
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY sale_scope ON public.sales TO authenticated
  USING (shop_id = public.current_shop_id()) WITH CHECK (shop_id = public.current_shop_id() AND seller_id = auth.uid());
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY product_scope ON public.products TO authenticated
  USING (shop_id = public.current_shop_id()) WITH CHECK (shop_id = public.current_shop_id());

INSERT INTO public.profiles (id, shop_id, role, status, full_name) VALUES
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'admin', 'approved', 'Админ'),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '11111111-1111-4111-8111-111111111111', 'seller', 'approved', 'Продавец'),
('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '22222222-2222-4222-8222-222222222222', 'admin', 'approved', 'Другой магазин'),
('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '11111111-1111-4111-8111-111111111111', 'super_admin', 'approved', 'Супер');
UPDATE public.profiles SET impersonated_shop_id = '22222222-2222-4222-8222-222222222222'
WHERE id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
INSERT INTO public.products (id, shop_id, name, sku, status, sale_price, purchase_price, weight, metal) VALUES
('10000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Кольцо', 'A1', 'in_stock', 100, 40, 1, 'Золото'),
('10000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Цепь', 'A2', 'in_stock', 100, 40, 1, 'Золото'),
('10000000-0000-4000-8000-000000000003', '22222222-2222-4222-8222-222222222222', 'Другой магазин', 'A3', 'in_stock', 100, 40, 1, 'Золото');