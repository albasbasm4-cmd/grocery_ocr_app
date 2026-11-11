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

    IF NOT public.is_store_owner(p_store_id) THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.store_members
            WHERE store_id = p_store_id
              AND user_id = v_user_id
              AND is_active = true
              AND can_sell = true
        ) THEN
            RAISE EXCEPTION 'غير مصرح: ليس لديك صلاحية إتمام عمليات البيع في هذا المتجر.';
        END IF;
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

    IF p_client_uuid IS NOT NULL THEN
        SELECT * INTO v_existing_sale FROM public.sales
        WHERE store_id = p_store_id AND client_uuid = p_client_uuid;
        IF FOUND THEN
            RETURN jsonb_build_object(
                'sale_id', v_existing_sale.id,
                'status', v_existing_sale.status,
                'total_amount', v_existing_sale.total_amount,
                'receipt_number', v_existing_sale.receipt_number,
                'is_duplicate', TRUE
            );
        END IF;
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_product_id := (v_item->>'product_id')::UUID;
        v_qty := (v_item->>'quantity')::NUMERIC(14,3);

        IF v_qty <= 0 THEN
            RAISE EXCEPTION 'كمية المنتج يجب أن تكون أكبر من الصفر.';
        END IF;

        SELECT * INTO v_prod FROM public.products
        WHERE id = v_product_id AND store_id = p_store_id AND is_active = true
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'المنتج غير موجود أو غير نشط.';
        END IF;

        IF v_prod.stock_quantity < v_qty THEN
            RAISE EXCEPTION 'المخزون غير كاف للمنتج: % (المتاح: %)', v_prod.name, v_prod.stock_quantity;
        END IF;

        v_line_total := round((v_qty * v_prod.price)::numeric, 2);
        v_subtotal := v_subtotal + v_line_total;
    END LOOP;

    v_total := v_subtotal - v_discount;
    IF v_total < 0 THEN
        RAISE EXCEPTION 'مبلغ الخصم يتجاوز إجمالي الفاتورة.';
    END IF;

    INSERT INTO public.sales (
        store_id, client_uuid, customer_id, cashier_id,
        subtotal_amount, discount_amount, total_amount,
        payment_method, status
    )
    VALUES (
        p_store_id, p_client_uuid, p_customer_id, v_user_id,
        v_subtotal, v_discount, v_total,
        p_payment_method, 'completed'
    )
    RETURNING * INTO v_sale;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_product_id := (v_item->>'product_id')::UUID;
        v_qty := (v_item->>'quantity')::NUMERIC(14,3);

        SELECT * INTO v_prod FROM public.products WHERE id = v_product_id;
        v_line_total := round((v_qty * v_prod.price)::numeric, 2);

        INSERT INTO public.sale_items (
            sale_id, product_id, product_name_snapshot,
            unit_price_snapshot, cost_price_snapshot,
            quantity, line_total
        )
        VALUES (
            v_sale.id, v_product_id, v_prod.name,
            v_prod.price, v_prod.cost_price,
            v_qty, v_line_total
        );

        UPDATE public.products
        SET stock_quantity = stock_quantity - v_qty,
            updated_at = now()
        WHERE id = v_product_id;

        INSERT INTO public.stock_movements (
            store_id, product_id, type, quantity_delta,
            reference_id, note, created_by
        )
        VALUES (
            p_store_id, v_product_id, 'sale', -v_qty,
            v_sale.id, 'فاتورة بيع رقم ' || v_sale.receipt_number, v_user_id
        );
    END LOOP;

    IF p_payment_method = 'credit' AND p_customer_id IS NOT NULL THEN
        UPDATE public.customers
        SET balance = balance + v_total
        WHERE id = p_customer_id;
    END IF;

    RETURN jsonb_build_object(
        'sale_id', v_sale.id,
        'status', v_sale.status,
        'total_amount', v_sale.total_amount,
        'receipt_number', v_sale.receipt_number,
        'is_duplicate', FALSE
    );
END;
$$;

REVOKE ALL ON FUNCTION public.process_sale(UUID, UUID, JSONB, NUMERIC, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_sale(UUID, UUID, JSONB, NUMERIC, TEXT, UUID) TO authenticated;
