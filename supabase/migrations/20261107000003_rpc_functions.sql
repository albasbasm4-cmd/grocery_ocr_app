-- =====================================================================
-- المهاجرة 3: دوال الـ RPC للعمليات الذرية وإدارة المخزون والـ PIN
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. إنشاء متجر جديد (create_store)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_store(
    p_name TEXT,
    p_currency_code TEXT DEFAULT 'SAR',
    p_currency_symbol TEXT DEFAULT 'ر.س'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_store stores%ROWTYPE;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'يجب تسجيل الدخول لإنشاء متجر جديد.';
    END IF;

    IF trim(p_name) = '' THEN
        RAISE EXCEPTION 'اسم المتجر لا يمكن أن يكون فارغاً.';
    END IF;

    -- إنشاء المتجر
    INSERT INTO stores (name, currency_code, currency_symbol)
    VALUES (trim(p_name), coalesce(p_currency_code, 'SAR'), coalesce(p_currency_symbol, 'ر.س'))
    RETURNING * INTO v_store;

    -- إضافة المنشئ كمالك للمتجر
    INSERT INTO store_members (store_id, user_id, role)
    VALUES (v_store.id, v_user_id, 'owner');

    RETURN to_jsonb(v_store);
END;
$$;

-- ---------------------------------------------------------------------
-- 2. تعيين وتغيير رمز المدير (set_admin_pin)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_admin_pin(
    p_store_id UUID,
    p_new_pin TEXT,
    p_old_pin TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_current_pin admin_pins%ROWTYPE;
BEGIN
    IF NOT is_store_owner(p_store_id) THEN
        RAISE EXCEPTION 'عذراً، تعيين رمز المدير متاح لمالك المتجر فقط.';
    END IF;

    IF length(p_new_pin) < 4 OR length(p_new_pin) > 8 THEN
        RAISE EXCEPTION 'يجب أن يتكون رمز PIN من 4 إلى 8 أرقام.';
    END IF;

    SELECT * INTO v_current_pin
    FROM admin_pins
    WHERE store_id = p_store_id;

    -- إذا كان الرمز موجوداً مسبقاً، يجب التحقق من الرمز القديم أولاً
    IF FOUND THEN
        IF p_old_pin IS NULL OR crypt(p_old_pin, v_current_pin.pin_hash) <> v_current_pin.pin_hash THEN
            RAISE EXCEPTION 'رمز PIN القديم غير صحيح.';
        END IF;

        UPDATE admin_pins
        SET pin_hash = crypt(p_new_pin, gen_salt('bf')),
            failed_attempts = 0,
            locked_until = NULL,
            updated_at = now()
        WHERE store_id = p_store_id;
    ELSE
        INSERT INTO admin_pins (store_id, pin_hash, failed_attempts, locked_until)
        VALUES (p_store_id, crypt(p_new_pin, gen_salt('bf')), 0, NULL);
    END IF;

    RETURN TRUE;
END;
$$;

-- ---------------------------------------------------------------------
-- 3. التحقق من رمز المدير وإنشاء جلسة مؤقتة (verify_admin_pin)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION verify_admin_pin(
    p_store_id UUID,
    p_pin TEXT
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_pin_rec admin_pins%ROWTYPE;
    v_session_expires TIMESTAMPTZ;
BEGIN
    IF NOT is_store_member(p_store_id) THEN
        RAISE EXCEPTION 'المستخدم ليس عضواً في هذا المتجر.';
    END IF;

    SELECT * INTO v_pin_rec
    FROM admin_pins
    WHERE store_id = p_store_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'لم يتم تعيين رمز PIN للمدير في هذا المتجر بعد.';
    END IF;

    -- التحقق من حالة القفل
    IF v_pin_rec.locked_until IS NOT NULL AND v_pin_rec.locked_until > now() THEN
        RAISE EXCEPTION 'الحساب مقفل مؤقتاً بسبب المحاولات الخاطئة حتى %', v_pin_rec.locked_until;
    END IF;

    -- مقارنة التجزئة
    IF crypt(p_pin, v_pin_rec.pin_hash) = v_pin_rec.pin_hash THEN
        -- نجاح التحقق: تصفير المحاولات وتعيين جلسة صالحة لمدة 10 دقائق
        v_session_expires := now() + interval '10 minutes';

        UPDATE admin_pins
        SET failed_attempts = 0,
            locked_until = NULL,
            updated_at = now()
        WHERE store_id = p_store_id;

        -- تسجيل الجلسة للمستخدم الحالي
        INSERT INTO admin_sessions (store_id, user_id, expires_at)
        VALUES (p_store_id, auth.uid(), v_session_expires);

        RETURN v_session_expires;
    ELSE
        -- فشل التحقق: زيادة عدد المحاولات الخاطئة
        IF v_pin_rec.failed_attempts + 1 >= 5 THEN
            UPDATE admin_pins
            SET failed_attempts = v_pin_rec.failed_attempts + 1,
                locked_until = now() + interval '15 minutes',
                updated_at = now()
            WHERE store_id = p_store_id;

            RAISE EXCEPTION 'تم تجاوز الحد المسموح من المحاولات الخاطئة. تم قفل التحقق لمدة 15 دقيقة.';
        ELSE
            UPDATE admin_pins
            SET failed_attempts = v_pin_rec.failed_attempts + 1,
                updated_at = now()
            WHERE store_id = p_store_id;

            RAISE EXCEPTION 'رمز PIN غير صحيح. المحاولات المتبقية قبل القفل: %', 5 - (v_pin_rec.failed_attempts + 1);
        END IF;
    END IF;
END;
$$;

-- ---------------------------------------------------------------------
-- 4. إتمام عملية البيع وخصم المخزون ذرياً (process_sale)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION process_sale(
    p_store_id UUID,
    p_client_uuid UUID,
    p_items JSONB,
    p_discount_amount NUMERIC DEFAULT 0,
    p_payment_method TEXT DEFAULT 'cash',
    p_customer_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_existing_sale sales%ROWTYPE;
    v_sale sales%ROWTYPE;
    v_item JSONB;
    v_prod products%ROWTYPE;
    v_product_id UUID;
    v_qty NUMERIC(14,3);
    v_subtotal NUMERIC(14,2) := 0;
    v_total NUMERIC(14,2) := 0;
    v_line_total NUMERIC(14,2) := 0;
    v_discount NUMERIC(14,2) := coalesce(p_discount_amount, 0);
BEGIN
    IF NOT is_store_member(p_store_id) THEN
        RAISE EXCEPTION 'غير مصرح: المستخدم ليس عضواً في هذا المتجر.';
    END IF;

    IF p_payment_method NOT IN ('cash', 'credit') THEN
        RAISE EXCEPTION 'طريقة الدفع غير صالحة: يجب أن تكون cash أو credit.';
    END IF;

    IF p_payment_method = 'credit' AND p_customer_id IS NULL THEN
        RAISE EXCEPTION 'يجب تحديد العميل في عمليات الدفع الآجل (credit).';
    END IF;

    IF jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'سلة البيع فارغة.';
    END IF;

    -- التحقق من معرّف العميل إذا وُجد
    IF p_customer_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM customers WHERE id = p_customer_id AND store_id = p_store_id) THEN
            RAISE EXCEPTION 'العميل المحدد غير موجود في هذا المتجر.';
        END IF;
    END IF;

    -- خاصية الـ Idempotency: إذا كان client_uuid مسجلاً مسبقاً، نعيد الفاتورة فوراً دون تكرار
    SELECT * INTO v_existing_sale
    FROM sales
    WHERE store_id = p_store_id AND client_uuid = p_client_uuid;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'sale', to_jsonb(v_existing_sale),
            'idempotent_cached', TRUE
        );
    END IF;

    -- قفل صفوف المنتجات المشاركة في السلة لتفادي تعارض التزامن (Race Conditions)
    -- القفل بترتيب المعرّفات (id ASC) لمنع حدوث Deadlocks
    PERFORM id
    FROM products
    WHERE store_id = p_store_id
      AND id IN (
        SELECT (elem->>'product_id')::UUID
        FROM jsonb_array_elements(p_items) elem
      )
    ORDER BY id ASC
    FOR UPDATE;

    -- التحقق الأولي من توفر الكميات وحساب المجموع الفرعي
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_product_id := (v_item->>'product_id')::UUID;
        v_qty := (v_item->>'quantity')::NUMERIC;

        IF v_qty <= 0 THEN
            RAISE EXCEPTION 'الكمية المطلوبة للمنتج يجب أن تكون أكبر من الصفر.';
        END IF;

        SELECT * INTO v_prod
        FROM products
        WHERE id = v_product_id AND store_id = p_store_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'المنتج % غير موجود في هذا المتجر.', v_product_id;
        END IF;

        IF NOT v_prod.is_active THEN
            RAISE EXCEPTION 'المنتج "%" معطّل حالياً ولا يمكن بيعه.', v_prod.name;
        END IF;

        IF v_prod.stock_quantity < v_qty THEN
            RAISE EXCEPTION 'المخزون غير كافٍ للمنتج "%": المطلوب %، المتاح %.',
                v_prod.name, v_qty, v_prod.stock_quantity;
        END IF;

        v_subtotal := v_subtotal + round(v_prod.price * v_qty, 2);
    END LOOP;

    -- حساب الإجمالي بعد الخصم
    IF v_discount > v_subtotal THEN
        RAISE EXCEPTION 'قيمة الخصم (%) تتجاوز إجمالي الفاتورة (%).', v_discount, v_subtotal;
    END IF;

    v_total := v_subtotal - v_discount;

    -- إنشاء سجل المبيعات مع حماية تعارض التزامن لـ Idempotency
    BEGIN
        INSERT INTO sales (
            store_id, created_by, customer_id, subtotal, discount_amount,
            total_amount, payment_method, status, client_uuid
        )
        VALUES (
            p_store_id, v_user_id, p_customer_id, v_subtotal, v_discount,
            v_total, p_payment_method, 'completed', p_client_uuid
        )
        RETURNING * INTO v_sale;
    EXCEPTION WHEN unique_violation THEN
        SELECT * INTO v_existing_sale
        FROM sales
        WHERE store_id = p_store_id AND client_uuid = p_client_uuid;
        IF FOUND THEN
            RETURN jsonb_build_object(
                'sale', to_jsonb(v_existing_sale),
                'idempotent_cached', TRUE
            );
        END IF;
        RAISE;
    END;

    -- خصم المخزون وتسجيل العناصر وحركات المخزون
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_product_id := (v_item->>'product_id')::UUID;
        v_qty := (v_item->>'quantity')::NUMERIC;

        SELECT * INTO v_prod FROM products WHERE id = v_product_id;

        v_line_total := round(v_prod.price * v_qty, 2);

        -- خصم المخزون
        UPDATE products
        SET stock_quantity = stock_quantity - v_qty,
            updated_at = now()
        WHERE id = v_product_id;

        -- حفظ عنصر الفاتورة مع لقطة الاسم والأسعار
        INSERT INTO sale_items (
            sale_id, product_id, product_name_snapshot,
            unit_price_snapshot, cost_price_snapshot,
            quantity, line_total
        )
        VALUES (
            v_sale.id, v_prod.id, v_prod.name,
            v_prod.price, v_prod.cost_price,
            v_qty, v_line_total
        );

        -- تسجيل حركة المخزون
        INSERT INTO stock_movements (
            store_id, product_id, type, quantity_delta,
            reference_id, note, created_by
        )
        VALUES (
            p_store_id, v_prod.id, 'sale', -v_qty,
            v_sale.id, 'فاتورة بيع رقم: ' || v_sale.id, v_user_id
        );
    END LOOP;

    -- إذا كان الدفع آجلاً، إضافة المبلغ المستحق إلى رصيد العميل
    IF p_payment_method = 'credit' AND p_customer_id IS NOT NULL THEN
        UPDATE customers
        SET balance = balance + v_total
        WHERE id = p_customer_id;
    END IF;

    RETURN jsonb_build_object(
        'sale', to_jsonb(v_sale),
        'idempotent_cached', FALSE
    );
END;
$$;

-- ---------------------------------------------------------------------
-- 5. إلغاء فاتورة بيع بالكامل (void_sale)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION void_sale(
    p_sale_id UUID,
    p_reason TEXT DEFAULT 'إلغاء فاتورة'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_sale sales%ROWTYPE;
    v_item sale_items%ROWTYPE;
    v_user_id UUID := auth.uid();
BEGIN
    SELECT * INTO v_sale FROM sales WHERE id = p_sale_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'فاتورة البيع غير موجودة.';
    END IF;

    IF NOT is_store_owner(v_sale.store_id) THEN
        RAISE EXCEPTION 'إلغاء الفواتير مسموح لمالك المتجر فقط.';
    END IF;

    IF NOT has_active_admin_session(v_sale.store_id) THEN
        RAISE EXCEPTION 'يجب تأكيد رمز PIN للمدير لتنفيذ إلغاء الفاتورة.';
    END IF;

    IF v_sale.status = 'voided' THEN
        RAISE EXCEPTION 'هذه الفاتورة ملغاة مسبقاً.';
    END IF;

    -- تحديث حالة الفاتورة إلى ملغاة
    UPDATE sales
    SET status = 'voided'
    WHERE id = p_sale_id;

    -- إعادة المخزون لجميع العناصر وتسجيل حركات المخزون
    FOR v_item IN SELECT * FROM sale_items WHERE sale_id = p_sale_id
    LOOP
        IF v_item.product_id IS NOT NULL THEN
            UPDATE products
            SET stock_quantity = stock_quantity + v_item.quantity,
                updated_at = now()
            WHERE id = v_item.product_id;

            INSERT INTO stock_movements (
                store_id, product_id, type, quantity_delta,
                reference_id, note, created_by
            )
            VALUES (
                v_sale.store_id, v_item.product_id, 'void', v_item.quantity,
                v_sale.id, coalesce(p_reason, 'إلغاء فاتورة بيع'), v_user_id
            );
        END IF;
    END LOOP;

    -- خصم المبلغ من رصيد العميل إذا كانت الفاتورة آجلة
    IF v_sale.payment_method = 'credit' AND v_sale.customer_id IS NOT NULL THEN
        UPDATE customers
        SET balance = balance - v_sale.total_amount
        WHERE id = v_sale.customer_id;
    END IF;

    RETURN jsonb_build_object(
        'sale_id', p_sale_id,
        'status', 'voided',
        'voided_at', now()
    );
END;
$$;

-- ---------------------------------------------------------------------
-- 6. إرجاع جزئي لعناصر الفاتورة (return_items)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION return_items(
    p_sale_id UUID,
    p_items JSONB,
    p_reason TEXT DEFAULT 'إرجاع بضاعة'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_sale sales%ROWTYPE;
    v_user_id UUID := auth.uid();
    v_ret_item JSONB;
    v_product_id UUID;
    v_ret_qty NUMERIC(14,3);
    v_orig_item sale_items%ROWTYPE;
    v_total_refund NUMERIC(14,2) := 0;
    v_item_refund NUMERIC(14,2);
BEGIN
    SELECT * INTO v_sale FROM sales WHERE id = p_sale_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'الفاتورة غير موجودة.';
    END IF;

    IF NOT is_store_member(v_sale.store_id) THEN
        RAISE EXCEPTION 'غير مصرح للوصول لهذه الفاتورة.';
    END IF;

    IF v_sale.status = 'voided' THEN
        RAISE EXCEPTION 'لا يمكن الإرجاع من فاتورة ملغاة مسبقاً.';
    END IF;

    FOR v_ret_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_product_id := (v_ret_item->>'product_id')::UUID;
        v_ret_qty := (v_ret_item->>'quantity')::NUMERIC;

        IF v_ret_qty <= 0 THEN
            RAISE EXCEPTION 'الكمية المرتجعة يجب أن تكون أكبر من الصفر.';
        END IF;

        SELECT * INTO v_orig_item
        FROM sale_items
        WHERE sale_id = p_sale_id AND product_id = v_product_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'المنتج % لم يكن جزءاً من هذه الفاتورة.', v_product_id;
        END IF;

        IF v_ret_qty > v_orig_item.quantity THEN
            RAISE EXCEPTION 'الكمية المرتجعة (%) أكبر من الكمية المشتراة (%).', v_ret_qty, v_orig_item.quantity;
        END IF;

        -- إعادة الكمية إلى المخزون
        UPDATE products
        SET stock_quantity = stock_quantity + v_ret_qty,
            updated_at = now()
        WHERE id = v_product_id;

        -- تسجيل حركة المخزون
        INSERT INTO stock_movements (
            store_id, product_id, type, quantity_delta,
            reference_id, note, created_by
        )
        VALUES (
            v_sale.store_id, v_product_id, 'return', v_ret_qty,
            v_sale.id, coalesce(p_reason, 'إرجاع بضاعة من فاتورة'), v_user_id
        );

        v_item_refund := round(v_orig_item.unit_price_snapshot * v_ret_qty, 2);
        v_total_refund := v_total_refund + v_item_refund;
    END LOOP;

    -- إذا كانت الفاتورة آجلة، خصم قيمة الإرجاع من دين العميل
    IF v_sale.payment_method = 'credit' AND v_sale.customer_id IS NOT NULL THEN
        UPDATE customers
        SET balance = balance - v_total_refund
        WHERE id = v_sale.customer_id;
    END IF;

    RETURN jsonb_build_object(
        'sale_id', p_sale_id,
        'total_refund_amount', v_total_refund,
        'returned_at', now()
    );
END;
$$;

-- ---------------------------------------------------------------------
-- 7. تسوية وتعديل المخزون يدوياً (adjust_stock)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION adjust_stock(
    p_product_id UUID,
    p_new_quantity NUMERIC,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_prod products%ROWTYPE;
    v_delta NUMERIC(14,3);
    v_user_id UUID := auth.uid();
BEGIN
    SELECT * INTO v_prod FROM products WHERE id = p_product_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'المنتج غير موجود.';
    END IF;

    IF NOT is_store_owner(v_prod.store_id) THEN
        RAISE EXCEPTION 'تعديل المخزون اليدوي متاح لمالك المتجر فقط.';
    END IF;

    IF NOT has_active_admin_session(v_prod.store_id) THEN
        RAISE EXCEPTION 'يتطلب تعديل المخزون جلسة PIN نشطة للمدير.';
    END IF;

    IF p_new_quantity < 0 THEN
        RAISE EXCEPTION 'كمية المخزون لا يمكن أن تكون سالبة.';
    END IF;

    v_delta := p_new_quantity - v_prod.stock_quantity;

    IF v_delta = 0 THEN
        RETURN jsonb_build_object('product_id', p_product_id, 'updated', FALSE, 'message', 'الكمية متطابقة');
    END IF;

    UPDATE products
    SET stock_quantity = p_new_quantity,
        updated_at = now()
    WHERE id = p_product_id;

    INSERT INTO stock_movements (
        store_id, product_id, type, quantity_delta,
        reference_id, note, created_by
    )
    VALUES (
        v_prod.store_id, p_product_id, 'adjustment', v_delta,
        NULL, coalesce(p_reason, 'تسوية مخزون يدوية'), v_user_id
    );

    RETURN jsonb_build_object(
        'product_id', p_product_id,
        'old_quantity', v_prod.stock_quantity,
        'new_quantity', p_new_quantity,
        'delta', v_delta
    );
END;
$$;

-- ---------------------------------------------------------------------
-- 8. تسجيل سداد دين عميل (record_customer_payment)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION record_customer_payment(
    p_customer_id UUID,
    p_amount NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_cust customers%ROWTYPE;
    v_payment customer_payments%ROWTYPE;
    v_user_id UUID := auth.uid();
BEGIN
    SELECT * INTO v_cust FROM customers WHERE id = p_customer_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'العميل غير موجود.';
    END IF;

    IF NOT is_store_member(v_cust.store_id) THEN
        RAISE EXCEPTION 'غير مصرح لك بإجراء تسديد لعميل هذا المتجر.';
    END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'مبلغ السداد يجب أن يكون أكبر من الصفر.';
    END IF;

    INSERT INTO customer_payments (
        store_id, customer_id, amount, created_by
    )
    VALUES (
        v_cust.store_id, p_customer_id, p_amount, v_user_id
    )
    RETURNING * INTO v_payment;

    UPDATE customers
    SET balance = balance - p_amount
    WHERE id = p_customer_id;

    RETURN jsonb_build_object(
        'payment_id', v_payment.id,
        'customer_id', p_customer_id,
        'amount_paid', p_amount,
        'new_balance', v_cust.balance - p_amount
    );
END;
$$;

-- ---------------------------------------------------------------------
-- 9. الاستيراد والتحديث الجماعي للمنتجات (bulk_upsert_products)
-- ---------------------------------------------------------------------
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
    v_name TEXT;
    v_barcode TEXT;
    v_sku TEXT;
    v_unit TEXT;
    v_price NUMERIC(14,2);
    v_cost NUMERIC(14,2);
    v_stock NUMERIC(14,3);
    v_min_stock NUMERIC(14,3);
    v_category_id UUID;
    v_accepted INT := 0;
    v_rejected INT := 0;
    v_rejections JSONB := '[]'::JSONB;
    v_existing_id UUID;
BEGIN
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
        v_name := trim(coalesce(v_row->>'name', ''));
        v_barcode := nullif(trim(coalesce(v_row->>'barcode', '')), '');
        v_sku := nullif(trim(coalesce(v_row->>'sku_small_text', '')), '');
        v_unit := coalesce(nullif(trim(v_row->>'unit'), ''), 'piece');
        v_price := (v_row->>'price')::NUMERIC;
        v_cost := coalesce((v_row->>'cost_price')::NUMERIC, 0);
        v_stock := coalesce((v_row->>'stock_quantity')::NUMERIC, 0);
        v_min_stock := coalesce((v_row->>'min_stock')::NUMERIC, 0);
        v_category_id := (v_row->>'category_id')::UUID;

        -- التحقق من صحة البيانات
        IF v_name = '' THEN
            v_rejected := v_rejected + 1;
            v_rejections := v_rejections || jsonb_build_object('row', v_row, 'reason', 'اسم المنتج مفقود');
            CONTINUE;
        END IF;

        IF v_price IS NULL OR v_price < 0 THEN
            v_rejected := v_rejected + 1;
            v_rejections := v_rejections || jsonb_build_object('row', v_row, 'reason', 'السعر غير صالح أو أقل من الصفر');
            CONTINUE;
        END IF;

        IF v_stock < 0 THEN
            v_rejected := v_rejected + 1;
            v_rejections := v_rejections || jsonb_build_object('row', v_row, 'reason', 'المخزون لا يمكن أن يكون سالباً');
            CONTINUE;
        END IF;

        -- فحص تعارض الباركود إن وُجد
        v_existing_id := NULL;
        IF v_barcode IS NOT NULL THEN
            SELECT id INTO v_existing_id
            FROM products
            WHERE store_id = p_store_id AND barcode = v_barcode;
        END IF;

        IF v_existing_id IS NOT NULL THEN
            IF p_mode = 'skip' THEN
                v_rejected := v_rejected + 1;
                v_rejections := v_rejections || jsonb_build_object('row', v_row, 'reason', 'الباركود مسجل مسبقاً (تم التخطي حسب النمط skip)');
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
                    is_active = TRUE,
                    updated_at = now()
                WHERE id = v_existing_id;

                v_accepted := v_accepted + 1;
                CONTINUE;
            END IF;
        END IF;

        -- إدراج منتج جديد
        INSERT INTO products (
            store_id, category_id, name, barcode, sku_small_text,
            unit, price, cost_price, stock_quantity, min_stock
        )
        VALUES (
            p_store_id, v_category_id, v_name, v_barcode, v_sku,
            v_unit, v_price, v_cost, v_stock, v_min_stock
        );

        v_accepted := v_accepted + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'accepted_count', v_accepted,
        'rejected_count', v_rejected,
        'rejections', v_rejections
    );
END;
$$;
