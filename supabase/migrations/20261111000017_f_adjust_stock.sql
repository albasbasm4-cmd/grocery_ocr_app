CREATE OR REPLACE FUNCTION public.adjust_stock(
    p_product_id UUID,
    p_new_quantity NUMERIC,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_prod public.products%ROWTYPE;
    v_delta NUMERIC(14,3);
    v_user_id UUID := auth.uid();
    v_is_owner BOOLEAN;
    v_can_write BOOLEAN;
BEGIN
    SELECT * INTO v_prod FROM public.products WHERE id = p_product_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'المنتج غير موجود.';
    END IF;

    v_is_owner := public.is_store_owner(v_prod.store_id);
    v_can_write := EXISTS (
        SELECT 1 FROM public.store_members
        WHERE store_id = v_prod.store_id
          AND user_id = v_user_id
          AND is_active = true
          AND permission = 'write'
    );

    IF NOT (v_is_owner OR v_can_write) THEN
        RAISE EXCEPTION 'تعديل المخزون متاح للمالك أو الموظف بصلاحية كتابة فقط.';
    END IF;

    IF p_new_quantity < 0 THEN
        RAISE EXCEPTION 'كمية المخزون لا يمكن أن تكون سالبة.';
    END IF;

    v_delta := p_new_quantity - v_prod.stock_quantity;

    IF v_delta = 0 THEN
        RETURN jsonb_build_object('product_id', p_product_id, 'updated', FALSE, 'message', 'الكمية متطابقة');
    END IF;

    UPDATE public.products
    SET stock_quantity = p_new_quantity,
        updated_at = now()
    WHERE id = p_product_id;

    INSERT INTO public.stock_movements (
        store_id, product_id, type, quantity_delta,
        reference_id, note, created_by
    )
    VALUES (
        v_prod.store_id, p_product_id, 'adjustment', v_delta,
        NULL, coalesce(p_reason, 'تسوية مخزون يدوية'), v_user_id
    );

    RETURN jsonb_build_object(
        'product_id', p_product_id,
        'old_quantity', v_prod.stock_quantity,
        'new_quantity', p_new_quantity,
        'delta', v_delta,
        'updated', TRUE
    );
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_stock(UUID, NUMERIC, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_stock(UUID, NUMERIC, TEXT) TO authenticated;
