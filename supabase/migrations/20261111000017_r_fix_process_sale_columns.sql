CREATE OR REPLACE FUNCTION public.process_sale(
    p_store_id UUID,
    p_client_uuid UUID,
    p_items JSONB,
    p_discount_amount NUMERIC DEFAULT 0,
    p_payment_method TEXT DEFAULT 'cash',
    p_customer_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_existing_sale public.sales%ROWTYPE;
    v_sale public.sales%ROWTYPE;
    v_item JSONB;
    v_prod public.products%ROWTYPE;
    v_product_id UUID;
    v_qty NUMERIC(14,3);
    v_subtotal NUMERIC(14,2) := 0;
    v_total NUMERIC(14,2) := 0;
    v_line_total NUMERIC(14,2) := 0;
    v_discount NUMERIC(14,2) := coalesce(p_discount_amount, 0);
BEGIN
    IF NOT public.is_store_member(p_store_id) THEN
        RAISE EXCEPTION 'غير مصرح: المستخدم ليس عضواً في هذا المتجر.';
    END IF;

    IF NOT public.can_store_member_sell(p_store_id) THEN
        RAISE EXCEPTION 'غير مصرح: ليس لديك صلاحية إتمام عمليات البيع في هذا المتجر.';
    END IF;

    IF p_payment_method NOT IN ('cash', 'credit') THEN
        RAISE EXCEPTION 'طريقة الدفع غير صالحة: يجب أن تكون cash أو credit.';
    END IF;

    IF p_payment_method = 'credit' AND p_customer_id IS NULL THEN
        RAISE EXCEPTION 'يجب تحديد العميل في عمليات الدفع الآجل (credit).';
    END IF;

    IF jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'سلة البيع فارغة.';
    END IF;

    IF p_customer_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id AND store_id = p_store_id) THEN
            RAISE EXCEPTION 'العميل المحدد غير موجود في هذا المتجر.';
        END IF;
    END IF;

    SELECT * INTO v_existing_sale
    FROM public.sales
    WHERE store_id = p_store_id AND client_uuid = p_client_uuid;

    IF FOUND THEN
        RETURN jsonb_build_object('sale', to_jsonb(v_existing_sale), 'idempotent_cached', TRUE);
    END IF;

    PERFORM id FROM public.products
    WHERE store_id = p_store_id
      AND id IN (SELECT (elem->>'product_id')::UUID FROM jsonb_array_elements(p_items) elem)
    ORDER BY id ASC
    FOR UPDATE;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_product_id := (v_item->>'product_id')::UUID;
        v_qty := (v_item->>'quantity')::NUMERIC;

        IF v_qty <= 0 THEN
            RAISE EXCEPTION 'الكمية المطلوبة للمنتج يجب أن تكون أكبر من الصفر.';
        END IF;

        SELECT * INTO v_prod FROM public.products
        WHERE id = v_product_id AND store_id = p_store_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'المنتج % غير موجود في هذا المتجر.', v_product_id;
        END IF;

        IF NOT v_prod.is_active THEN
            RAISE EXCEPTION 'المنتج "%" معطّل حالياً ولا يمكن بيعه.', v_prod.name;
        END IF;

        IF v_prod.stock_quantity < v_qty THEN
            RAISE EXCEPTION 'المخزون غير كافٍ للمنتج "%": المطلوب %، المتاح %.',
                v_prod.name, v_qty, v_prod.stock_quantity;
        END IF;

        v_subtotal := v_subtotal + round(v_prod.price * v_qty, 2);
    END LOOP;

    IF v_discount > v_subtotal THEN
        RAISE EXCEPTION 'قيمة الخصم (%) تتجاوز إجمالي الفاتورة (%).', v_discount, v_subtotal;
    END IF;

    v_total := v_subtotal - v_discount;

    BEGIN
        INSERT INTO public.sales (
            store_id, created_by, customer_id, subtotal, discount_amount,
            total_amount, payment_method, status, client_uuid
        )
        VALUES (
            p_store_id, v_user_id, p_customer_id, v_subtotal, v_discount,
            v_total, p_payment_method, 'completed', p_client_uuid
        )
        RETURNING * INTO v_sale;
    EXCEPTION WHEN unique_violation THEN
        SELECT * INTO v_existing_sale FROM public.sales
        WHERE store_id = p_store_id AND client_uuid = p_client_uuid;
        IF FOUND THEN
            RETURN jsonb_build_object('sale', to_jsonb(v_existing_sale), 'idempotent_cached', TRUE);
        END IF;
        RAISE;
    END;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_product_id := (v_item->>'product_id')::UUID;
        v_qty := (v_item->>'quantity')::NUMERIC;

        SELECT * INTO v_prod FROM public.products WHERE id = v_product_id;
        v_line_total := round(v_prod.price * v_qty, 2);

        UPDATE public.products
        SET stock_quantity = stock_quantity - v_qty,
            updated_at = now()
        WHERE id = v_product_id;

        INSERT INTO public.sale_items (
            sale_id, product_id, product_name_snapshot,
            unit_price_snapshot, cost_price_snapshot,
            quantity, line_total
        )
        VALUES (
            v_sale.id, v_prod.id, v_prod.name,
            v_prod.price, v_prod.cost_price,
            v_qty, v_line_total
        );

        INSERT INTO public.stock_movements (
            store_id, product_id, type, quantity_delta,
            reference_id, note, created_by
        )
        VALUES (
            p_store_id, v_prod.id, 'sale', -v_qty,
            v_sale.id, 'فاتورة بيع رقم: ' || v_sale.id, v_user_id
        );
    END LOOP;

    IF p_payment_method = 'credit' AND p_customer_id IS NOT NULL THEN
        UPDATE public.customers
        SET balance = balance + v_total
        WHERE id = p_customer_id;
    END IF;

    RETURN jsonb_build_object('sale', to_jsonb(v_sale), 'idempotent_cached', FALSE);
END;
$$;

REVOKE ALL ON FUNCTION public.process_sale(UUID, UUID, JSONB, NUMERIC, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_sale(UUID, UUID, JSONB, NUMERIC, TEXT, UUID) TO authenticated;
