-- ==============================================================================
-- المرحلة 7: تحسين دالة الاستيراد الجماعي ودعم تصدير النسخ الاحتياطي الكامل
-- File: supabase/migrations/20261107000012_phase7_bulk_upsert_and_export.sql
-- ==============================================================================

-- 1. تحديث دالة bulk_upsert_products لدعم تاريخ الصلاحية، التصنيفات، والإحصاءات التفصيلية
CREATE OR REPLACE FUNCTION bulk_upsert_products(
    p_store_id UUID,
    p_rows JSONB,
    p_mode TEXT DEFAULT 'skip' -- 'skip' or 'update'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_row JSONB;
    v_row_idx INT := 0;
    v_name TEXT;
    v_barcode TEXT;
    v_sku TEXT;
    v_unit TEXT;
    v_price NUMERIC(14,2);
    v_cost NUMERIC(14,2);
    v_stock NUMERIC(14,3);
    v_min_stock NUMERIC(14,3);
    v_expiry DATE;
    v_expiry_raw TEXT;
    v_category_id UUID;
    v_category_name TEXT;
    v_inserted INT := 0;
    v_updated INT := 0;
    v_skipped INT := 0;
    v_rejected INT := 0;
    v_rejections JSONB := '[]'::JSONB;
    v_existing_id UUID;
    v_old_stock NUMERIC(14,3);
    v_new_product_id UUID;
BEGIN
    -- التحقق من صلاحية المالك وجلسة الـ PIN النشطة
    IF NOT is_store_owner(p_store_id) THEN
        RAISE EXCEPTION 'الاستيراد الجماعي للمنتجات متاح لمالك المتجر فقط.';
    END IF;

    IF NOT has_active_admin_session(p_store_id) THEN
        RAISE EXCEPTION 'يتطلب الاستيراد الجماعي جلسة PIN نشطة للمدير.';
    END IF;

    IF p_mode NOT IN ('skip', 'update') THEN
        RAISE EXCEPTION 'نمط الاستيراد غير صالح: يجب أن يكون skip أو update.';
    END IF;

    FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
    LOOP
        v_row_idx := v_row_idx + 1;
        v_name := trim(coalesce(v_row->>'name', ''));
        v_barcode := nullif(trim(coalesce(v_row->>'barcode', '')), '');
        v_sku := nullif(trim(coalesce(v_row->>'sku_small_text', '')), '');
        v_unit := lower(trim(coalesce(v_row->>'unit', 'piece')));
        
        -- تطبيع الوحدة باللغة العربية إلى القيم المعيارية المعتمدة في CHECK constraint
        IF v_unit IN ('piece', 'حبة', 'حبه', 'قطعة', 'قطعه', 'واحد') THEN
            v_unit := 'piece';
        ELSIF v_unit IN ('kg', 'كيلو', 'كيلوجرام', 'كجم') THEN
            v_unit := 'kg';
        ELSIF v_unit IN ('g', 'غرام', 'جرام', 'غم') THEN
            v_unit := 'g';
        ELSIF v_unit IN ('carton', 'كرتون', 'كرتونة', 'كرتونه') THEN
            v_unit := 'carton';
        ELSIF v_unit IN ('pack', 'باكت', 'بكت', 'باقة', 'باقه') THEN
            v_unit := 'pack';
        ELSIF v_unit IN ('box', 'علبة', 'علبه', 'صندوق') THEN
            v_unit := 'box';
        ELSIF v_unit NOT IN ('piece', 'kg', 'g', 'carton', 'pack', 'box', 'other') THEN
            v_unit := 'other';
        END IF;

        -- قراءة الأرقام مع معالجة القيم الفارغة
        BEGIN
            v_price := (v_row->>'price')::NUMERIC;
        EXCEPTION WHEN OTHERS THEN
            v_price := NULL;
        END;

        BEGIN
            v_cost := coalesce(nullif(v_row->>'cost_price', '')::NUMERIC, 0);
        EXCEPTION WHEN OTHERS THEN
            v_cost := 0;
        END;

        BEGIN
            v_stock := coalesce(nullif(v_row->>'stock_quantity', '')::NUMERIC, 0);
        EXCEPTION WHEN OTHERS THEN
            v_stock := 0;
        END;

        BEGIN
            v_min_stock := coalesce(nullif(v_row->>'min_stock', '')::NUMERIC, 0);
        EXCEPTION WHEN OTHERS THEN
            v_min_stock := 0;
        END;

        -- قراءة تاريخ الصلاحية إن وُجد
        v_expiry_raw := nullif(trim(coalesce(v_row->>'expiry_date', '')), '');
        v_expiry := NULL;
        IF v_expiry_raw IS NOT NULL THEN
            BEGIN
                v_expiry := v_expiry_raw::DATE;
            EXCEPTION WHEN OTHERS THEN
                v_expiry := NULL;
            END;
        END IF;

        -- قراءة معرف التصنيف أو مطابقته بالاسم
        v_category_id := NULL;
        IF nullif(trim(coalesce(v_row->>'category_id', '')), '') IS NOT NULL THEN
            BEGIN
                v_category_id := (v_row->>'category_id')::UUID;
            EXCEPTION WHEN OTHERS THEN
                v_category_id := NULL;
            END;
        END IF;

        IF v_category_id IS NULL THEN
            v_category_name := nullif(trim(coalesce(v_row->>'category_name', v_row->>'category', '')), '');
            IF v_category_name IS NOT NULL THEN
                SELECT id INTO v_category_id
                FROM categories
                WHERE store_id = p_store_id AND name_normalized = normalize_arabic(v_category_name)
                LIMIT 1;
            END IF;
        END IF;

        -- التحقق من صحة البيانات الإلزامية
        IF v_name = '' THEN
            v_rejected := v_rejected + 1;
            v_rejections := v_rejections || jsonb_build_object(
                'row_index', v_row_idx,
                'name', v_name,
                'barcode', coalesce(v_barcode, ''),
                'reason', 'اسم المنتج إلزامي ومفقود'
            );
            CONTINUE;
        END IF;

        IF v_price IS NULL OR v_price < 0 THEN
            v_rejected := v_rejected + 1;
            v_rejections := v_rejections || jsonb_build_object(
                'row_index', v_row_idx,
                'name', v_name,
                'barcode', coalesce(v_barcode, ''),
                'reason', 'سعر البيع غير صالح أو أقل من الصفر'
            );
            CONTINUE;
        END IF;

        IF v_cost < 0 THEN
            v_rejected := v_rejected + 1;
            v_rejections := v_rejections || jsonb_build_object(
                'row_index', v_row_idx,
                'name', v_name,
                'barcode', coalesce(v_barcode, ''),
                'reason', 'سعر الشراء/التكلفة لا يمكن أن يكون سالباً'
            );
            CONTINUE;
        END IF;

        IF v_stock < 0 THEN
            v_rejected := v_rejected + 1;
            v_rejections := v_rejections || jsonb_build_object(
                'row_index', v_row_idx,
                'name', v_name,
                'barcode', coalesce(v_barcode, ''),
                'reason', 'كمية المخزون لا يمكن أن تكون سالبة'
            );
            CONTINUE;
        END IF;

        IF v_min_stock < 0 THEN
            v_rejected := v_rejected + 1;
            v_rejections := v_rejections || jsonb_build_object(
                'row_index', v_row_idx,
                'name', v_name,
                'barcode', coalesce(v_barcode, ''),
                'reason', 'الحد الأدنى للمخزون لا يمكن أن يكون سالباً'
            );
            CONTINUE;
        END IF;

        -- فحص تعارض الباركود داخل المتجر
        v_existing_id := NULL;
        v_old_stock := 0;
        IF v_barcode IS NOT NULL THEN
            SELECT id, stock_quantity INTO v_existing_id, v_old_stock
            FROM products
            WHERE store_id = p_store_id AND barcode = v_barcode;
        END IF;

        IF v_existing_id IS NOT NULL THEN
            IF p_mode = 'skip' THEN
                v_skipped := v_skipped + 1;
                v_rejections := v_rejections || jsonb_build_object(
                    'row_index', v_row_idx,
                    'name', v_name,
                    'barcode', v_barcode,
                    'reason', 'الباركود مسجل مسبقاً (تم التخطي حسب اختيار نمط التخطي)'
                );
                CONTINUE;
            ELSIF p_mode = 'update' THEN
                UPDATE products
                SET name = v_name,
                    sku_small_text = coalesce(v_sku, sku_small_text),
                    unit = v_unit,
                    price = v_price,
                    cost_price = v_cost,
                    stock_quantity = v_stock,
                    min_stock = v_min_stock,
                    category_id = coalesce(v_category_id, category_id),
                    expiry_date = coalesce(v_expiry, expiry_date),
                    is_active = TRUE,
                    updated_at = now()
                WHERE id = v_existing_id;

                -- تسجيل حركة مخزون تسوية إذا تغيّرت الكمية
                IF v_stock <> v_old_stock THEN
                    INSERT INTO stock_movements (
                        store_id, product_id, type, quantity_delta,
                        reference_id, note, created_by
                    )
                    VALUES (
                        p_store_id, v_existing_id, 'adjustment', v_stock - v_old_stock,
                        NULL, 'تحديث كمية عبر الاستيراد الجماعي للمنتجات', auth.uid()
                    );
                END IF;

                v_updated := v_updated + 1;
                CONTINUE;
            END IF;
        END IF;

        -- إدراج منتج جديد
        INSERT INTO products (
            store_id, category_id, name, barcode, sku_small_text,
            unit, price, cost_price, stock_quantity, min_stock, expiry_date
        )
        VALUES (
            p_store_id, v_category_id, v_name, v_barcode, v_sku,
            v_unit, v_price, v_cost, v_stock, v_min_stock, v_expiry
        )
        RETURNING id INTO v_new_product_id;

        -- تسجيل حركة مخزون رصيد افتتاحي إذا كانت الكمية أكبر من 0
        IF v_stock > 0 THEN
            INSERT INTO stock_movements (
                store_id, product_id, type, quantity_delta,
                reference_id, note, created_by
            )
            VALUES (
                p_store_id, v_new_product_id, 'purchase', v_stock,
                NULL, 'رصيد افتتاحي عبر الاستيراد الجماعي للمنتجات', auth.uid()
            );
        END IF;

        v_inserted := v_inserted + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'accepted_count', v_inserted + v_updated,
        'inserted_count', v_inserted,
        'updated_count', v_updated,
        'skipped_count', v_skipped,
        'rejected_count', v_rejected,
        'rejections', v_rejections
    );
END;
$$;

-- 2. دالة تصدير نسخة احتياطية كاملة للمتجر (للمالك مع رمز PIN)
CREATE OR REPLACE FUNCTION export_full_store_backup(p_store_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_store JSONB;
    v_categories JSONB;
    v_products JSONB;
    v_customers JSONB;
    v_sales JSONB;
    v_stock_movements JSONB;
    v_customer_payments JSONB;
BEGIN
    -- التحقق من صلاحية المالك وجلسة الـ PIN النشطة
    IF NOT is_store_owner(p_store_id) THEN
        RAISE EXCEPTION 'تصدير النسخة الاحتياطية الكاملة متاح لمالك المتجر فقط.';
    END IF;

    IF NOT has_active_admin_session(p_store_id) THEN
        RAISE EXCEPTION 'يتطلب تصدير النسخة الاحتياطية جلسة PIN نشطة للمدير.';
    END IF;

    -- بيانات المتجر
    SELECT to_jsonb(s) INTO v_store FROM stores s WHERE s.id = p_store_id;

    -- التصنيفات
    SELECT coalesce(jsonb_agg(to_jsonb(c)), '[]'::JSONB) INTO v_categories
    FROM categories c WHERE c.store_id = p_store_id;

    -- المنتجات (تشمل التكلفة للمالك)
    SELECT coalesce(jsonb_agg(to_jsonb(p)), '[]'::JSONB) INTO v_products
    FROM products p WHERE p.store_id = p_store_id;

    -- العملاء
    SELECT coalesce(jsonb_agg(to_jsonb(cu)), '[]'::JSONB) INTO v_customers
    FROM customers cu WHERE cu.store_id = p_store_id;

    -- الفواتير مع بنودها
    SELECT coalesce(jsonb_agg(
        to_jsonb(sa) || jsonb_build_object(
            'items', (
                SELECT coalesce(jsonb_agg(to_jsonb(si)), '[]'::JSONB)
                FROM sale_items si WHERE si.sale_id = sa.id
            )
        )
    ), '[]'::JSONB) INTO v_sales
    FROM sales sa WHERE sa.store_id = p_store_id;

    -- حركات المخزون
    SELECT coalesce(jsonb_agg(to_jsonb(sm)), '[]'::JSONB) INTO v_stock_movements
    FROM (
        SELECT * FROM stock_movements WHERE store_id = p_store_id
        ORDER BY created_at DESC LIMIT 5000
    ) sm;

    -- دفعات سداد العملاء
    SELECT coalesce(jsonb_agg(to_jsonb(cp)), '[]'::JSONB) INTO v_customer_payments
    FROM customer_payments cp WHERE cp.store_id = p_store_id;

    RETURN jsonb_build_object(
        'version', '1.0',
        'app', 'grocery_ocr_app',
        'exported_at', now(),
        'store', v_store,
        'categories', v_categories,
        'products', v_products,
        'customers', v_customers,
        'sales', v_sales,
        'stock_movements', v_stock_movements,
        'customer_payments', v_customer_payments
    );
END;
$$;
