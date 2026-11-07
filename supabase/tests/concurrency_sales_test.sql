-- ==============================================================================
-- اختبار التزامن والأمان المالي (Database Concurrency & Idempotency Test)
-- يوثّق ويفحص قيود التزامن وحماية المخزون من الأرقام السالبة وخاصية Idempotency
-- للمحاكاة الكاملة بجلستين متوازيتين في نفس اللحظة: استخدم concurrency_sales_test.sh
-- ==============================================================================

BEGIN;

DO $$
DECLARE
    v_user_id UUID := gen_random_uuid();
    v_store_id UUID;
    v_cat_id UUID;
    v_prod_id UUID;
    v_client_uuid1 UUID := gen_random_uuid();
    v_client_uuid2 UUID := gen_random_uuid();
    v_sale_res1 JSONB;
    v_sale_res2 JSONB;
    v_current_stock NUMERIC;
    v_movement_count INT;
    v_sales_count INT;
    v_caught_exception BOOLEAN := FALSE;
BEGIN
    -- 1. إعداد متجر ومستخدم وصلاحية PIN
    INSERT INTO auth.users (id, email) VALUES (v_user_id, 'sql_concurrency@test.local');
    INSERT INTO stores (name, currency_code, currency_symbol) VALUES ('متجر فحص التزامن SQL', 'SAR', 'ر.س') RETURNING id INTO v_store_id;
    INSERT INTO store_members (store_id, user_id, role, is_active) VALUES (v_store_id, v_user_id, 'owner', true);
    INSERT INTO admin_sessions (store_id, user_id, expires_at) VALUES (v_store_id, v_user_id, now() + interval '2 hours');

    SELECT id INTO v_cat_id FROM categories WHERE store_id = v_store_id LIMIT 1;
    IF v_cat_id IS NULL THEN
        INSERT INTO categories (store_id, name) VALUES (v_store_id, 'تصنيف التزامن SQL') RETURNING id INTO v_cat_id;
    END IF;

    -- ضبط سياق المصادقة
    PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);

    -- 2. إعداد منتج برصيد 5 قطع
    INSERT INTO products (store_id, category_id, name, barcode, price, cost_price, stock_quantity, min_stock, is_active)
    VALUES (v_store_id, v_cat_id, 'منتج فحص التزامن SQL', '628999000999', 25.00, 18.00, 5.000, 1.000, true)
    RETURNING id INTO v_prod_id;

    -- 3. تنفيذ عملية بيع أولى لكمية 3
    v_sale_res1 := process_sale(
        v_store_id,
        v_client_uuid1,
        jsonb_build_array(jsonb_build_object('product_id', v_prod_id, 'quantity', 3, 'unit_price', 25.00)),
        0,
        'cash'
    );

    IF (v_sale_res1->>'idempotent_cached')::BOOLEAN <> FALSE THEN
        RAISE EXCEPTION 'فشل: البيعة الأولى يجب ألا تكون مخزنة مسبقاً.';
    END IF;

    -- التحقق من نقص المخزون إلى 2
    SELECT stock_quantity INTO v_current_stock FROM products WHERE id = v_prod_id;
    IF v_current_stock <> 2.000 THEN
        RAISE EXCEPTION 'فشل: المخزون بعد البيعة الأولى يجب أن يكون 2.000 بدلاً من %', v_current_stock;
    END IF;

    -- 4. محاولة تنفيذ بيعة ثانية بكمية 3 (المتاح 2 فقط) -> يجب أن تُرفض بخطأ نقص المخزون
    BEGIN
        v_sale_res2 := process_sale(
            v_store_id,
            v_client_uuid2,
            jsonb_build_array(jsonb_build_object('product_id', v_prod_id, 'quantity', 3, 'unit_price', 25.00)),
            0,
            'cash'
        );
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%المخزون غير كافٍ%' THEN
            RAISE EXCEPTION 'فشل: الخطأ المستلم ليس نقص المخزون المتوقع: %', SQLERRM;
        END IF;
        v_caught_exception := TRUE;
    END;

    IF NOT v_caught_exception THEN
        RAISE EXCEPTION 'فشل خطير: تم قبول بيع كمية تتجاوز المخزون المتاح!';
    END IF;

    -- التأكد من بقاء المخزون 2 وعدم نزوله إلى سالب
    SELECT stock_quantity INTO v_current_stock FROM products WHERE id = v_prod_id;
    IF v_current_stock <> 2.000 THEN
        RAISE EXCEPTION 'فشل خطير: تحول المخزون إلى قيمة سالبة أو غير متوقعة: %', v_current_stock;
    END IF;

    -- التأكد من وجود حركة بيع واحدة فقط في stock_movements
    SELECT count(*) INTO v_movement_count FROM stock_movements WHERE product_id = v_prod_id AND type = 'sale';
    IF v_movement_count <> 1 THEN
        RAISE EXCEPTION 'فشل: عدد حركات البيع في stock_movements يجب أن يكون 1 بدلاً من %', v_movement_count;
    END IF;

    -- 5. فحص خاصية Idempotency (إعادة استدعاء process_sale بنفس client_uuid1)
    v_sale_res2 := process_sale(
        v_store_id,
        v_client_uuid1,
        jsonb_build_array(jsonb_build_object('product_id', v_prod_id, 'quantity', 3, 'unit_price', 25.00)),
        0,
        'cash'
    );

    IF (v_sale_res2->>'idempotent_cached')::BOOLEAN <> TRUE THEN
        RAISE EXCEPTION 'فشل: الاستدعاء المتكرر بنفس client_uuid لم يُرجع idempotent_cached = true';
    END IF;

    -- التحقق من عدم تكرار خصم المخزون
    SELECT stock_quantity INTO v_current_stock FROM products WHERE id = v_prod_id;
    IF v_current_stock <> 2.000 THEN
        RAISE EXCEPTION 'فشل: تم خصم المخزون مرتين عند تكرار client_uuid! المخزون: %', v_current_stock;
    END IF;

    SELECT count(*) INTO v_sales_count FROM sales WHERE store_id = v_store_id AND client_uuid = v_client_uuid1;
    IF v_sales_count <> 1 THEN
        RAISE EXCEPTION 'فشل: تكرر إنشاء الفاتورة في جدول sales!';
    END IF;

    RAISE NOTICE '✅ نجحت جميع فحوصات قفل المخزون و Idempotency في database test بنجاح تام.';
END $$;

ROLLBACK;
