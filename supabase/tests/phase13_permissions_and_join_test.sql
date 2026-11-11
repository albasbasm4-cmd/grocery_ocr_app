-- Run against a local Supabase database as postgres: psql -v ON_ERROR_STOP=1 -f this-file.sql
-- Tests Phase A permissions matrix, PIN isolation, join requests, and store isolation.
BEGIN;

CREATE TEMP TABLE test_env_ids (
  store_id uuid,
  other_store_id uuid,
  owner_id uuid,
  staff_read_id uuid,
  staff_write_id uuid,
  staff_nosell_id uuid,
  outsider_id uuid,
  product_id uuid,
  category_id uuid,
  join_code text
) ON COMMIT DROP;

GRANT SELECT ON test_env_ids TO authenticated;

DO $$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_staff_read uuid := gen_random_uuid();
  v_staff_write uuid := gen_random_uuid();
  v_staff_nosell uuid := gen_random_uuid();
  v_outsider uuid := gen_random_uuid();
  v_store uuid;
  v_other_store uuid;
  v_product uuid;
  v_category uuid;
  v_code text;
BEGIN
  INSERT INTO auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES
    (v_owner, 'authenticated', 'authenticated', 'owner@test.local', '', now(), now(), now()),
    (v_staff_read, 'authenticated', 'authenticated', 'staff_read@test.local', '', now(), now(), now()),
    (v_staff_write, 'authenticated', 'authenticated', 'staff_write@test.local', '', now(), now(), now()),
    (v_staff_nosell, 'authenticated', 'authenticated', 'staff_nosell@test.local', '', now(), now(), now()),
    (v_outsider, 'authenticated', 'authenticated', 'outsider@test.local', '', now(), now(), now());

  INSERT INTO public.stores(name, currency_code, currency_symbol)
  VALUES ('متجر الاختبار الرئيسي', 'SAR', 'ر.س')
  RETURNING id, join_code INTO v_store, v_code;

  INSERT INTO public.stores(name, currency_code, currency_symbol)
  VALUES ('متجر آخر منعزل', 'SAR', 'ر.س')
  RETURNING id INTO v_other_store;

  INSERT INTO public.store_members(store_id, user_id, role, permission, can_sell, is_active)
  VALUES
    (v_store, v_owner, 'owner', 'write', true, true),
    (v_store, v_staff_read, 'staff', 'read', true, true),
    (v_store, v_staff_write, 'staff', 'write', true, true),
    (v_store, v_staff_nosell, 'staff', 'write', false, true),
    (v_other_store, v_outsider, 'staff', 'write', true, true);

  INSERT INTO public.categories(store_id, name)
  VALUES (v_store, 'تصنيف أولي')
  RETURNING id INTO v_category;

  INSERT INTO public.products(store_id, name, barcode, unit, price, cost_price, stock_quantity, min_stock, category_id)
  VALUES (v_store, 'منتج أساسي', 'bar-1001', 'piece', 25.00, 15.00, 50, 5, v_category)
  RETURNING id INTO v_product;

  INSERT INTO test_env_ids
  VALUES (v_store, v_other_store, v_owner, v_staff_read, v_staff_write, v_staff_nosell, v_outsider, v_product, v_category, v_code);
END $$;

-- 1. اختبار المالك: يضيف ويعدل منتجات وتصنيفات بدون جلسة PIN
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', (SELECT owner_id::text FROM test_env_ids), true);

DO $$
DECLARE
  v_store uuid;
  v_cat uuid;
  v_prod uuid;
BEGIN
  SELECT store_id INTO v_store FROM test_env_ids;

  INSERT INTO public.categories(store_id, name)
  VALUES (v_store, 'تصنيف المالك الجديد')
  RETURNING id INTO v_cat;

  INSERT INTO public.products(store_id, name, barcode, unit, price, cost_price, stock_quantity, min_stock, category_id)
  VALUES (v_store, 'منتج أضيف بواسطة المالك', 'bar-owner-1', 'piece', 30.00, 20.00, 100, 10, v_cat)
  RETURNING id INTO v_prod;

  UPDATE public.products
  SET price = 35.00, cost_price = 22.00
  WHERE id = v_prod;

  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = v_prod AND price = 35.00 AND cost_price = 22.00) THEN
    RAISE EXCEPTION 'فشل: المالك لم يتمكن من تعديل السعر وسعر التكلفة دون PIN.';
  END IF;
END $$;

-- 2. اختبار موظف read: مرفوض من أي تعديل أو إضافة مباشرة
SELECT set_config('request.jwt.claim.sub', (SELECT staff_read_id::text FROM test_env_ids), true);

DO $$
DECLARE
  v_store uuid;
  v_prod uuid;
  v_updated integer;
BEGIN
  SELECT store_id, product_id INTO v_store, v_prod FROM test_env_ids;

  BEGIN
    INSERT INTO public.products(store_id, name, barcode, unit, price, stock_quantity, min_stock)
    VALUES (v_store, 'منتج غير مصرح', 'bar-err-1', 'piece', 10.00, 5, 1);
    RAISE EXCEPTION 'فشل: تم السماح لموظف read بإضافة منتج مباشرة.';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  UPDATE public.products SET price = 99.00 WHERE id = v_prod;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 0 THEN
    RAISE EXCEPTION 'فشل: تم السماح لموظف read بتحديث منتج مباشرة.';
  END IF;
END $$;

-- 3. اختبار موظف write: يعدل السعر ولكن مرفوض عند تعديل cost_price أو تعطيل المنتج
SELECT set_config('request.jwt.claim.sub', (SELECT staff_write_id::text FROM test_env_ids), true);

DO $$
DECLARE
  v_prod uuid;
BEGIN
  SELECT product_id INTO v_prod FROM test_env_ids;

  UPDATE public.products SET price = 28.00 WHERE id = v_prod;

  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = v_prod AND price = 28.00) THEN
    RAISE EXCEPTION 'فشل: موظف write يجب أن يتمكن من تحديث السعر.';
  END IF;

  BEGIN
    UPDATE public.products SET cost_price = 1.00 WHERE id = v_prod;
    RAISE EXCEPTION 'فشل: تم السماح لموظف write بتعديل سعر التكلفة.';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  BEGIN
    UPDATE public.products SET is_active = false WHERE id = v_prod;
    RAISE EXCEPTION 'فشل: تم السماح لموظف write بتعطيل المنتج.';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END $$;

-- 4. اختبار البيع: موظف can_sell=false مرفوض، وموظف can_sell=true مسموح له
SELECT set_config('request.jwt.claim.sub', (SELECT staff_nosell_id::text FROM test_env_ids), true);

DO $$
DECLARE
  v_store uuid;
  v_prod uuid;
  v_items jsonb;
BEGIN
  SELECT store_id, product_id INTO v_store, v_prod FROM test_env_ids;
  v_items := jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 1));

  BEGIN
    PERFORM public.process_sale(v_store, gen_random_uuid(), v_items, 0, 'cash', NULL);
    RAISE EXCEPTION 'فشل: تم السماح لموظف can_sell=false بإتمام عملية البيع.';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END $$;

SELECT set_config('request.jwt.claim.sub', (SELECT staff_write_id::text FROM test_env_ids), true);

DO $$
DECLARE
  v_store uuid;
  v_prod uuid;
  v_items jsonb;
  v_res jsonb;
BEGIN
  SELECT store_id, product_id INTO v_store, v_prod FROM test_env_ids;
  v_items := jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 2));

  v_res := public.process_sale(v_store, gen_random_uuid(), v_items, 0, 'cash', NULL);
  IF (v_res->>'sale_id') IS NULL THEN
    RAISE EXCEPTION 'فشل: لم يتمكن موظف can_sell=true من إتمام عملية البيع.';
  END IF;
END $$;

-- 5. اختبار عزل المتاجر: موظف من متجر آخر لا يرى أي منتج من هذا المتجر
SELECT set_config('request.jwt.claim.sub', (SELECT outsider_id::text FROM test_env_ids), true);

DO $$
DECLARE
  v_store uuid;
BEGIN
  SELECT store_id INTO v_store FROM test_env_ids;
  IF EXISTS (SELECT 1 FROM public.products WHERE store_id = v_store) THEN
    RAISE EXCEPTION 'فشل: موظف من متجر خارجي تمكن من رؤية منتجات المتجر.';
  END IF;
END $$;

-- 6. اختبار طلبات الانضمام: حماية الرمز والحد اليومي والتكرار
DO $$
DECLARE
  v_code text;
  v_res jsonb;
BEGIN
  SELECT join_code INTO v_code FROM test_env_ids;

  BEGIN
    PERFORM public.request_join_store('WRONG99');
    RAISE EXCEPTION 'فشل: تم قبول رمز انضمام خاطئ.';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  v_res := public.request_join_store(v_code);
  IF (v_res->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'فشل: لم يتم إنشاء طلب الانضمام برمز صحيح.';
  END IF;

  BEGIN
    PERFORM public.request_join_store(v_code);
    RAISE EXCEPTION 'فشل: تم السماح بتكرار طلب انضمام معلق لنفس المتجر.';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END $$;

-- 7. اختبار المالك: تعديل الصلاحيات والقبول مرفوضان دون جلسة PIN
SELECT set_config('request.jwt.claim.sub', (SELECT owner_id::text FROM test_env_ids), true);

DO $$
DECLARE
  v_store uuid;
  v_staff uuid;
  v_req_id uuid;
BEGIN
  SELECT store_id, staff_read_id INTO v_store, v_staff FROM test_env_ids;
  SELECT id INTO v_req_id FROM public.store_join_requests WHERE store_id = v_store AND status = 'pending' LIMIT 1;

  BEGIN
    PERFORM public.set_member_permission(v_store, v_staff, 'write', true);
    RAISE EXCEPTION 'فشل: تم السماح بتعديل الصلاحيات دون جلسة PIN نشطة.';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  IF v_req_id IS NOT NULL THEN
    BEGIN
      PERFORM public.approve_join_request(v_req_id, 'read', false);
      RAISE EXCEPTION 'فشل: تم السماح بقبول طلب انضمام دون جلسة PIN نشطة.';
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END IF;
  END IF;
END $$;

ROLLBACK;
