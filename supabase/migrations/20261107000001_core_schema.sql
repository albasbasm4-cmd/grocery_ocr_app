-- =====================================================================
-- المهاجرة 1: المخطط الأساسي والجداول والتطبيع العربي
-- Grocery POS & Inventory - Core Schema
-- =====================================================================

-- تفعيل الامتدادات المطلوبة
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ---------------------------------------------------------------------
-- 1. دالة التطبيع العربي (normalize_arabic)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION normalize_arabic(p_text TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_clean TEXT;
BEGIN
    IF p_text IS NULL THEN
        RETURN '';
    END IF;

    -- 1. تحويل الحروف الإنجليزية إلى أحرف صغيرة وإزالة المسافات الزائدة من الأطراف
    v_clean := lower(trim(p_text));

    -- 2. إزالة التشكيل (الفتحة، الضمة، الكسرة، السكون، الشدة، التنوين)
    v_clean := regexp_replace(v_clean, '[ً-ْٰ]', '', 'g');

    -- 3. إزالة التطويل / الكشيدة (ـ)
    v_clean := replace(v_clean, 'ـ', '');

    -- 4. توحيد أشكال الألف: [أ إ آ ٱ] -> ا
    v_clean := regexp_replace(v_clean, '[أإآٱ]', 'ا', 'g');

    -- 5. توحيد التاء المربوطة: ة -> ه
    v_clean := replace(v_clean, 'ة', 'ه');

    -- 6. توحيد الألف المقصورة: ى -> ي
    v_clean := replace(v_clean, 'ى', 'ي');

    -- 7. تحويل الأرقام الهندية (الشرقية) إلى أرقام لاتينية
    v_clean := translate(v_clean, '٠١٢٣٤٥٦٧٨٩', '0123456789');

    -- 8. اختزال المسافات المتعددة المتتالية إلى مسافة واحدة
    v_clean := regexp_replace(v_clean, '\s+', ' ', 'g');

    RETURN trim(v_clean);
END;
$$;

-- ---------------------------------------------------------------------
-- 2. الجداول الأساسية
-- ---------------------------------------------------------------------

-- جدول المتاجر
CREATE TABLE IF NOT EXISTS stores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    currency_code TEXT NOT NULL DEFAULT 'SAR',
    currency_symbol TEXT NOT NULL DEFAULT 'ر.س',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- جدول أعضاء المتاجر والصلاحيات
CREATE TABLE IF NOT EXISTS store_members (
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'staff')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (store_id, user_id)
);

-- جدول رمز الحماية للمدير (Admin PIN)
CREATE TABLE IF NOT EXISTS admin_pins (
    store_id UUID PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
    pin_hash TEXT NOT NULL,
    failed_attempts INT NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- جدول جلسات المدير المؤقتة بعد التحقق من الـ PIN
CREATE TABLE IF NOT EXISTS admin_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- جدول التصنيفات
CREATE TABLE IF NOT EXISTS categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    name_normalized TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_categories_store_normalized UNIQUE (store_id, name_normalized)
);

-- جدول المنتجات
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    name_normalized TEXT NOT NULL,
    barcode TEXT NULL,
    sku_small_text TEXT NULL,
    unit TEXT NOT NULL DEFAULT 'piece' CHECK (unit IN ('piece', 'kg', 'g', 'carton', 'pack', 'box', 'other')),
    price NUMERIC(14,2) NOT NULL CHECK (price >= 0),
    cost_price NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
    stock_quantity NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
    min_stock NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
    expiry_date DATE NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- فريد للباركود لكل متجر عندما لا يكون فارغاً
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_store_barcode
ON products (store_id, barcode)
WHERE barcode IS NOT NULL AND barcode <> '';

-- فهارس البحث والتصفح السريع للمنتجات
CREATE INDEX IF NOT EXISTS idx_products_store_name_norm ON products (store_id, name_normalized);
CREATE INDEX IF NOT EXISTS idx_products_store_category ON products (store_id, category_id);
CREATE INDEX IF NOT EXISTS idx_products_store_sku ON products (store_id, sku_small_text);

-- فهارس ثلاثية الأحرف (Trigram) للبحث الحي والجزئي السريع باللغة العربية
CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON products USING gin (name_normalized gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_categories_name_trgm ON categories USING gin (name_normalized gin_trgm_ops);

-- جدول العملاء والحسابات الآجلة
CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    phone TEXT NULL,
    balance NUMERIC(14,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customers_store ON customers (store_id);

-- جدول المبيعات (الفواتير)
CREATE TABLE IF NOT EXISTS sales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    subtotal NUMERIC(14,2) NOT NULL CHECK (subtotal >= 0),
    discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    total_amount NUMERIC(14,2) NOT NULL CHECK (total_amount >= 0),
    payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'credit')),
    status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'voided')),
    client_uuid UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_sales_store_client_uuid UNIQUE (store_id, client_uuid)
);

CREATE INDEX IF NOT EXISTS idx_sales_store_created ON sales (store_id, created_at DESC);

-- جدول عناصر الفاتورة مع لقطة الأسعار والتكلفة
CREATE TABLE IF NOT EXISTS sale_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id) ON DELETE SET NULL,
    product_name_snapshot TEXT NOT NULL,
    unit_price_snapshot NUMERIC(14,2) NOT NULL,
    cost_price_snapshot NUMERIC(14,2) NOT NULL DEFAULT 0,
    quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
    line_total NUMERIC(14,2) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items (sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items (product_id);

-- جدول حركات المخزون للتدقيق والتعقب
CREATE TABLE IF NOT EXISTS stock_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('sale', 'return', 'purchase', 'adjustment', 'damage', 'void')),
    quantity_delta NUMERIC(14,3) NOT NULL,
    reference_id UUID NULL,
    note TEXT NULL,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_store_product ON stock_movements (store_id, product_id, created_at DESC);

-- جدول سداد ديون العملاء
CREATE TABLE IF NOT EXISTS customer_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_payments_store_customer ON customer_payments (store_id, customer_id);

-- ---------------------------------------------------------------------
-- 3. دوال وتريجرات ملء الحقول المطبعة تلقائياً
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_set_normalized_name()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.name_normalized := normalize_arabic(NEW.name);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_categories_normalize_name ON categories;
CREATE TRIGGER trg_categories_normalize_name
BEFORE INSERT OR UPDATE OF name ON categories
FOR EACH ROW
EXECUTE FUNCTION trg_set_normalized_name();

DROP TRIGGER IF EXISTS trg_products_normalize_name ON products;
CREATE TRIGGER trg_products_normalize_name
BEFORE INSERT OR UPDATE OF name ON products
FOR EACH ROW
EXECUTE FUNCTION trg_set_normalized_name();
