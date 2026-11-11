CREATE OR REPLACE FUNCTION public.export_full_store_backup(p_store_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_store JSONB;
    v_categories JSONB;
    v_products JSONB;
    v_customers JSONB;
    v_sales JSONB;
    v_stock_movements JSONB;
    v_customer_payments JSONB;
BEGIN
    IF NOT public.is_store_owner(p_store_id) THEN
        RAISE EXCEPTION 'تصدير النسخة الاحتياطية الكاملة متاح لمالك المتجر فقط.';
    END IF;

    SELECT to_jsonb(s.*) INTO v_store FROM public.stores s WHERE s.id = p_store_id;
    SELECT coalesce(jsonb_agg(to_jsonb(c.*)), '[]'::JSONB) INTO v_categories FROM public.categories c WHERE c.store_id = p_store_id;
    SELECT coalesce(jsonb_agg(to_jsonb(p.*)), '[]'::JSONB) INTO v_products FROM public.products p WHERE p.store_id = p_store_id;
    SELECT coalesce(jsonb_agg(to_jsonb(cu.*)), '[]'::JSONB) INTO v_customers FROM public.customers cu WHERE cu.store_id = p_store_id;
    SELECT coalesce(jsonb_agg(to_jsonb(sa.*)), '[]'::JSONB) INTO v_sales FROM public.sales sa WHERE sa.store_id = p_store_id;
    SELECT coalesce(jsonb_agg(to_jsonb(sm.*)), '[]'::JSONB) INTO v_stock_movements FROM public.stock_movements sm WHERE sm.store_id = p_store_id;
    SELECT coalesce(jsonb_agg(to_jsonb(cp.*)), '[]'::JSONB) INTO v_customer_payments FROM public.customer_payments cp WHERE cp.store_id = p_store_id;

    RETURN jsonb_build_object(
        'store', v_store,
        'categories', v_categories,
        'products', v_products,
        'customers', v_customers,
        'sales', v_sales,
        'stock_movements', v_stock_movements,
        'customer_payments', v_customer_payments,
        'exported_at', now()
    );
END;
$$;

REVOKE ALL ON FUNCTION public.export_full_store_backup(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.export_full_store_backup(UUID) TO authenticated;
