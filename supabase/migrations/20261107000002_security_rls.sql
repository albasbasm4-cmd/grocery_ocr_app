-- =====================================================================
-- المهاجرة 2: الدوال المساعدة وسياسات أمان مستوى الصفوف (Row Level Security - RLS)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. الدوال المساعدة للتحقق من العضوية والصلاحيات
-- ---------------------------------------------------------------------

-- هل المستخدم عضو في هذا المتجر؟
CREATE OR REPLACE FUNCTION is_store_member(p_store_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.store_members
    WHERE store_id = p_store_id
      AND user_id = auth.uid()
  );
$$;

-- هل المستخدم مالك لهذا المتجر؟
CREATE OR REPLACE FUNCTION is_store_owner(p_store_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.store_members
    WHERE store_id = p_store_id
      AND user_id = auth.uid()
      AND role = 'owner'
  );
$$;

-- هل يمتلك المستخدم جلسة تحقق PIN نشطة غير منتهية الصلاحية؟
CREATE OR REPLACE FUNCTION has_active_admin_session(p_store_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_sessions
    WHERE store_id = p_store_id
      AND user_id = auth.uid()
      AND expires_at > now()
  );
$$;

-- ---------------------------------------------------------------------
-- 2. تفعيل RLS على جميع الجداول بلا استثناء
-- ---------------------------------------------------------------------
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_payments ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- 3. سياسات RLS: جدول المتاجر (stores)
-- ---------------------------------------------------------------------
CREATE POLICY "stores_select_member" ON stores
FOR SELECT TO authenticated
USING (is_store_member(id));

CREATE POLICY "stores_update_owner" ON stores
FOR UPDATE TO authenticated
USING (is_store_owner(id))
WITH CHECK (is_store_owner(id));

-- ---------------------------------------------------------------------
-- 4. سياسات RLS: جدول الأعضاء (store_members)
-- ---------------------------------------------------------------------
CREATE POLICY "store_members_select" ON store_members
FOR SELECT TO authenticated
USING (is_store_member(store_id));

CREATE POLICY "store_members_modify_owner" ON store_members
FOR ALL TO authenticated
USING (is_store_owner(store_id))
WITH CHECK (is_store_owner(store_id));

-- ---------------------------------------------------------------------
-- 5. سياسات RLS: جدول رمز الحماية (admin_pins)
-- محظور تماماً من أي وصول مباشر للعميل (يُدار حصراً عبر دوال RPC المقفلة)
-- ---------------------------------------------------------------------
-- لا توجد سياسات وصول مباشر، الوصول يتم فقط عبر دوال SECURITY DEFINER

-- ---------------------------------------------------------------------
-- 6. سياسات RLS: جدول جلسات التحقق (admin_sessions)
-- ---------------------------------------------------------------------
CREATE POLICY "admin_sessions_select_own" ON admin_sessions
FOR SELECT TO authenticated
USING (user_id = auth.uid() AND is_store_member(store_id));

-- ---------------------------------------------------------------------
-- 7. سياسات RLS: جدول التصنيفات (categories)
-- ---------------------------------------------------------------------
CREATE POLICY "categories_select_member" ON categories
FOR SELECT TO authenticated
USING (is_store_member(store_id));

CREATE POLICY "categories_insert_owner" ON categories
FOR INSERT TO authenticated
WITH CHECK (is_store_owner(store_id));

CREATE POLICY "categories_update_owner" ON categories
FOR UPDATE TO authenticated
USING (is_store_owner(store_id))
WITH CHECK (is_store_owner(store_id));

CREATE POLICY "categories_delete_owner" ON categories
FOR DELETE TO authenticated
USING (is_store_owner(store_id));

-- ---------------------------------------------------------------------
-- 8. سياسات RLS: جدول المنتجات (products)
-- الموظف: قراءة فقط
-- المالك: إضافة، وتعديل السعر/التعطيل مشروط بجلسة PIN نشطة
-- الحذف الفعلي: محظور، التعطيل فقط عبر تحديث is_active = false
-- ---------------------------------------------------------------------
CREATE POLICY "products_select_member" ON products
FOR SELECT TO authenticated
USING (is_store_member(store_id));

CREATE POLICY "products_insert_owner" ON products
FOR INSERT TO authenticated
WITH CHECK (is_store_owner(store_id));

CREATE POLICY "products_update_owner" ON products
FOR UPDATE TO authenticated
USING (
    is_store_owner(store_id)
)
WITH CHECK (
    is_store_owner(store_id) AND (
        -- إذا تم تعديل السعر أو التعطيل، يُشترط وجود جلسة PIN فعالة
        has_active_admin_session(store_id)
    )
);

-- لا توجد سياسة DELETE على المنتجات (الحذف الفعلي ممنوع لحماية سجل الفواتير)

-- ---------------------------------------------------------------------
-- 9. سياسات RLS: جدول العملاء (customers)
-- ---------------------------------------------------------------------
CREATE POLICY "customers_select_member" ON customers
FOR SELECT TO authenticated
USING (is_store_member(store_id));

CREATE POLICY "customers_insert_member" ON customers
FOR INSERT TO authenticated
WITH CHECK (is_store_member(store_id));

CREATE POLICY "customers_update_member" ON customers
FOR UPDATE TO authenticated
USING (is_store_member(store_id))
WITH CHECK (is_store_member(store_id));

CREATE POLICY "customers_delete_owner" ON customers
FOR DELETE TO authenticated
USING (is_store_owner(store_id));

-- ---------------------------------------------------------------------
-- 10. سياسات RLS: المبيعات، تفاصيل الفاتورة، وحركات المخزون، وسداد الديون
-- القراءة: لأعضاء المتجر
-- الكتابة: محظورة مباشرة من العميل وتتم حصراً عبر دوال RPC داخل معاملات آمنة
-- ---------------------------------------------------------------------
CREATE POLICY "sales_select_member" ON sales
FOR SELECT TO authenticated
USING (is_store_member(store_id));

CREATE POLICY "sale_items_select_member" ON sale_items
FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM sales s
        WHERE s.id = sale_items.sale_id
          AND is_store_member(s.store_id)
    )
);

CREATE POLICY "stock_movements_select_member" ON stock_movements
FOR SELECT TO authenticated
USING (is_store_member(store_id));

CREATE POLICY "customer_payments_select_member" ON customer_payments
FOR SELECT TO authenticated
USING (is_store_member(store_id));
