-- =====================================================================
-- ملف الاختبارات البرمجية لقاعدة البيانات (Database Automated Test Scenarios)
-- Grocery POS & Inventory - Phase 1 Database Validation Suite
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. اختبار دالة التطبيع العربي (normalize_arabic)
-- ---------------------------------------------------------------------
DO $$
DECLARE
    v_sample TEXT := '  أرز بَسْمَتِيّ مَمْتَاز ١٠ كجم ـ  ';
    v_normalized TEXT;
BEGIN
    v_normalized := normalize_arabic(v_sample);
    -- النتيجة المتوقعة: إزالة التشكيل، أ -> ا، ة -> ه، ١٠ -> 10، إزالة الكشيدة، تقليم المسافات
    IF v_normalized <> 'ارز بسمتي ممتاز 10 كجم' THEN
        RAISE EXCEPTION 'فشل اختبار normalize_arabic: القيمة الناتجة هي "%"', v_normalized;
    END IF;
    RAISE NOTICE '✅ نجح اختبار normalize_arabic بنجاح.';
END $$;

-- ---------------------------------------------------------------------
-- 2. إعداد بيئة اختبار لمتجرين ومستخدمين وهميين لاختبار العزل التام
-- ---------------------------------------------------------------------
DO $$
DECLARE
    v_user_a UUID := gen_random_uuid();
    v_user_b UUID := gen_random_uuid();
    v_store_a UUID;
    v_store_b UUID;
    v_cat_a UUID;
    v_prod_a UUID;
    v_client_uuid UUID := gen_random_uuid();
    v_sale_result JSONB;
BEGIN
    -- محاكاة إنشاء متجر أ
    INSERT INTO stores (name, currency_code, currency_symbol)
    VALUES ('بقالة الأمانة', 'SAR', 'ر.س')
    RETURNING id INTO v_store_a;

    INSERT INTO store_members (store_id, user_id, role)
    VALUES (v_store_a, v_user_a, 'owner');

    -- محاكاة إنشاء متجر ب
    INSERT INTO stores (name, currency_code, currency_symbol)
    VALUES ('بقالة المستقبل', 'SAR', 'ر.س')
    RETURNING id INTO v_store_b;

    INSERT INTO store_members (store_id, user_id, role)
    VALUES (v_store_b, v_user_b, 'owner');

    -- إضافة تصنيف ومنتج للمتجر أ
    INSERT INTO categories (store_id, name)
    VALUES (v_store_a, 'ألبان وأجبان')
    RETURNING id INTO v_cat_a;

    INSERT INTO products (store_id, category_id, name, barcode, price, cost_price, stock_quantity, min_stock)
    VALUES (v_store_a, v_cat_a, 'حليب المراعي طازج 1 لتر', '628100700001', 6.50, 4.80, 20.000, 5.000)
    RETURNING id INTO v_prod_a;

    -- -----------------------------------------------------------------
    -- اختبار أ: التحقق من التريجر التلقائي للتطبيع
    -- -----------------------------------------------------------------
    IF NOT EXISTS (
        SELECT 1 FROM products
        WHERE id = v_prod_a AND name_normalized = 'حليب المراعي طازج 1 لتر'
    ) THEN
        RAISE EXCEPTION 'فشل اختبار تريجر التطبيع العربي للمنتجات.';
    END IF;
    RAISE NOTICE '✅ نجح اختبار تريجر التطبيع العربي.';

    -- -----------------------------------------------------------------
    -- اختبار ب: عزل البيانات بين المتجرين
    -- -----------------------------------------------------------------
    IF EXISTS (
        SELECT 1 FROM products WHERE store_id = v_store_b AND id = v_prod_a
    ) THEN
        RAISE EXCEPTION 'فشل العزل: منتج المتجر أ ظهر ضمن المتجر ب!';
    END IF;
    RAISE NOTICE '✅ نجح اختبار العزل بين المتاجر.';

    -- -----------------------------------------------------------------
    -- اختبار ج: التحقق من عملية بيع سليمة وخصم المخزون
    -- -----------------------------------------------------------------
    -- تعيين المستخدم أ كمستخدم نشط مؤقتاً لمحاكاة auth.uid()
    PERFORM set_config('request.jwt.claim.sub', v_user_a::TEXT, true);

    -- استدعاء عملية البيع لـ 3 حبات حليب
    SELECT process_sale(
        v_store_a,
        v_client_uuid,
        jsonb_build_array(
            jsonb_build_object('product_id', v_prod_a, 'quantity', 3.000)
        ),
        0,
        'cash',
        NULL
    ) INTO v_sale_result;

    -- التحقق من خصم المخزون: 20 - 3 = 17
    IF (SELECT stock_quantity FROM products WHERE id = v_prod_a) <> 17.000 THEN
        RAISE EXCEPTION 'فشل خصم المخزون التلقائي بعد البيع.';
    END IF;

    -- التحقق من تسجيل حركة المخزون
    IF NOT EXISTS (
        SELECT 1 FROM stock_movements
        WHERE product_id = v_prod_a AND type = 'sale' AND quantity_delta = -3.000
    ) THEN
        RAISE EXCEPTION 'فشل تسجيل حركة المخزون في stock_movements.';
    END IF;
    RAISE NOTICE '✅ نجح اختبار عملية البيع وخصم المخزون وتسجيل الحركات.';

    -- -----------------------------------------------------------------
    -- اختبار د: خاصية Idempotency (إعادة إرسال نفس client_uuid)
    -- -----------------------------------------------------------------
    SELECT process_sale(
        v_store_a,
        v_client_uuid,
        jsonb_build_array(
            jsonb_build_object('product_id', v_prod_a, 'quantity', 3.000)
        ),
        0,
        'cash',
        NULL
    ) INTO v_sale_result;

    IF (v_sale_result->>'idempotent_cached')::BOOLEAN IS NOT TRUE THEN
        RAISE EXCEPTION 'فشل اختبار Idempotency: تمت إعادة المعالجة بدلاً من استرجاع الفاتورة السابقة!';
    END IF;

    -- التأكد أن المخزون لم يُخصم مرة ثانية
    IF (SELECT stock_quantity FROM products WHERE id = v_prod_a) <> 17.000 THEN
        RAISE EXCEPTION 'فشل: تم خصم المخزون مرتين عند تكرار client_uuid!';
    END IF;
    RAISE NOTICE '✅ نجح اختبار Idempotency لمنع التكرار.';

    -- -----------------------------------------------------------------
    -- اختبار هـ: رفض بيع كمية أكبر من المخزون
    -- -----------------------------------------------------------------
    BEGIN
        PERFORM process_sale(
            v_store_a,
            gen_random_uuid(),
            jsonb_build_array(
                jsonb_build_object('product_id', v_prod_a, 'quantity', 999.000)
            ),
            0,
            'cash',
            NULL
        );
        RAISE EXCEPTION 'فشل: سمح النظام ببيع كمية أكبر من المخزون!';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%المخزون غير كافٍ%' THEN
            RAISE NOTICE '✅ نجح اختبار رفض البيع عند عدم كفاية المخزون: %', SQLERRM;
        ELSE
            RAISE EXCEPTION 'خطأ غير متوقع أثناء فحص المخزون: %', SQLERRM;
        END IF;
    END;

END $$;

-- إرجاع التغييرات لضمان بقاء قاعدة بيانات الاختبار نظيفة
ROLLBACK;
