-- ==============================================================================
-- المهاجرة 15: تحصينات التدقيق الشامل (Phase 12: Comprehensive Audit Hardening)
-- ==============================================================================

-- 1. حماية رصيد العميل الابتدائي (balance) عند الإضافة المباشرة (INSERT)
-- منع تعيين أي رصيد دين غير صفري عند إضافة عميل جديد مباشرة من العميل
CREATE OR REPLACE FUNCTION public.trg_customers_enforce_zero_initial_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- فرض رصيد ابتدائي صفر دائماً عند إنشاء العميل
    -- أي زيادة للرصيد يجب أن تتم عبر process_sale (دفع آجل) وأي تخفيض عبر record_customer_payment
    IF NEW.balance IS DISTINCT FROM 0 THEN
        NEW.balance := 0.00;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customers_zero_initial_balance ON public.customers;
CREATE TRIGGER trg_customers_zero_initial_balance
BEFORE INSERT ON public.customers
FOR EACH ROW
EXECUTE FUNCTION public.trg_customers_enforce_zero_initial_balance();

-- 2. إضافة فهارس جزئية مخصصة للأداء العالي (10k+ منتجات)
-- تسريع استعلامات المنتجات منخفضة المخزون والتنبيهات
CREATE INDEX IF NOT EXISTS idx_products_low_stock 
ON public.products (store_id, stock_quantity, min_stock) 
WHERE is_active = true;

-- تسريع استعلامات المنتجات قاربت على الانتهاء
CREATE INDEX IF NOT EXISTS idx_products_expiry 
ON public.products (store_id, expiry_date) 
WHERE is_active = true AND expiry_date IS NOT NULL;

-- 3. توثيق قيود الأمان وعدم سلبية المخزون والمال
COMMENT ON TABLE public.products IS 'جدول المنتجات: محمي بـ RLS وفهارس Trigram، ويمنع المخزون والأسعار السالبة عبر قيود CHECK';
COMMENT ON TABLE public.customers IS 'جدول العملاء: محمي بـ RLS وتمنع التعديلات المباشرة على رصيد الدين';
COMMENT ON TABLE public.sales IS 'جدول المبيعات: محمي بـ RLS وخاصية Idempotency عبر uq_sales_store_client_uuid';
