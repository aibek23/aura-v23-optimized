-- TEST DATABASE ONLY. Rolled back so concurrency tests start with the fixture.
BEGIN;
SET ROLE authenticated;
SET request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
DO $test$
DECLARE
  r jsonb; sale_id uuid; c numeric; e numeric;
  shop uuid := '11111111-1111-4111-8111-111111111111';
  uid uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  sale_payload jsonb := '{"items":[{"product_id":"10000000-0000-4000-8000-000000000001","quantity":1,"price":100}],"customer_name":"Клиент","customer_phone":"+996555111222","payment_method":"cash"}';
BEGIN
  r := public.create_cash_operation_atomic('00000000-0000-4000-8000-000000000001', 'income', 100, 'cash', 0, 0, 'Начало', false, true);
  PERFORM public.test_assert(r->>'duplicate' = 'false', 'first income');
  r := public.create_cash_operation_atomic('00000000-0000-4000-8000-000000000001', 'income', 100, 'cash', 0, 0, 'Начало', false, true);
  PERFORM public.test_assert(r->>'duplicate' = 'true', 'income retry');
  PERFORM public.test_assert((SELECT count(*) = 1 FROM public.cash_reason_presets), 'preset is not duplicated');
  BEGIN
    PERFORM public.create_cash_operation_atomic('00000000-0000-4000-8000-000000000001', 'income', 101, 'cash', 0, 0, 'Начало');
    RAISE EXCEPTION 'TEST FAILED: changed duplicate accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  PERFORM public.create_cash_operation_atomic('00000000-0000-4000-8000-000000000002', 'income', 50, 'electronic', 0, 0, 'Безнал');
  PERFORM public.create_cash_operation_atomic('00000000-0000-4000-8000-000000000003', 'collection', 30, 'mixed', 999, 999, 'Инкассация');
  SELECT cash, electronic INTO c, e FROM public.cash_ledger_balances(shop);
  PERFORM public.test_assert(c = 70 AND e = 80, 'collection transfers, never destroys total');
  PERFORM public.create_cash_operation_atomic('00000000-0000-4000-8000-000000000004', 'outcome', 30, 'mixed', 20, 10, 'Смешанный расход');
  SELECT cash, electronic INTO c, e FROM public.cash_ledger_balances(shop);
  PERFORM public.test_assert(c = 50 AND e = 70, 'mixed outcome');
  BEGIN
    PERFORM public.create_cash_operation_atomic('00000000-0000-4000-8000-000000000005', 'outcome', 51, 'cash', 0, 0, 'Недостаточно');
    RAISE EXCEPTION 'TEST FAILED: cash overdraft accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    PERFORM public.create_cash_operation_atomic('00000000-0000-4000-8000-000000000006', 'outcome', 71, 'electronic', 0, 0, 'Недостаточно');
    RAISE EXCEPTION 'TEST FAILED: electronic overdraft accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM public.test_assert((SELECT count(*) = 4 FROM public.cash_operations), 'rejected operations leave no rows');
  BEGIN
    PERFORM public.create_cash_operation_atomic('00000000-0000-4000-8000-000000000007', 'income', 10, 'cash', 0, 0, 'force-preset-failure', false, true);
    RAISE EXCEPTION 'TEST FAILED: preset failure accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM public.test_assert((SELECT count(*) = 4 FROM public.cash_operations), 'preset failure rolls back the money row');
  BEGIN
    PERFORM public.create_cash_operation_atomic('00000000-0000-4000-8000-000000000007', 'income', 10, 'mixed', 9.99, 0, 'Mismatch');
    RAISE EXCEPTION 'TEST FAILED: one-cent split mismatch accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.create_cash_operation_atomic('00000000-0000-4000-8000-000000000008', 'income', 'NaN', 'cash', 0, 0, 'Bad');
    RAISE EXCEPTION 'TEST FAILED: NaN accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.create_cash_operation_atomic('00000000-0000-4000-8000-000000000008', 'income', NULL, 'cash', 0, 0, 'Bad');
    RAISE EXCEPTION 'TEST FAILED: null accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  PERFORM public.test_assert((SELECT cash = 0 AND electronic = 0 FROM public.cash_ledger_balances('22222222-2222-4222-8222-222222222222')), 'RLS isolates other shops');

  -- Old mixed receipts without splits and atomic sale mirrors.
  INSERT INTO public.sales(shop_id, seller_id, total, payment_method, client_op_id)
  VALUES (shop, uid, 10, 'mixed', 'legacy-sale'), (shop, uid, 15, 'card', 'atomic-sale');
  INSERT INTO public.cash_operations(shop_id, created_by, type, amount, reason, source, amount_cash, amount_electronic, client_op_id)
  VALUES (shop, uid, 'income', 15, 'Mirror', 'electronic', 0, 15, 'atomic-sale:cash');
  INSERT INTO public.cash_operations(shop_id, created_by, type, amount, reason, deleted_at)
  VALUES (shop, uid, 'income', 1000, 'Deleted', now());
  SELECT cash, electronic INTO c, e FROM public.cash_ledger_balances(shop);
  PERFORM public.test_assert(c = 60 AND e = 85, 'legacy, mirror dedup and soft deletion');
  INSERT INTO public.cash_operations(shop_id, created_by, type, amount, reason)
  SELECT shop, uid, 'income', 1, 'Many rows' FROM generate_series(1, 1100);
  r := public.create_cash_operation_atomic('00000000-0000-4000-8000-000000000009', 'outcome', 1160, 'cash', 0, 0, 'Все наличные');
  PERFORM public.test_assert((SELECT cash = 0 FROM public.cash_ledger_balances(shop)), 'SQL aggregates all >1000 rows');
  r := public.create_cash_operation_atomic('00000000-0000-4000-8000-000000000009', 'outcome', 1160, 'cash', 0, 0, 'Все наличные');
  PERFORM public.test_assert(r->>'duplicate' = 'true', 'retry after balance reached zero');

  -- Receipt, stock, customer counters, bonuses and cash commit exactly once.
  r := public.commit_offline_sale('sale-success', sale_payload);
  PERFORM public.test_assert(r->>'accepted' = 'true', 'sale accepted');
  sale_id := (r->>'sale_id')::uuid;
  r := public.commit_offline_sale('sale-success', sale_payload);
  PERFORM public.test_assert(r->>'duplicate' = 'true' AND (r->>'sale_id')::uuid = sale_id, 'sale retry');
  PERFORM public.test_assert((SELECT count(*) = 1 FROM public.sales WHERE client_op_id = 'sale-success'), 'one receipt');
  PERFORM public.test_assert((SELECT count(*) = 1 FROM public.cash_operations WHERE client_op_id = 'sale-success:cash'), 'one mirror');
  PERFORM public.test_assert((SELECT bonus_points = 1 FROM public.profiles WHERE id = uid), 'bonus awarded once');
  PERFORM public.test_assert((SELECT purchase_count = 1 AND total_spent = 100 FROM public.customers WHERE phone = '+996555111222'), 'customer stats once');
  r := public.commit_offline_sale('sale-conflict', '{"items":[{"product_id":"10000000-0000-4000-8000-000000000002","quantity":1,"price":100},{"product_id":"10000000-0000-4000-8000-000000000001","quantity":1,"price":100}]}');
  PERFORM public.test_assert(r->>'accepted' = 'false', 'stock conflict');
  PERFORM public.test_assert((SELECT status = 'in_stock' FROM public.products WHERE id = '10000000-0000-4000-8000-000000000002'), 'no partial stock change');
  BEGIN
    PERFORM public.commit_offline_sale('sale-failure', '{"items":[{"product_id":"10000000-0000-4000-8000-000000000002","quantity":1,"price":777}],"customer_name":"Failure","customer_phone":"+996555333444"}');
    RAISE EXCEPTION 'TEST FAILED: injected cash failure did not fail';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM public.test_assert((SELECT status = 'in_stock' FROM public.products WHERE id = '10000000-0000-4000-8000-000000000002'), 'cash failure restores product');
  PERFORM public.test_assert((SELECT count(*) = 0 FROM public.sales WHERE client_op_id = 'sale-failure'), 'cash failure restores sale');
  PERFORM public.test_assert((SELECT count(*) = 0 FROM public.customers WHERE phone = '+996555333444'), 'cash failure restores customer');
  PERFORM public.test_assert((SELECT bonus_points = 1 FROM public.profiles WHERE id = uid), 'cash failure restores bonus');
  r := public.create_cash_operation_atomic(
    '00000000-0000-4000-8000-000000000012', 'income', 1, 'cash', 0, 0, 'Offline',
    false, false, '30000000-0000-4000-8000-000000000001', '2026-10-04 10:00:00+06'
  );
  PERFORM public.test_assert(r->>'operation_id' = '30000000-0000-4000-8000-000000000001', 'offline row id preserved');
  PERFORM public.test_assert((SELECT created_at = '2026-10-04 10:00:00+06'::timestamptz FROM public.cash_operations WHERE id = '30000000-0000-4000-8000-000000000001'), 'offline timestamp preserved');
END;
$test$;

SET request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
DO $test$
BEGIN
  BEGIN
    PERFORM public.create_cash_operation_atomic('00000000-0000-4000-8000-000000000010', 'income', 1, 'cash', 0, 0, 'Seller', true);
    RAISE EXCEPTION 'TEST FAILED: seller income accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM public.create_cash_operation_atomic('00000000-0000-4000-8000-000000000011', 'outcome', 1, 'cash', 0, 0, 'Приём лома', true);
END;
$test$;
SET request.jwt.claim.sub = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
DO $test$
DECLARE r jsonb;
BEGIN
  r := public.commit_offline_sale('impersonated-sale', '{"items":[{"product_id":"10000000-0000-4000-8000-000000000003","quantity":1,"price":100}]}');
  PERFORM public.test_assert(r->>'accepted' = 'true', 'active impersonated shop is used');
  PERFORM public.test_assert((SELECT shop_id = '22222222-2222-4222-8222-222222222222' FROM public.sales WHERE client_op_id = 'impersonated-sale'), 'correct shop on receipt');
END;
$test$;
ROLLBACK;