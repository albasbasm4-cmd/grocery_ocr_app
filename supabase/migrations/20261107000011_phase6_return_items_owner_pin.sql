-- =====================================================================
-- المرحلة 6: تعزيز أمان الإرجاع والإلغاء وإخفاء لقطات التكلفة للموظف
-- =====================================================================

-- 1. تحديث دالة إلغاء الفاتورة بالكامل (void_sale) لفرض سبب مكتوب
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

    IF p_reason IS NULL OR trim(p_reason) = '' THEN
        RAISE EXCEPTION 'يجب كتابة سبب واضح لإلغاء الفاتورة.';
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
                v_sale.id, trim(p_reason), v_user_id
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

-- 2. تحديث دالة الإرجاع الجزئي (return_items) لفرض مالك المتجر وجلسة PIN وسبب مكتوب
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

    IF NOT is_store_owner(v_sale.store_id) THEN
        RAISE EXCEPTION 'إرجاع البضاعة مسموح لمالك المتجر فقط.';
    END IF;

    IF NOT has_active_admin_session(v_sale.store_id) THEN
        RAISE EXCEPTION 'يجب تأكيد رمز PIN للمدير لتنفيذ الإرجاع.';
    END IF;

    IF p_reason IS NULL OR trim(p_reason) = '' THEN
        RAISE EXCEPTION 'يجب كتابة سبب واضح لإرجاع المنتجات.';
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
            v_sale.id, trim(p_reason), v_user_id
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

-- 3. دالة RPC لقراءة لقطات التكلفة لبنود الفاتورة للمالك فقط
CREATE OR REPLACE FUNCTION get_sale_items_cost(p_sale_id UUID)
RETURNS TABLE (
    item_id UUID,
    product_id UUID,
    cost_price_snapshot NUMERIC(14,2)
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_store_id UUID;
BEGIN
    SELECT store_id INTO v_store_id FROM sales WHERE id = p_sale_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'الفاتورة غير موجودة.';
    END IF;

    IF NOT is_store_owner(v_store_id) THEN
        RAISE EXCEPTION 'بيانات تكلفة المبيعات متاحة لمالك المتجر فقط.';
    END IF;

    RETURN QUERY
    SELECT si.id, si.product_id, si.cost_price_snapshot
    FROM sale_items si
    WHERE si.sale_id = p_sale_id;
END;
$$;
REVOKE ALL ON FUNCTION get_sale_items_cost(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_sale_items_cost(UUID) TO authenticated;

-- 4. حماية رصيد العميل balance من التعديل المباشر عبر REST
REVOKE UPDATE (balance) ON customers FROM authenticated;
GRANT UPDATE (name, phone) ON customers TO authenticated;
