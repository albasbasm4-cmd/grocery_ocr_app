-- التكلفة غير قابلة للقراءة عبر REST مباشرة، حتى للمالك، لذلك نوفر RPC مالك-فقط.
CREATE OR REPLACE FUNCTION public.get_product_costs(p_store_id UUID, p_product_ids UUID[])
RETURNS TABLE(product_id UUID, cost_price NUMERIC(14,2))
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.is_store_owner(p_store_id) THEN
    RAISE EXCEPTION 'بيانات التكلفة متاحة لمالك المتجر فقط.';
  END IF;
  RETURN QUERY
  SELECT p.id, p.cost_price
  FROM public.products p
  WHERE p.store_id = p_store_id
    AND p.id = ANY(COALESCE(p_product_ids, ARRAY[]::UUID[]));
END;
$$;
REVOKE ALL ON FUNCTION public.get_product_costs(UUID, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_product_costs(UUID, UUID[]) TO authenticated;

-- صفحة منتجات آمنة تدعم البحث الجزئي وفلاتر الأعمدة عبر آلاف المنتجات.
CREATE OR REPLACE FUNCTION public.get_products_page(
  p_store_id UUID,
  p_search TEXT DEFAULT NULL,
  p_category_id UUID DEFAULT NULL,
  p_filter TEXT DEFAULT 'all',
  p_page INTEGER DEFAULT 0,
  p_page_size INTEGER DEFAULT 40
)
RETURNS TABLE(
  id UUID,
  store_id UUID,
  category_id UUID,
  name TEXT,
  name_normalized TEXT,
  barcode TEXT,
  sku_small_text TEXT,
  unit TEXT,
  price NUMERIC(14,2),
  stock_quantity NUMERIC(14,3),
  min_stock NUMERIC(14,3),
  expiry_date DATE,
  is_active BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  has_more BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_search TEXT := public.normalize_arabic(coalesce(p_search, ''));
  v_offset INTEGER := greatest(coalesce(p_page, 0), 0) * least(greatest(coalesce(p_page_size, 40), 1), 100);
  v_limit INTEGER := least(greatest(coalesce(p_page_size, 40), 1), 100);
BEGIN
  IF NOT public.is_store_member(p_store_id) THEN
    RAISE EXCEPTION 'لا تملك صلاحية قراءة منتجات هذا المتجر.';
  END IF;
  IF coalesce(p_filter, 'all') NOT IN ('all', 'low_stock', 'expiring_soon', 'inactive') THEN
    RAISE EXCEPTION 'نوع الفلتر غير صالح.';
  END IF;

  RETURN QUERY
  WITH matches AS (
    SELECT p.*
    FROM public.products p
    WHERE p.store_id = p_store_id
      AND (p_category_id IS NULL OR p.category_id = p_category_id)
      AND (
        (p_filter = 'inactive' AND p.is_active = false)
        OR (p_filter <> 'inactive' AND p.is_active = true)
      )
      AND (p_filter <> 'low_stock' OR p.stock_quantity <= p.min_stock)
      AND (p_filter <> 'expiring_soon' OR (p.expiry_date IS NOT NULL AND p.expiry_date BETWEEN current_date AND current_date + 30))
      AND (
        v_search = '' OR
        p.name_normalized LIKE '%' || v_search || '%' OR
        position(v_search IN public.normalize_arabic(coalesce(p.barcode, ''))) > 0 OR
        position(v_search IN public.normalize_arabic(coalesce(p.sku_small_text, ''))) > 0
      )
  ), page_rows AS (
    SELECT * FROM matches ORDER BY name_normalized COLLATE "C", id OFFSET v_offset LIMIT v_limit + 1
  )
  SELECT r.id, r.store_id, r.category_id, r.name, r.name_normalized, r.barcode, r.sku_small_text,
    r.unit, r.price, r.stock_quantity, r.min_stock, r.expiry_date, r.is_active, r.created_at, r.updated_at,
    (SELECT count(*) > v_limit FROM page_rows) AS has_more
  FROM page_rows r
  ORDER BY r.name_normalized COLLATE "C", r.id
  LIMIT v_limit;
END;
$$;
REVOKE ALL ON FUNCTION public.get_products_page(UUID, TEXT, UUID, TEXT, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_products_page(UUID, TEXT, UUID, TEXT, INTEGER, INTEGER) TO authenticated;
