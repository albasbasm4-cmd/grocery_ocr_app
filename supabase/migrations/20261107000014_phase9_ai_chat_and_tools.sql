-- Phase 9: server-side AI usage limits and tightly scoped read-only tools.
CREATE TABLE IF NOT EXISTS public.ai_chat_rate_limits (
  user_id UUID NOT NULL,
  store_id UUID NOT NULL,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  PRIMARY KEY (user_id, store_id)
);
ALTER TABLE public.ai_chat_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_chat_rate_limits FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.check_and_increment_ai_rate_limit(
  p_store_id UUID,
  p_max_requests INTEGER DEFAULT 20,
  p_window_seconds INTEGER DEFAULT 60
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, auth, pg_temp AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_rec public.ai_chat_rate_limits%ROWTYPE;
  v_now TIMESTAMPTZ := now();
  v_max INTEGER := LEAST(GREATEST(COALESCE(p_max_requests,20),1),100);
  v_secs INTEGER := LEAST(GREATEST(COALESCE(p_window_seconds,60),1),3600);
BEGIN
  IF v_uid IS NULL OR NOT public.is_store_member(p_store_id) THEN
    RAISE EXCEPTION 'المستخدم ليس عضواً في هذا المتجر.';
  END IF;
  INSERT INTO public.ai_chat_rate_limits(user_id,store_id,window_start,request_count)
  VALUES(v_uid,p_store_id,v_now,0) ON CONFLICT(user_id,store_id) DO NOTHING;
  SELECT * INTO v_rec FROM public.ai_chat_rate_limits
    WHERE user_id=v_uid AND store_id=p_store_id FOR UPDATE;
  IF v_now >= v_rec.window_start + make_interval(secs=>v_secs) THEN
    UPDATE public.ai_chat_rate_limits SET window_start=v_now,request_count=1
      WHERE user_id=v_uid AND store_id=p_store_id;
    RETURN jsonb_build_object('allowed',true,'remaining',v_max-1,'reset_in_seconds',v_secs);
  END IF;
  IF v_rec.request_count >= v_max THEN
    RETURN jsonb_build_object('allowed',false,'remaining',0,
      'reset_in_seconds',GREATEST(1,EXTRACT(EPOCH FROM (v_rec.window_start+make_interval(secs=>v_secs)-v_now))::INTEGER));
  END IF;
  UPDATE public.ai_chat_rate_limits SET request_count=v_rec.request_count+1
    WHERE user_id=v_uid AND store_id=p_store_id;
  RETURN jsonb_build_object('allowed',true,'remaining',v_max-v_rec.request_count-1,
    'reset_in_seconds',GREATEST(1,EXTRACT(EPOCH FROM (v_rec.window_start+make_interval(secs=>v_secs)-v_now))::INTEGER));
END; $$;
REVOKE ALL ON FUNCTION public.check_and_increment_ai_rate_limit(UUID,INTEGER,INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_and_increment_ai_rate_limit(UUID,INTEGER,INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.ai_get_low_stock(p_store_id UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE v_owner BOOLEAN := public.is_store_owner(p_store_id);
BEGIN
  IF NOT public.is_store_member(p_store_id) THEN RAISE EXCEPTION 'غير مصرح'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(
    jsonb_build_object('id',x.id,'name',x.name,'barcode',x.barcode,'sku',x.sku_small_text,
      'category',x.category,'stock_quantity',x.stock_quantity,'min_stock',x.min_stock,'unit',x.unit,'price',x.price)
      || CASE WHEN v_owner THEN jsonb_build_object('cost_price',x.cost_price) ELSE '{}'::jsonb END
    ORDER BY x.stock_quantity ASC)
    FROM (SELECT p.id,p.name,p.barcode,p.sku_small_text,COALESCE(c.name,'بدون تصنيف') category,
      p.stock_quantity,p.min_stock,p.unit,p.price,p.cost_price
      FROM public.products p LEFT JOIN public.categories c ON c.id=p.category_id AND c.store_id=p_store_id
      WHERE p.store_id=p_store_id AND p.is_active AND p.stock_quantity<=p.min_stock
      ORDER BY p.stock_quantity LIMIT 25) x),'[]'::jsonb);
END; $$;
REVOKE ALL ON FUNCTION public.ai_get_low_stock(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_get_low_stock(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.ai_get_category_total(p_store_id UUID,p_category_name TEXT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE v_owner BOOLEAN := public.is_store_owner(p_store_id); v_cat RECORD; v_stats RECORD; v_norm TEXT := public.normalize_arabic(COALESCE(p_category_name,''));
BEGIN
  IF NOT public.is_store_member(p_store_id) THEN RAISE EXCEPTION 'غير مصرح'; END IF;
  SELECT * INTO v_cat FROM public.categories WHERE store_id=p_store_id
    AND (name_normalized=v_norm OR name ILIKE '%'||left(trim(COALESCE(p_category_name,'')),80)||'%')
    ORDER BY (name_normalized=v_norm) DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('found',false); END IF;
  SELECT count(*)::INTEGER product_count,COALESCE(sum(stock_quantity),0)::NUMERIC(14,3) total_quantity,
    COALESCE(sum(stock_quantity*price),0)::NUMERIC(14,2) retail_value,
    COALESCE(sum(stock_quantity*cost_price),0)::NUMERIC(14,2) cost_value INTO v_stats
    FROM public.products WHERE store_id=p_store_id AND category_id=v_cat.id AND is_active;
  RETURN jsonb_build_object('found',true,'category_name',v_cat.name,'product_count',v_stats.product_count,
    'total_stock_quantity',v_stats.total_quantity,'total_retail_value',v_stats.retail_value)
    || CASE WHEN v_owner THEN jsonb_build_object('total_cost_value',v_stats.cost_value) ELSE '{}'::jsonb END;
END; $$;
REVOKE ALL ON FUNCTION public.ai_get_category_total(UUID,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_get_category_total(UUID,TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.ai_search_products(p_store_id UUID,p_query TEXT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE v_owner BOOLEAN := public.is_store_owner(p_store_id); v_q TEXT := left(trim(COALESCE(p_query,'')),100); v_norm TEXT := public.normalize_arabic(v_q);
BEGIN
  IF NOT public.is_store_member(p_store_id) THEN RAISE EXCEPTION 'غير مصرح'; END IF;
  IF v_q='' THEN RETURN '[]'::jsonb; END IF;
  RETURN COALESCE((SELECT jsonb_agg((jsonb_build_object('id',x.id,'name',x.name,'barcode',x.barcode,'sku',x.sku_small_text,
    'category',x.category,'unit',x.unit,'price',x.price,'stock_quantity',x.stock_quantity,'min_stock',x.min_stock,
    'expiry_date',x.expiry_date,'is_active',x.is_active) || CASE WHEN v_owner THEN jsonb_build_object('cost_price',x.cost_price) ELSE '{}'::jsonb END)
    ORDER BY x.exact_barcode DESC,x.exact_name DESC,x.name)
    FROM (SELECT p.id,p.name,p.barcode,p.sku_small_text,COALESCE(c.name,'بدون تصنيف') category,p.unit,p.price,
      p.stock_quantity,p.min_stock,p.expiry_date,p.is_active,p.cost_price,(p.barcode=v_q) exact_barcode,(p.name_normalized=v_norm) exact_name
      FROM public.products p LEFT JOIN public.categories c ON c.id=p.category_id AND c.store_id=p_store_id
      WHERE p.store_id=p_store_id AND (p.barcode=v_q OR p.sku_small_text ILIKE '%'||v_q||'%' OR p.name_normalized ILIKE '%'||v_norm||'%' OR p.name ILIKE '%'||v_q||'%')
      ORDER BY (p.barcode=v_q) DESC,(p.name_normalized=v_norm) DESC,p.name LIMIT 15) x),'[]'::jsonb);
END; $$;
REVOKE ALL ON FUNCTION public.ai_search_products(UUID,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_search_products(UUID,TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.ai_get_sales_summary(p_store_id UUID,p_from_date DATE DEFAULT CURRENT_DATE,p_to_date DATE DEFAULT CURRENT_DATE) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE v_owner BOOLEAN := public.is_store_owner(p_store_id); v_from DATE := COALESCE(p_from_date,CURRENT_DATE); v_to DATE := COALESCE(p_to_date,CURRENT_DATE); v_data RECORD; v_cost NUMERIC(14,2):=0;
BEGIN
  IF NOT public.is_store_member(p_store_id) THEN RAISE EXCEPTION 'غير مصرح'; END IF;
  IF v_to<v_from OR v_to-v_from>366 THEN RAISE EXCEPTION 'نطاق التاريخ غير صالح أو يتجاوز سنة.'; END IF;
  SELECT count(*)::BIGINT invoices,COALESCE(sum(total_amount),0)::NUMERIC(14,2) revenue,
    COALESCE(sum(discount_amount),0)::NUMERIC(14,2) discounts,COALESCE(avg(total_amount),0)::NUMERIC(14,2) average_invoice
    INTO v_data FROM public.sales WHERE store_id=p_store_id AND status='completed'
    AND created_at>=v_from::TIMESTAMPTZ AND created_at<(v_to+1)::TIMESTAMPTZ;
  IF v_owner THEN SELECT COALESCE(sum(si.cost_price_snapshot*si.quantity),0)::NUMERIC(14,2) INTO v_cost
    FROM public.sale_items si JOIN public.sales s ON s.id=si.sale_id WHERE s.store_id=p_store_id AND s.status='completed'
    AND s.created_at>=v_from::TIMESTAMPTZ AND s.created_at<(v_to+1)::TIMESTAMPTZ; END IF;
  RETURN jsonb_build_object('from_date',v_from,'to_date',v_to,'invoice_count',v_data.invoices,'total_revenue',v_data.revenue,
    'total_discounts',v_data.discounts,'average_invoice',v_data.average_invoice)
    || CASE WHEN v_owner THEN jsonb_build_object('total_cost',v_cost,'total_profit',v_data.revenue-v_cost) ELSE '{}'::jsonb END;
END; $$;
REVOKE ALL ON FUNCTION public.ai_get_sales_summary(UUID,DATE,DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_get_sales_summary(UUID,DATE,DATE) TO authenticated;

CREATE OR REPLACE FUNCTION public.ai_get_top_products(p_store_id UUID,p_from_date DATE DEFAULT NULL,p_to_date DATE DEFAULT NULL,p_limit INTEGER DEFAULT 10) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE v_from DATE:=COALESCE(p_from_date,CURRENT_DATE-30); v_to DATE:=COALESCE(p_to_date,CURRENT_DATE); v_limit INTEGER:=LEAST(GREATEST(COALESCE(p_limit,10),1),25);
BEGIN
  IF NOT public.is_store_member(p_store_id) THEN RAISE EXCEPTION 'غير مصرح'; END IF;
  IF v_to<v_from OR v_to-v_from>366 THEN RAISE EXCEPTION 'نطاق التاريخ غير صالح أو يتجاوز سنة.'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.quantity_sold DESC) FROM (
    SELECT si.product_name_snapshot product_name,sum(si.quantity)::NUMERIC(14,3) quantity_sold,
      sum(si.line_total-CASE WHEN s.subtotal>0 THEN s.discount_amount*si.line_total/s.subtotal ELSE 0 END)::NUMERIC(14,2) revenue
    FROM public.sale_items si JOIN public.sales s ON s.id=si.sale_id WHERE s.store_id=p_store_id AND s.status='completed'
      AND s.created_at>=v_from::TIMESTAMPTZ AND s.created_at<(v_to+1)::TIMESTAMPTZ
    GROUP BY si.product_id,si.product_name_snapshot ORDER BY quantity_sold DESC LIMIT v_limit) x),'[]'::jsonb);
END; $$;
REVOKE ALL ON FUNCTION public.ai_get_top_products(UUID,DATE,DATE,INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_get_top_products(UUID,DATE,DATE,INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.ai_get_expiring_products(p_store_id UUID,p_days INTEGER DEFAULT 30) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE v_days INTEGER:=LEAST(GREATEST(COALESCE(p_days,30),0),180);
BEGIN
  IF NOT public.is_store_member(p_store_id) THEN RAISE EXCEPTION 'غير مصرح'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.expiry_date) FROM (
    SELECT p.id,p.name,p.barcode,p.expiry_date,(p.expiry_date-CURRENT_DATE)::INTEGER days_remaining,p.stock_quantity,p.unit,COALESCE(c.name,'بدون تصنيف') category_name
    FROM public.products p LEFT JOIN public.categories c ON c.id=p.category_id AND c.store_id=p_store_id
    WHERE p.store_id=p_store_id AND p.is_active AND p.expiry_date IS NOT NULL AND p.expiry_date<=CURRENT_DATE+v_days
    ORDER BY p.expiry_date LIMIT 25) x),'[]'::jsonb);
END; $$;
REVOKE ALL ON FUNCTION public.ai_get_expiring_products(UUID,INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_get_expiring_products(UUID,INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.ai_get_customer_debts(p_store_id UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE v_total NUMERIC(14,2); v_count INTEGER; v_customers JSONB;
BEGIN
  IF NOT public.is_store_member(p_store_id) THEN RAISE EXCEPTION 'غير مصرح'; END IF;
  SELECT COALESCE(sum(balance),0)::NUMERIC(14,2),count(*)::INTEGER INTO v_total,v_count FROM public.customers WHERE store_id=p_store_id AND balance>0;
  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.balance DESC),'[]'::jsonb) INTO v_customers FROM (
    SELECT name,balance FROM public.customers WHERE store_id=p_store_id AND balance>0 ORDER BY balance DESC LIMIT 20) x;
  RETURN jsonb_build_object('total_debt',v_total,'debtors_count',v_count,'top_debtors',v_customers);
END; $$;
REVOKE ALL ON FUNCTION public.ai_get_customer_debts(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_get_customer_debts(UUID) TO authenticated;
