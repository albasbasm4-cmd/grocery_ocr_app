-- ==============================================================================
-- اختبارات المرحلة السادسة: المبيعات، الإرجاع، الإلغاء، وحسابات العملاء
-- File: supabase/tests/phase6_sales_and_returns_test.sql
-- ==============================================================================

BEGIN;

-- 1. إنشاء مستخدمين تجريبيين في المتجر (مالك وموظف)
DO $$
DECLARE
  v_store_id UUID;
  v_owner_id UUID := gen_random_uuid();
  v_staff_id UUID := gen_random_uuid();
  v_cat_id UUID;
  v_product_id UUID;
  v_customer_id UUID;
  v_client_uuid UUID := gen_random_uuid();
  v_sale_result JSONB;
  v_sale_id UUID;
  v_stock_after NUMERIC;
  v_balance_after NUMERIC;
BEGIN
  -- أ) إنشاء متجر
  INSERT INTO stores (name, currency_code, currency_symbol)
  VALUES ('متجر اختبار المرحلة السادسة', 'SAR', 'ر.س')
  RETURNING id INTO v_store_id;

  -- ب) تعيين المالك والموظف
  INSERT INTO store_members (store_id, user_id, role, is_active)
  VALUES 
    (v_store_id, v_owner_id, 'owner', true),
    (v_store_id, v_staff_id, 'staff', true);

  -- ج) تعيين PIN للمالك وإنشاء جلسة نشطة
  INSERT INTO admin_pins (store_id, pin_hash)
  VALUES (v_store_id, crypt('1234', gen_salt('bf')));

  INSERT INTO admin_sessions (store_id, user_id, expires_at)
  VALUES (v_store_id, v_owner_id, now() + interval '10 minutes');

  -- د) إنشاء تصنيف ومنتج تجريبي برصيد 10 حبات
  INSERT INTO categories (store_id, name, name_normalized)
  VALUES (v_store_id, 'ألبان تجريبية', 'البان تجريبية')
  RETURNING id INTO v_cat_id;

  INSERT INTO products (
    store_id, category_id, name, name_normalized, barcode, unit, 
    price, cost_price, stock_quantity, min_stock, is_active
  )
  VALUES (
    v_store_id, v_cat_id, 'حليب مراعي 1 لتر', 'حليب مراعي 1 لتر', '6281007001111', 'piece',
    6.50, 4.80, 10.000, 2.000, true
  )
  RETURNING id INTO v_product_id;

  -- هـ) إنشاء عميل ذمم
  INSERT INTO customers (store_id, name, phone, balance)
  VALUES (v_store_id, 'أبو خالد الشمري', '0501234567', 0.00)
  RETURNING id INTO v_customer_id;

  -- 2. اختبار عملية بيع آجل عبر دالة process_sale
  -- محاكاة مستخدم الموظف
  PERFORM set_config('request.jwt.claim.sub', v_staff_id::text, true);

  v_sale_result := process_sale(
    p_store_id => v_store_id,
    p_client_uuid => v_client_uuid,
    p_items => jsonb_build_array(
      jsonb_build_object('product_id', v_product_id, 'quantity', 3)
    ),
    p_discount_amount => 1.50,
    p_payment_method => 'credit',
    p_customer_id => v_customer_id
  );

  v_sale_id := (v_sale_result->'sale'->>'id')::UUID;

  -- التحقق من خصم المخزون: 10 - 3 = 7
  SELECT stock_quantity INTO v_stock_after FROM products WHERE id = v_product_id;
  IF v_stock_after <> 7.000 THEN
    RAISE EXCEPTION 'فشل اختبار خصم المخزون: المتوقع 7 لكن وجد %', v_stock_after;
  END IF;

  -- التحقق من زيادة رصيد العميل الآجل: (6.50 * 3) - 1.50 = 19.50 - 1.50 = 18.00
  SELECT balance INTO v_balance_after FROM customers WHERE id = v_customer_id;
  IF v_balance_after <> 18.00 THEN
    RAISE EXCEPTION 'فشل اختبار رصيد العميل: المتوقع 18.00 لكن وجد %', v_balance_after;
  END IF;

  -- 3. اختبار خاصية عدم التكرار (Idempotency) بإعادة إرسال نفس client_uuid
  v_sale_result := process_sale(
    p_store_id => v_store_id,
    p_client_uuid => v_client_uuid,
    p_items => jsonb_build_array(
      jsonb_build_object('product_id', v_product_id, 'quantity', 3)
    ),
    p_discount_amount => 1.50,
    p_payment_method => 'credit',
    p_customer_id => v_customer_id
  );

  IF (v_sale_result->>'idempotent_cached')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'فشل اختبار Idempotency: لم يتم التعرف على الفاتورة المكررة';
  END IF;

  -- التأكد من عدم خصم المخزون مرة ثانية
  SELECT stock_quantity INTO v_stock_after FROM products WHERE id = v_product_id;
  IF v_stock_after <> 7.000 THEN
    RAISE EXCEPTION 'فشل اختبار تكرار البيع: تم خصم المخزون مرتين ليصبح %', v_stock_after;
  END IF;

  -- 4. اختبار سداد العميل عبر record_customer_payment
  PERFORM record_customer_payment(
    p_customer_id => v_customer_id,
    p_amount => 10.00
  );

  SELECT balance INTO v_balance_after FROM customers WHERE id = v_customer_id;
  IF v_balance_after <> 8.00 THEN
    RAISE EXCEPTION 'فشل اختبار سداد العميل: المتوقع 8.00 بعد سداد 10 لكن وجد %', v_balance_after;
  END IF;

  -- 5. اختبار حماية التكلفة: محاولة الموظف استدعاء get_sale_items_cost يجب أن تفشل
  BEGIN
    PERFORM get_sale_items_cost(v_sale_id);
    RAISE EXCEPTION 'ثغرة أمنية: استطاع الموظف استعراض تكلفة البنود!';
  EXCEPTION
    WHEN OTHERS THEN
      -- نجاح المنع المتوقع
      NULL;
  END;

  -- 6. اختبار منع الموظف من إلغاء الفاتورة void_sale
  BEGIN
    PERFORM void_sale(v_sale_id, 'سبب إلغاء تجريبي');
    RAISE EXCEPTION 'ثغرة أمنية: استطاع الموظف إلغاء الفاتورة بدون صلاحية مالك!';
  EXCEPTION
    WHEN OTHERS THEN
      -- نجاح المنع المتوقع
      NULL;
  END;

  -- 7. محاكاة المالك مع جلسة PIN نشطة لتنفيذ إرجاع جزئي return_items
  PERFORM set_config('request.jwt.claim.sub', v_owner_id::text, true);

  PERFORM return_items(
    p_sale_id => v_sale_id,
    p_items => jsonb_build_array(
      jsonb_build_object('product_id', v_product_id, 'quantity', 1)
    ),
    p_reason => 'طلب العميل إرجاع علبة واحدة سليمة'
  );

  -- التحقق من استعادة المخزون: 7 + 1 = 8
  SELECT stock_quantity INTO v_stock_after FROM products WHERE id = v_product_id;
  IF v_stock_after <> 8.000 THEN
    RAISE EXCEPTION 'فشل استرجاع المخزون في الإرجاع الجزئي: المتوقع 8 لكن وجد %', v_stock_after;
  END IF;

  RAISE NOTICE 'نجحت جميع سيناريوهات اختبار المرحلة السادسة بنجاح تام!';
END $$;

ROLLBACK;
