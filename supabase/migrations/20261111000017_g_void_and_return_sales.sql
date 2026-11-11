CREATE OR REPLACE FUNCTION public.void_sale(
    p_sale_id UUID,
    p_reason TEXT DEFAULT 'إلغاء فاتورة'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_sale public.sales%ROWTYPE;
    v_item public.sale_items%ROWTYPE;
    v_user_id UUID := auth.uid();
BEGIN
    SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'فاتورة البيع غير موجودة.';
    END IF;

    IF NOT public.is_store_owner(v_sale.store_id) THEN
        RAISE EXCEPTION 'إلغاء الفواتير مسموح لمالك المتجر فقط.';
    END IF;

    IF p_reason IS NULL OR trim(p_reason) = '' THEN
        RAISE EXCEPTION 'يجب كتابة سبب واضح لإلغاء الفاتورة.';
    END IF;

    IF v_sale.status = 'voided' THEN
        RAISE EXCEPTION 'هذه الفاتورة ملغاة مسبقاً.';
    END IF;

    UPDATE public.sales
    SET status = 'voided'
    WHERE id = p_sale_id;

    FOR v_item IN SELECT * FROM public.sale_items WHERE sale_id = p_sale_id
    LOOP
        IF v_item.product_id IS NOT NULL THEN
            UPDATE public.products
            SET stock_quantity = stock_quantity + v_item.quantity,
                updated_at = now()
            WHERE id = v_item.product_id;

            INSERT INTO public.stock_movements (
                store_id, product_id, type, quantity_delta,
                reference_id, note, created_by
            )
            VALUES (
                v_sale.store_id, v_item.product_id, 'void', v_item.quantity,
                v_sale.id, trim(p_reason), v_user_id
            );
        END IF;
    END LOOP;

    IF v_sale.payment_method = 'credit' AND v_sale.customer_id IS NOT NULL THEN
        UPDATE public.customers
        SET balance = balance - v_sale.total_amount
        WHERE id = v_sale.customer_id;
    END IF;

    RETURN jsonb_build_object(
        'sale_id', p_sale_id,
        'status', 'voided',
        'voided_at', now()
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.return_items(
    p_sale_id UUID,
    p_items JSONB,
    p_reason TEXT DEFAULT 'إرجاع بضاعة'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_sale public.sales%ROWTYPE;
    v_user_id UUID := auth.uid();
    v_ret_item JSONB;
    v_product_id UUID;
    v_ret_qty NUMERIC(14,3);
    v_orig_item public.sale_items%ROWTYPE;
    v_total_refund NUMERIC(14,2) := 0;
    v_item_refund NUMERIC(14,2);
BEGIN
    SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'فاتورة البيع غير موجودة.';
    END IF;

    IF NOT public.is_store_owner(v_sale.store_id) THEN
        RAISE EXCEPTION 'إرجاع عناصر الفاتورة مسموح لمالك المتجر فقط.';
    END IF;

    IF p_reason IS NULL OR trim(p_reason) = '' THEN
        RAISE EXCEPTION 'يجب كتابة سبب واضح للإرجاع.';
    END IF;

    IF v_sale.status = 'voided' THEN
        RAISE EXCEPTION 'لا يمكن الإرجاع من فاتورة ملغاة مسبقاً.';
    END IF;

    IF jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'قائمة الإرجاع فارغة.';
    END IF;

    FOR v_ret_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_product_id := (v_ret_item->>'product_id')::UUID;
        v_ret_qty := (v_ret_item->>'quantity')::NUMERIC(14,3);

        IF v_ret_qty <= 0 THEN
            RAISE EXCEPTION 'الكمية المرتجعة يجب أن تكون أكبر من الصفر.';
        END IF;

        SELECT * INTO v_orig_item FROM public.sale_items
        WHERE sale_id = p_sale_id AND product_id = v_product_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'المنتج غير موجود في الفاتورة الأصلية.';
        END IF;

        IF v_ret_qty > v_orig_item.quantity THEN
            RAISE EXCEPTION 'الكمية المرتجعة تتجاوز الكمية المباعة في الفاتورة.';
        END IF;

        v_item_refund := round((v_ret_qty * v_orig_item.unit_price_snapshot)::numeric, 2);
        v_total_refund := v_total_refund + v_item_refund;

        UPDATE public.products
        SET stock_quantity = stock_quantity + v_ret_qty,
            updated_at = now()
        WHERE id = v_product_id;

        INSERT INTO public.stock_movements (
            store_id, product_id, type, quantity_delta,
            reference_id, note, created_by
        )
        VALUES (
            v_sale.store_id, v_product_id, 'return', v_ret_qty,
            v_sale.id, trim(p_reason), v_user_id
        );
    END LOOP;

    IF v_sale.payment_method = 'credit' AND v_sale.customer_id IS NOT NULL THEN
        UPDATE public.customers
        SET balance = balance - v_total_refund
        WHERE id = v_sale.customer_id;
    END IF;

    RETURN jsonb_build_object(
        'sale_id', p_sale_id,
        'refund_amount', v_total_refund,
        'returned_at', now()
    );
END;
$$;

REVOKE ALL ON FUNCTION public.void_sale(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_sale(UUID, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.return_items(UUID, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.return_items(UUID, JSONB, TEXT) TO authenticated;
