-- =====================================================================
-- المهاجرة 4: التقارير الإحصائية والعروض (Views & RPC Analytics)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. عرض المنتجات منخفضة المخزون (view_low_stock)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW view_low_stock AS
SELECT
    p.id,
    p.store_id,
    p.name,
    p.barcode,
    p.sku_small_text,
    p.unit,
    p.stock_quantity,
    p.min_stock,
    p.price,
    c.name AS category_name
FROM products p
LEFT JOIN categories c ON c.id = p.category_id
WHERE p.is_active = true
  AND p.stock_quantity <= p.min_stock;

-- ---------------------------------------------------------------------
-- 2. عرض المنتجات القريبة من انتهاء الصلاحية (view_expiring_soon)
-- (المنتجات التي تنتهي خلال 30 يوماً القادمة)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW view_expiring_soon AS
SELECT
    p.id,
    p.store_id,
    p.name,
    p.barcode,
    p.expiry_date,
    (p.expiry_date - current_date) AS days_until_expiry,
    p.stock_quantity,
    p.unit,
    c.name AS category_name
FROM products p
LEFT JOIN categories c ON c.id = p.category_id
WHERE p.is_active = true
  AND p.expiry_date IS NOT NULL
  AND p.expiry_date <= (current_date + interval '30 days')
ORDER BY p.expiry_date ASC;

-- ---------------------------------------------------------------------
-- 3. تقرير المبيعات اليومية (get_daily_sales)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_daily_sales(
    p_store_id UUID,
    p_days INT DEFAULT 30
)
RETURNS TABLE (
    sale_date DATE,
    total_sales_count BIGINT,
    total_revenue NUMERIC(14,2),
    total_discount NUMERIC(14,2),
    cash_sales NUMERIC(14,2),
    credit_sales NUMERIC(14,2)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    IF NOT is_store_member(p_store_id) THEN
        RAISE EXCEPTION 'غير مصرح للوصول إلى تقارير هذا المتجر.';
    END IF;

    RETURN QUERY
    SELECT
        s.created_at::DATE AS sale_date,
        count(*)::BIGINT AS total_sales_count,
        coalesce(sum(s.total_amount), 0)::NUMERIC(14,2) AS total_revenue,
        coalesce(sum(s.discount_amount), 0)::NUMERIC(14,2) AS total_discount,
        coalesce(sum(CASE WHEN s.payment_method = 'cash' THEN s.total_amount ELSE 0 END), 0)::NUMERIC(14,2) AS cash_sales,
        coalesce(sum(CASE WHEN s.payment_method = 'credit' THEN s.total_amount ELSE 0 END), 0)::NUMERIC(14,2) AS credit_sales
    FROM sales s
    WHERE s.store_id = p_store_id
      AND s.status = 'completed'
      AND s.created_at >= (now() - (p_days || ' days')::INTERVAL)
    GROUP BY s.created_at::DATE
    ORDER BY sale_date DESC;
END;
$$;

-- ---------------------------------------------------------------------
-- 4. تقرير المنتجات الأكثر مبيعاً (get_top_products)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_top_products(
    p_store_id UUID,
    p_limit INT DEFAULT 10
)
RETURNS TABLE (
    product_id UUID,
    product_name TEXT,
    total_quantity_sold NUMERIC(14,3),
    total_revenue NUMERIC(14,2),
    sales_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    IF NOT is_store_member(p_store_id) THEN
        RAISE EXCEPTION 'غير مصرح للوصول إلى تقارير هذا المتجر.';
    END IF;

    RETURN QUERY
    SELECT
        si.product_id,
        si.product_name_snapshot AS product_name,
        coalesce(sum(si.quantity), 0)::NUMERIC(14,3) AS total_quantity_sold,
        coalesce(sum(si.line_total), 0)::NUMERIC(14,2) AS total_revenue,
        count(DISTINCT si.sale_id)::BIGINT AS sales_count
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    WHERE s.store_id = p_store_id
      AND s.status = 'completed'
    GROUP BY si.product_id, si.product_name_snapshot
    ORDER BY total_quantity_sold DESC
    LIMIT p_limit;
END;
$$;

-- ---------------------------------------------------------------------
-- 5. تقرير ملخص الأرباح (get_profit_summary)
-- الأرباح محسوبة من اللقطات التاريخية (سعر البيع - سعر التكلفة)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_profit_summary(
    p_store_id UUID,
    p_from_date TIMESTAMPTZ DEFAULT NULL,
    p_to_date TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
    total_sales_count BIGINT,
    total_revenue NUMERIC(14,2),
    total_cost NUMERIC(14,2),
    gross_profit NUMERIC(14,2),
    profit_margin_percent NUMERIC(5,2)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_from TIMESTAMPTZ := coalesce(p_from_date, now() - interval '30 days');
    v_to TIMESTAMPTZ := coalesce(p_to_date, now());
BEGIN
    IF NOT is_store_member(p_store_id) THEN
        RAISE EXCEPTION 'غير مصرح للوصول إلى تقارير هذا المتجر.';
    END IF;

    RETURN QUERY
    WITH revenue_cost AS (
        SELECT
            count(DISTINCT s.id)::BIGINT AS scnt,
            coalesce(sum(si.line_total), 0)::NUMERIC(14,2) AS rev,
            coalesce(sum(si.cost_price_snapshot * si.quantity), 0)::NUMERIC(14,2) AS cost
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        WHERE s.store_id = p_store_id
          AND s.status = 'completed'
          AND s.created_at BETWEEN v_from AND v_to
    )
    SELECT
        scnt,
        rev,
        cost,
        (rev - cost)::NUMERIC(14,2) AS gross_profit,
        CASE
            WHEN rev > 0 THEN round(((rev - cost) / rev) * 100, 2)::NUMERIC(5,2)
            ELSE 0::NUMERIC(5,2)
        END AS profit_margin_percent
    FROM revenue_cost;
END;
$$;
