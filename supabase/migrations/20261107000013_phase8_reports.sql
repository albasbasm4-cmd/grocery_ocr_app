-- المرحلة 8: تقرير موحد بفحص عضوية المتجر، وتقييد الحقول المالية الحساسة للمالك.
CREATE OR REPLACE FUNCTION public.get_store_reports(
  p_store_id UUID,
  p_from_date DATE,
  p_to_date DATE,
  p_expiry_days INTEGER DEFAULT 30,
  p_product_id UUID DEFAULT NULL,
  p_movement_type TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_owner BOOLEAN := public.is_store_owner(p_store_id);
  v_expiry_days INTEGER := LEAST(GREATEST(COALESCE(p_expiry_days, 30), 1), 365);
  v_from TIMESTAMPTZ := COALESCE(p_from_date, current_date)::TIMESTAMPTZ;
  v_to TIMESTAMPTZ := (COALESCE(p_to_date, current_date) + 1)::TIMESTAMPTZ;
BEGIN
  IF NOT public.is_store_member(p_store_id) THEN
    RAISE EXCEPTION 'لا تملك صلاحية قراءة تقارير هذا المتجر.';
  END IF;
  IF p_to_date < p_from_date THEN
    RAISE EXCEPTION 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية.';
  END IF;
  IF p_movement_type IS NOT NULL AND p_movement_type NOT IN ('sale','return','purchase','adjustment','damage','void') THEN
    RAISE EXCEPTION 'نوع حركة المخزون غير صالح.';
  END IF;

  RETURN jsonb_build_object(
    'sales_daily', COALESCE((
      SELECT jsonb_agg(to_jsonb(d) ORDER BY d.day)
      FROM (
        SELECT s.created_at::date AS day, count(*)::bigint AS invoice_count,
          COALESCE(sum(s.total_amount),0)::numeric(14,2) AS revenue,
          COALESCE(avg(s.total_amount),0)::numeric(14,2) AS average_invoice,
          COALESCE(sum(s.discount_amount),0)::numeric(14,2) AS discounts
        FROM public.sales s
        WHERE s.store_id=p_store_id AND s.status='completed'
          AND s.created_at>=v_from AND s.created_at<v_to
        GROUP BY s.created_at::date
      ) d
    ), '[]'::jsonb),
    'products_top', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.quantity_sold DESC)
      FROM (
        SELECT si.product_id, si.product_name_snapshot AS name,
          sum(si.quantity)::numeric(14,3) AS quantity_sold,
          sum(si.line_total - CASE WHEN s.subtotal > 0 THEN s.discount_amount * si.line_total / s.subtotal ELSE 0 END)::numeric(14,2) AS revenue
        FROM public.sale_items si JOIN public.sales s ON s.id=si.sale_id
        WHERE s.store_id=p_store_id AND s.status='completed'
          AND s.created_at>=v_from AND s.created_at<v_to
        GROUP BY si.product_id,si.product_name_snapshot
        ORDER BY quantity_sold DESC LIMIT 10
      ) x
    ), '[]'::jsonb),
    'products_slow', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.quantity_sold, x.name)
      FROM (
        SELECT p.id AS product_id,p.name,COALESCE(sum(si.quantity) FILTER (WHERE s.id IS NOT NULL),0)::numeric(14,3) AS quantity_sold,
          COALESCE(sum(si.line_total - CASE WHEN s.subtotal > 0 THEN s.discount_amount * si.line_total / s.subtotal ELSE 0 END) FILTER (WHERE s.id IS NOT NULL),0)::numeric(14,2) AS revenue
        FROM public.products p
        LEFT JOIN public.sale_items si ON si.product_id=p.id
        LEFT JOIN public.sales s ON s.id=si.sale_id AND s.store_id=p_store_id AND s.status='completed'
          AND s.created_at>=v_from AND s.created_at<v_to
        WHERE p.store_id=p_store_id AND p.is_active=true
        GROUP BY p.id,p.name
        ORDER BY quantity_sold, p.name LIMIT 10
      ) x
    ), '[]'::jsonb),
    'profit_summary', CASE WHEN v_owner THEN COALESCE((
      SELECT to_jsonb(x) FROM (
        SELECT (SELECT count(*)::bigint FROM public.sales ss WHERE ss.store_id=p_store_id AND ss.status='completed' AND ss.created_at>=v_from AND ss.created_at<v_to) AS invoice_count,
          COALESCE((SELECT sum(ss.total_amount) FROM public.sales ss WHERE ss.store_id=p_store_id AND ss.status='completed' AND ss.created_at>=v_from AND ss.created_at<v_to),0)::numeric(14,2) AS revenue,
          COALESCE(sum(si.cost_price_snapshot*si.quantity),0)::numeric(14,2) AS cost,
          (COALESCE((SELECT sum(ss.total_amount) FROM public.sales ss WHERE ss.store_id=p_store_id AND ss.status='completed' AND ss.created_at>=v_from AND ss.created_at<v_to),0)-COALESCE(sum(si.cost_price_snapshot*si.quantity),0))::numeric(14,2) AS profit
        FROM public.sales s LEFT JOIN public.sale_items si ON si.sale_id=s.id
        WHERE s.store_id=p_store_id AND s.status='completed' AND s.created_at>=v_from AND s.created_at<v_to
      ) x
    ), '{}'::jsonb) ELSE NULL END,
    'profit_products', CASE WHEN v_owner THEN COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.profit DESC)
      FROM (
        SELECT si.product_id,si.product_name_snapshot AS name,
          COALESCE(sum(si.line_total - CASE WHEN s.subtotal > 0 THEN s.discount_amount * si.line_total / s.subtotal ELSE 0 END),0)::numeric(14,2) AS revenue,
          COALESCE(sum(si.cost_price_snapshot*si.quantity),0)::numeric(14,2) AS cost,
          (COALESCE(sum(si.line_total - CASE WHEN s.subtotal > 0 THEN s.discount_amount * si.line_total / s.subtotal ELSE 0 END),0)-COALESCE(sum(si.cost_price_snapshot*si.quantity),0))::numeric(14,2) AS profit
        FROM public.sale_items si JOIN public.sales s ON s.id=si.sale_id
        LEFT JOIN public.products p ON p.id=si.product_id AND p.store_id=p_store_id
        WHERE s.store_id=p_store_id AND s.status='completed' AND s.created_at>=v_from AND s.created_at<v_to
        GROUP BY si.product_id,si.product_name_snapshot ORDER BY profit DESC LIMIT 100
      ) x
    ), '[]'::jsonb) ELSE NULL END,
    'profit_categories', CASE WHEN v_owner THEN COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.profit DESC)
      FROM (
        SELECT COALESCE(c.name,'بدون تصنيف') AS name,
          COALESCE(sum(si.line_total - CASE WHEN s.subtotal > 0 THEN s.discount_amount * si.line_total / s.subtotal ELSE 0 END),0)::numeric(14,2) AS revenue,
          COALESCE(sum(si.cost_price_snapshot*si.quantity),0)::numeric(14,2) AS cost,
          (COALESCE(sum(si.line_total - CASE WHEN s.subtotal > 0 THEN s.discount_amount * si.line_total / s.subtotal ELSE 0 END),0)-COALESCE(sum(si.cost_price_snapshot*si.quantity),0))::numeric(14,2) AS profit
        FROM public.sale_items si JOIN public.sales s ON s.id=si.sale_id
        LEFT JOIN public.products p ON p.id=si.product_id AND p.store_id=p_store_id
        LEFT JOIN public.categories c ON c.id=p.category_id AND c.store_id=p_store_id
        WHERE s.store_id=p_store_id AND s.status='completed' AND s.created_at>=v_from AND s.created_at<v_to
        GROUP BY c.name ORDER BY profit DESC
      ) x
    ), '[]'::jsonb) ELSE NULL END,
    'low_stock', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.stock_quantity)
      FROM (
        SELECT p.id,p.name,p.stock_quantity,p.min_stock,p.unit,c.name AS category_name
        FROM public.products p LEFT JOIN public.categories c ON c.id=p.category_id AND c.store_id=p_store_id
        WHERE p.store_id=p_store_id AND p.is_active=true AND p.stock_quantity<=p.min_stock
        ORDER BY p.stock_quantity LIMIT 500
      ) x
    ), '[]'::jsonb),
    'expiring', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.expiry_date)
      FROM (
        SELECT p.id,p.name,p.stock_quantity,p.unit,p.expiry_date,
          (p.expiry_date-current_date) AS days_remaining,c.name AS category_name
        FROM public.products p LEFT JOIN public.categories c ON c.id=p.category_id AND c.store_id=p_store_id
        WHERE p.store_id=p_store_id AND p.is_active=true AND p.expiry_date IS NOT NULL
          AND p.expiry_date<=current_date+v_expiry_days
        ORDER BY p.expiry_date LIMIT 500
      ) x
    ), '[]'::jsonb),
    'inventory_by_category', CASE WHEN v_owner THEN COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.category_name)
      FROM (
        SELECT COALESCE(c.name,'بدون تصنيف') AS category_name,
          sum(p.stock_quantity*p.cost_price)::numeric(14,2) AS inventory_value,
          sum(p.stock_quantity)::numeric(14,3) AS quantity
        FROM public.products p LEFT JOIN public.categories c ON c.id=p.category_id AND c.store_id=p_store_id
        WHERE p.store_id=p_store_id AND p.is_active=true GROUP BY c.name
      ) x
    ), '[]'::jsonb) ELSE NULL END,
    'debts', COALESCE((
      SELECT jsonb_build_object('total',COALESCE(sum(c.balance),0)::numeric(14,2),
        'customers',COALESCE(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'phone',c.phone,'balance',c.balance)
          ORDER BY c.balance DESC),'[]'::jsonb))
      FROM public.customers c WHERE c.store_id=p_store_id AND c.balance>0
    ), '{"total":0,"customers":[]}'::jsonb),
    'movements', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC)
      FROM (
        SELECT m.id,m.product_id,p.name AS product_name,m.type,m.quantity_delta,m.reference_id,m.note,m.created_at
        FROM public.stock_movements m JOIN public.products p ON p.id=m.product_id
        WHERE m.store_id=p_store_id AND m.created_at>=v_from AND m.created_at<v_to
          AND (p_product_id IS NULL OR m.product_id=p_product_id)
          AND (p_movement_type IS NULL OR m.type=p_movement_type)
        ORDER BY m.created_at DESC LIMIT 2000
      ) x
    ), '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_store_reports(UUID,DATE,DATE,INTEGER,UUID,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_store_reports(UUID,DATE,DATE,INTEGER,UUID,TEXT) TO authenticated;


-- عدادات آمنة لترويسة التطبيق، دون استخدام views قد تكشف متاجر أخرى.
CREATE OR REPLACE FUNCTION public.get_store_alert_counts(p_store_id UUID, p_expiry_days INTEGER DEFAULT 30)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.is_store_member(p_store_id) THEN
    RAISE EXCEPTION 'لا تملك صلاحية قراءة بيانات هذا المتجر.';
  END IF;
  RETURN jsonb_build_object(
    'low_stock_count', (SELECT count(*) FROM public.products p WHERE p.store_id=p_store_id AND p.is_active=true AND p.stock_quantity<=p.min_stock),
    'expiring_count', (SELECT count(*) FROM public.products p WHERE p.store_id=p_store_id AND p.is_active=true AND p.expiry_date IS NOT NULL AND p.expiry_date<=current_date+LEAST(GREATEST(COALESCE(p_expiry_days,30),1),365))
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_store_alert_counts(UUID,INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_store_alert_counts(UUID,INTEGER) TO authenticated;
