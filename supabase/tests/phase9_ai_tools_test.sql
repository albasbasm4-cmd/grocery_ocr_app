BEGIN;
-- =============================================================================
-- اختبارات المرحلة 9: التحقق من أمان أدوات الذكاء الاصطناعي وعزل الأدوار والمتاجر
-- =============================================================================

DO $$
DECLARE
  v_store1 UUID;
  v_store2 UUID;
  v_owner1 UUID := gen_random_uuid();
  v_staff1 UUID := gen_random_uuid();
  v_owner2 UUID := gen_random_uuid();
  v_cat1 UUID;
  v_p1 UUID;
  v_res JSONB;
  v_rate JSONB;
  v_i INTEGER;
BEGIN
  -- 1. إنشاء متجرين وعضوية المالكين والموظف
  INSERT INTO public.stores(name, currency_code, currency_symbol)
  VALUES ('متجر الاختبار 1', 'SAR', 'ر.س') RETURNING id INTO v_store1;

  INSERT INTO public.stores(name, currency_code, currency_symbol)
  VALUES ('متجر الاختبار 2', 'SAR', 'ر.س') RETURNING id INTO v_store2;

  INSERT INTO public.store_members(store_id, user_id, role, is_active)
  VALUES
    (v_store1, v_owner1, 'owner', true),
    (v_store1, v_staff1, 'staff', true),
    (v_store2, v_owner2, 'owner', true);

  -- تصنيف ومنتجات في متجر 1
  INSERT INTO public.categories(store_id, name)
  VALUES (v_store1, 'ألبان') RETURNING id INTO v_cat1;

  INSERT INTO public.products(store_id, category_id, name, barcode, sku_small_text, unit, price, cost_price, stock_quantity, min_stock, is_active)
  VALUES
    (v_store1, v_cat1, 'حليب مراعي', '628100111', 'MILK-1', 'حبة', 10.00, 7.50, 4.000, 10.000, true),
    (v_store1, v_cat1, 'زبادي طازج', '628100222', 'YOG-1', 'حبة', 3.00, 2.00, 15.000, 5.000, true);

  -- 2. اختبار عزل المتاجر: مستخدم متجر 2 لا يستطيع قراءة أدوات متجر 1
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner2::text)::text, true);

  BEGIN
    PERFORM public.ai_get_low_stock(v_store1);
    RAISE EXCEPTION 'خطأ: تم السماح لمستخدم متجر آخر باستدعاء أداة ai_get_low_stock!';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT ILIKE '%مصرح%' AND SQLERRM NOT ILIKE '%صلاحية%' THEN
      RAISE EXCEPTION 'خطأ غير متوقع في فحص العضوية: %', SQLERRM;
    END IF;
  END;

  -- 3. اختبار دور الموظف (staff): لا يحصل على التكلفة أو الأرباح
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff1::text)::text, true);

  -- فحص البحث عن المنتجات للموظف
  v_res := public.ai_search_products(v_store1, 'حليب');
  IF jsonb_array_length(v_res) = 0 THEN
    RAISE EXCEPTION 'فشل البحث عن المنتج للموظف.';
  END IF;
  IF v_res->0 ? 'cost_price' THEN
    RAISE EXCEPTION 'خطأ أمني فادح: ظهر سعر التكلفة cost_price لحساب الموظف في نتائج البحث!';
  END IF;

  -- فحص إجمالي التصنيف للموظف
  v_res := public.ai_get_category_total(v_store1, 'ألبان');
  IF (v_res->>'found')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'فشل العثور على التصنيف للموظف.';
  END IF;
  IF v_res ? 'total_cost_value' THEN
    RAISE EXCEPTION 'خطأ أمني فادح: ظهر إجمالي التكلفة للموظف في ai_get_category_total!';
  END IF;

  -- فحص ملخص المبيعات للموظف
  v_res := public.ai_get_sales_summary(v_store1, current_date, current_date);
  IF v_res ? 'total_cost' OR v_res ? 'total_profit' THEN
    RAISE EXCEPTION 'خطأ أمني فادح: ظهرت التكلفة أو الأرباح للموظف في ai_get_sales_summary!';
  END IF;

  -- 4. اختبار دور المالك (owner): تظهر له التكلفة والقيم المالية
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner1::text)::text, true);

  v_res := public.ai_search_products(v_store1, 'حليب');
  IF NOT (v_res->0 ? 'cost_price') THEN
    RAISE EXCEPTION 'فشل: لم يظهر سعر التكلفة للمالك في ai_search_products.';
  END IF;

  v_res := public.ai_get_category_total(v_store1, 'ألبان');
  IF NOT (v_res ? 'total_cost_value') THEN
    RAISE EXCEPTION 'فشل: لم يظهر إجمالي التكلفة للمالك في ai_get_category_total.';
  END IF;

  -- 5. اختبار حد معدل الاستخدام (Rate Limiting)
  FOR v_i IN 1..5 LOOP
    v_rate := public.check_and_increment_ai_rate_limit(v_store1, 5, 60);
  END LOOP;

  IF (v_rate->>'allowed')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'فشل: كان يجب قبول الطلب الخامس.';
  END IF;

  -- الطلب السادس يجب أن يُرفض
  v_rate := public.check_and_increment_ai_rate_limit(v_store1, 5, 60);
  IF (v_rate->>'allowed')::boolean IS TRUE THEN
    RAISE EXCEPTION 'فشل: كان يجب رفض الطلب السادس لتجاوز حد الاستخدام!';
  END IF;

  RAISE NOTICE 'نجحت جميع اختبارات المرحلة 9 لأمان وعزل أدوات الذكاء الاصطناعي وحدود الاستخدام بنجاح تام.';
END;
$$;
ROLLBACK;
