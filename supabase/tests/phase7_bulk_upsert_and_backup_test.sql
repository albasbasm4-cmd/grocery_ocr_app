-- ============================================================================
-- Phase 7 Test: Bulk Upsert & Full Store Backup Security & Idempotency
-- ============================================================================

DO $$
DECLARE
  v_owner_id uuid := '11111111-7777-4444-8888-111111111111';
  v_staff_id uuid := '22222222-7777-4444-8888-222222222222';
  v_store_id uuid;
  v_res jsonb;
  v_backup jsonb;
  v_prod_count integer;
BEGIN
  -- 1. Setup store
  INSERT INTO public.stores (name, currency_code, currency_symbol)
  VALUES ('متجر اختبار الاستيراد والتصدير', 'SAR', 'ر.س')
  RETURNING id INTO v_store_id;

  INSERT INTO public.store_members (store_id, user_id, role)
  VALUES (v_store_id, v_owner_id, 'owner');

  INSERT INTO public.store_members (store_id, user_id, role)
  VALUES (v_store_id, v_staff_id, 'staff');

  -- Admin PIN setup
  INSERT INTO public.admin_pins (store_id, pin_hash, failed_attempts)
  VALUES (v_store_id, extensions.crypt('1234', extensions.gen_salt('bf')), 0);

  -- 2. Staff attempting bulk upsert should be REJECTED
  EXECUTE 'SET LOCAL request.jwt.claim.sub = ''' || v_staff_id || '''';
  BEGIN
    SELECT public.bulk_upsert_products(
      v_store_id,
      jsonb_build_array(jsonb_build_object('name', 'منتج غير مصرح', 'price', 10)),
      'skip'
    ) INTO v_res;
    RAISE EXCEPTION 'UNEXPECTED_SUCCESS: Staff was able to bulk upsert';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'UNEXPECTED_SUCCESS%' THEN RAISE; END IF;
    -- Expected error: staff not authorized
  END;

  -- 3. Owner without active PIN should be REJECTED
  EXECUTE 'SET LOCAL request.jwt.claim.sub = ''' || v_owner_id || '''';
  BEGIN
    SELECT public.bulk_upsert_products(
      v_store_id,
      jsonb_build_array(jsonb_build_object('name', 'منتج بدون PIN', 'price', 10)),
      'skip'
    ) INTO v_res;
    RAISE EXCEPTION 'UNEXPECTED_SUCCESS: Owner without PIN was able to bulk upsert';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'UNEXPECTED_SUCCESS%' THEN RAISE; END IF;
    -- Expected error: active pin session required
  END;

  -- 4. Create active PIN session for owner
  INSERT INTO public.admin_sessions (store_id, user_id, expires_at)
  VALUES (v_store_id, v_owner_id, now() + interval '10 minutes');

  -- 5. Bulk insert with valid and invalid rows
  SELECT public.bulk_upsert_products(
    v_store_id,
    jsonb_build_array(
      -- Valid row 1
      jsonb_build_object(
        'name', 'أرز مصري فاخر 5 كجم',
        'barcode', '628100112233',
        'unit', 'piece',
        'price', 35.50,
        'cost_price', 28.00,
        'stock_quantity', 50,
        'min_stock', 5,
        'expiry_date', '2027-01-01'
      ),
      -- Valid row 2
      jsonb_build_object(
        'name', 'حليب كامل الدسم 1 لتر',
        'barcode', '628100112244',
        'unit', 'piece',
        'price', 6.00,
        'cost_price', 4.50,
        'stock_quantity', 100,
        'min_stock', 10
      ),
      -- Invalid row: missing name
      jsonb_build_object(
        'barcode', '628100112255',
        'price', 15.00
      ),
      -- Invalid row: negative price
      jsonb_build_object(
        'name', 'زيت نباتي',
        'price', -10.00
      )
    ),
    'skip'
  ) INTO v_res;

  ASSERT (v_res->>'inserted_count')::int = 2, 'Expected 2 inserted rows, got ' || (v_res->>'inserted_count');
  ASSERT (v_res->>'rejected_count')::int = 2, 'Expected 2 rejected rows, got ' || (v_res->>'rejected_count');

  -- 6. Test 'skip' mode on existing barcode
  SELECT public.bulk_upsert_products(
    v_store_id,
    jsonb_build_array(
      jsonb_build_object(
        'name', 'أرز مصري معدل (يجب تخطيه)',
        'barcode', '628100112233',
        'price', 40.00
      )
    ),
    'skip'
  ) INTO v_res;

  ASSERT (v_res->>'skipped_count')::int = 1, 'Expected 1 skipped row, got ' || (v_res->>'skipped_count');
  ASSERT (v_res->>'inserted_count')::int = 0, 'Expected 0 inserted rows';

  -- 7. Test 'update' mode on existing barcode
  SELECT public.bulk_upsert_products(
    v_store_id,
    jsonb_build_array(
      jsonb_build_object(
        'name', 'أرز مصري فاخر 5 كجم - تحديث السعر',
        'barcode', '628100112233',
        'price', 39.50,
        'stock_quantity', 70
      )
    ),
    'update'
  ) INTO v_res;

  ASSERT (v_res->>'updated_count')::int = 1, 'Expected 1 updated row, got ' || (v_res->>'updated_count');

  -- Verify product updated price
  SELECT count(*) INTO v_prod_count FROM public.products
  WHERE store_id = v_store_id AND barcode = '628100112233' AND price = 39.50 AND stock_quantity = 70;
  ASSERT v_prod_count = 1, 'Product price was not updated correctly in database';

  -- 8. Test full store backup RPC
  SELECT public.export_full_store_backup(v_store_id) INTO v_backup;
  ASSERT v_backup->'store'->>'name' = 'متجر اختبار الاستيراد والتصدير', 'Store name mismatch in backup';
  ASSERT jsonb_array_length(v_backup->'products') = 2, 'Expected 2 products in backup';

  -- Clean up test records
  DELETE FROM public.stores WHERE id = v_store_id;

  RAISE NOTICE 'Phase 7 Bulk Upsert and Backup tests passed successfully.';
END $$;
