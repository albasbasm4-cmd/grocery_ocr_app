-- Run against a local Supabase database as postgres: psql -v ON_ERROR_STOP=1 -f this-file.sql
-- Demonstrates that authenticated staff cannot edit products or read cost_price/profit RPC.
BEGIN;
CREATE TEMP TABLE phase2_test_ids (store_id uuid, owner_id uuid, staff_id uuid, product_id uuid) ON COMMIT DROP;
GRANT SELECT ON phase2_test_ids TO authenticated;
DO $$
DECLARE
  v_owner uuid := gen_random_uuid(); v_staff uuid := gen_random_uuid();
  v_store uuid; v_product uuid;
BEGIN
  INSERT INTO auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    VALUES (v_owner, 'authenticated', 'authenticated', v_owner::text || '@phase2.test', '', now(), now(), now()),
           (v_staff, 'authenticated', 'authenticated', v_staff::text || '@phase2.test', '', now(), now(), now());
  INSERT INTO public.stores(name, currency_code, currency_symbol) VALUES ('اختبار المرحلة 2', 'SAR', 'ر.س') RETURNING id INTO v_store;
  INSERT INTO public.store_members(store_id, user_id, role) VALUES (v_store, v_owner, 'owner'), (v_store, v_staff, 'staff');
  INSERT INTO public.products(store_id, name, barcode, unit, price, cost_price, stock_quantity, min_stock)
    VALUES (v_store, 'منتج اختبار', 'phase2-' || v_store::text, 'piece', 10, 5, 10, 1) RETURNING id INTO v_product;
  INSERT INTO phase2_test_ids VALUES (v_store, v_owner, v_staff, v_product);
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', (SELECT staff_id::text FROM phase2_test_ids), true);
DO $$
DECLARE v_store uuid; v_product uuid; v_rows integer;
BEGIN
  SELECT store_id, product_id INTO v_store, v_product FROM phase2_test_ids;
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = v_product) THEN
    RAISE EXCEPTION 'FAIL: staff should be able to read their store product';
  END IF;
  UPDATE public.products SET price = 0.01 WHERE id = v_product;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'FAIL: staff updated a product directly'; END IF;
  BEGIN
    PERFORM cost_price FROM public.products WHERE id = v_product;
    RAISE EXCEPTION 'FAIL: staff read cost_price directly';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: staff cannot read cost_price directly';
  END;
  BEGIN
    PERFORM * FROM public.get_profit_summary(v_store, NULL, NULL);
    RAISE EXCEPTION 'FAIL: staff accessed profit report';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%متاح لمالك المتجر فقط%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS: staff cannot access profit report';
  END;
  RAISE NOTICE 'PASS: RLS blocked direct staff product update';
END $$;
ROLLBACK;
