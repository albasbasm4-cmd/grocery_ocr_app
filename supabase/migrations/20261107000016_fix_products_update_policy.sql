-- ===================================================================
-- إصلاح سياسة تحديث المنتجات: السماح للمالك بتعديل الحقول العادية
-- بدون PIN، مع حماية السعر وis_active عبر RPC فقط
-- ===================================================================

-- إسقاط السياسة القديمة التي كانت تطلب PIN لأي تعديل
DROP POLICY IF EXISTS "products_update_owner" ON products;

-- سياسة جديدة: المالك يستطيع تعديل المنتجات بدون PIN
-- (تعديل السعر وis_active محمي عبر RPC update_product_sensitive)
CREATE POLICY "products_update_owner" ON products
FOR UPDATE TO authenticated
USING (is_store_owner(store_id))
WITH CHECK (is_store_owner(store_id));

-- -------------------------------------------------------------------
-- RPC لتعديل الحقول الحساسة (السعر، التكلفة، is_active) - تتطلب PIN
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_product_sensitive(
    p_store_id UUID,
    p_product_id UUID,
    p_selling_price NUMERIC(14,2) DEFAULT NULL,
    p_cost_price NUMERIC(14,2) DEFAULT NULL,
    p_is_active BOOLEAN DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    -- التحقق من عضوية المتجر والملكية
    IF NOT is_store_owner(p_store_id) THEN
        RAISE EXCEPTION 'يجب أن تكون مالك المتجر لتعديل الأسعار أو حالة المنتج.';
    END IF;

    -- التحقق من جلسة PIN الفعالة
    IF NOT has_active_admin_session(p_store_id) THEN
        RAISE EXCEPTION 'مطلوب رمز PIN للمدير لتعديل الأسعار أو تعطيل المنتجات.';
    END IF;

    -- التحقق من أن المنتج ينتمي للمتجر
    IF NOT EXISTS (SELECT 1 FROM products WHERE id = p_product_id AND store_id = p_store_id) THEN
        RAISE EXCEPTION 'المنتج غير موجود في هذا المتجر.';
    END IF;

    -- تحديث الحقول الحساسة فقط
    UPDATE products SET
        price         = COALESCE(p_selling_price, price),
        cost_price    = COALESCE(p_cost_price, cost_price),
        is_active     = COALESCE(p_is_active, is_active),
        updated_at    = now()
    WHERE id = p_product_id AND store_id = p_store_id;
END;
$$;

GRANT EXECUTE ON FUNCTION update_product_sensitive(UUID, UUID, NUMERIC, NUMERIC, BOOLEAN) TO authenticated;
