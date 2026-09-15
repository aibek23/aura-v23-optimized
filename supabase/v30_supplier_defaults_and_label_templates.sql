-- AURA GOLD CRM v30
-- 1. Товар без поставщика, отмеченный «Взято на реализацию», получает
--    поставщика из имени пользователя, который оформил операцию.
-- 2. Шаблоны этикеток хранятся в БД: отдельный override магазина и
--    global-default, который задаёт super_admin для всех магазинов.

CREATE TABLE IF NOT EXISTS public.label_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid,
  scope_key text NOT NULL,
  category text NOT NULL DEFAULT 'Прочее',
  size_key text NOT NULL,
  template_json text NOT NULL,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS label_templates_scope_category_size_idx
  ON public.label_templates(scope_key, category, size_key);

CREATE INDEX IF NOT EXISTS label_templates_shop_idx
  ON public.label_templates(shop_id, category, size_key);

ALTER TABLE public.label_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS label_templates_select ON public.label_templates;
CREATE POLICY label_templates_select ON public.label_templates
  FOR SELECT TO authenticated
  USING (
    public.is_approved()
    AND (shop_id IS NULL OR shop_id = public.current_shop_id())
  );

DROP POLICY IF EXISTS label_templates_write ON public.label_templates;
CREATE POLICY label_templates_write ON public.label_templates
  FOR ALL TO authenticated
  USING (
    public.is_approved()
    AND (
      (shop_id IS NULL AND public.is_super_admin())
      OR (shop_id = public.current_shop_id() AND public.is_shop_admin())
    )
  )
  WITH CHECK (
    public.is_approved()
    AND (
      (shop_id IS NULL AND public.is_super_admin())
      OR (shop_id = public.current_shop_id() AND public.is_shop_admin())
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.label_templates TO authenticated;

CREATE OR REPLACE FUNCTION public.take_product_on_consignment(
  _product_id uuid,
  _device_info text DEFAULT NULL
) RETURNS public.supplier_debt_operations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_shop uuid := public.current_shop_id();
  v_product public.products;
  v_before numeric(14,2);
  v_amount numeric(14,2);
  v_supplier_name text;
  v_operation public.supplier_debt_operations;
BEGIN
  IF NOT public.is_approved() THEN
    RAISE EXCEPTION 'Аккаунт не подтверждён' USING errcode = '42501';
  END IF;

  SELECT * INTO v_product
    FROM public.products
   WHERE id = _product_id AND shop_id = v_shop
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Товар не найден'; END IF;

  v_supplier_name := NULLIF(btrim(v_product.supplier_name), '');
  IF v_supplier_name IS NULL THEN
    SELECT COALESCE(NULLIF(btrim(p.full_name), ''), 'Администратор')
      INTO v_supplier_name
      FROM public.profiles p
     WHERE p.id = auth.uid();
    v_supplier_name := COALESCE(v_supplier_name, 'Администратор');
    UPDATE public.products
       SET supplier_name = v_supplier_name
     WHERE id = v_product.id;
  END IF;

  IF v_product.consignment_operation_id IS NOT NULL THEN
    RAISE EXCEPTION 'Товар уже взят на реализацию';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    v_shop::text || ':supplier:' || v_supplier_name || ':' ||
    coalesce(nullif(btrim(v_product.supplier_phone), ''), ''), 0
  ));

  -- Every product row is one physical unit.
  v_amount := round(coalesce(v_product.purchase_price, 0), 2);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'Закупочная стоимость товара должна быть больше нуля';
  END IF;

  SELECT coalesce(sum(
    CASE WHEN operation_type IN ('consignment','adjustment')
         THEN amount ELSE -amount END
  ), 0)
    INTO v_before
    FROM public.supplier_debt_operations
   WHERE shop_id = v_shop
     AND supplier_name = v_supplier_name
     AND supplier_phone IS NOT DISTINCT FROM nullif(btrim(v_product.supplier_phone), '');

  INSERT INTO public.supplier_debt_operations (
    shop_id, supplier_name, supplier_phone, operation_type, amount,
    balance_before, balance_after, product_id, reason, created_by, author_name, device_info
  )
  SELECT v_shop, v_supplier_name, nullif(btrim(v_product.supplier_phone), ''),
         'consignment', v_amount, v_before, v_before + v_amount, v_product.id,
         'Товар взят на реализацию', p.id, p.full_name, left(_device_info, 500)
    FROM public.profiles p
   WHERE p.id = auth.uid()
  RETURNING * INTO v_operation;

  UPDATE public.products
     SET consignment_operation_id = v_operation.id,
         consignment_at = v_operation.created_at,
         consignment_by = auth.uid()
   WHERE id = v_product.id;

  RETURN v_operation;
END;
$$;

GRANT EXECUTE ON FUNCTION public.take_product_on_consignment(uuid, text) TO authenticated;