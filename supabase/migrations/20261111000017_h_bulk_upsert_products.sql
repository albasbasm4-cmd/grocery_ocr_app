CREATE OR REPLACE FUNCTION public.bulk_upsert_products(
    p_store_id UUID,
    p_rows JSONB,
    p_mode TEXT DEFAULT 'skip'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_row JSONB;
    v_row_idx INT := 0;
    v_name TEXT;
    v_barcode TEXT;
    v_sku TEXT;
    v_unit TEXT;
    v_price NUMERIC(14,2);
    v_cost NUMERIC(14,2);
    v_stock NUMERIC(14,3);
    v_min_stock NUMERIC(14,3);
    v_expiry DATE;
    v_expiry_raw TEXT;
    v_category_id UUID;
    v_category_name TEXT;
    v_inserted INT := 0;
    v_updated INT := 0;
    v_skipped INT := 0;
    v_rejected INT := 0;
    v_rejections JSONB := '[]'::JSONB;
    v_existing_id UUID;
    v_old_stock NUMERIC(14,3);
    v_new_product_id UUID;
BEGIN
    IF NOT public.is_store_owner(p_store_id) THEN
        RAISE EXCEPTION 'الاستيراد الجماعي للمنتجات متاح لمالك المتجر فقط.';
    END IF;

    IF p_mode NOT IN ('skip', 'update') THEN
        RAISE EXCEPTION 'نمط الاستيراد غير صالح: يجب أن يكون skip أو update.';
    END IF;

    FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
    LOOP
        v_row_idx := v_row_idx + 1;
        v_name := trim(coalesce(v_row->>'name', ''));
        v_barcode := nullif(trim(coalesce(v_row->>'barcode', '')), '');
        v_sku := nullif(trim(coalesce(v_row->>'sku_small_text', '')), '');
        v_unit := public.normalize_product_unit(v_row->>'unit');

        BEGIN
            v_price := (v_row->>'price')::NUMERIC(14,2);
        EXCEPTION WHEN OTHERS THEN
            v_price := NULL;
        END;

        BEGIN
            v_cost := nullif(v_row->>'cost_price', '')::NUMERIC(14,2);
        EXCEPTION WHEN OTHERS THEN
            v_cost := NULL;
        END;

        BEGIN
            v_stock := coalesce((v_row->>'stock_quantity')::NUMERIC(14,3), 0);
        EXCEPTION WHEN OTHERS THEN
            v_stock := 0;
        END;

        BEGIN
            v_min_stock := coalesce((v_row->>'min_stock')::NUMERIC(14,3), 0);
        EXCEPTION WHEN OTHERS THEN
            v_min_stock := 0;
        END;

        v_expiry := NULL;
        v_expiry_raw := nullif(trim(coalesce(v_row->>'expiry_date', '')), '');
        IF v_expiry_raw IS NOT NULL THEN
            BEGIN
                v_expiry := v_expiry_raw::DATE;
            EXCEPTION WHEN OTHERS THEN
                v_expiry := NULL;
            END;
        END IF;

        v_category_id := NULL;
        v_category_name := nullif(trim(coalesce(v_row->>'category_name', '')), '');
        IF v_category_name IS NOT NULL THEN
            SELECT id INTO v_category_id FROM public.categories
            WHERE store_id = p_store_id AND (name = v_category_name OR name_normalized = public.normalize_arabic(v_category_name))
            LIMIT 1;

            IF v_category_id IS NULL THEN
                INSERT INTO public.categories (store_id, name, name_normalized)
                VALUES (p_store_id, v_category_name, public.normalize_arabic(v_category_name))
                RETURNING id INTO v_category_id;
            END IF;
        END IF;

        IF v_name = '' THEN
            v_rejected := v_rejected + 1;
            v_rejections := v_rejections || jsonb_build_object('row_index', v_row_idx, 'reason', 'اسم المنتج مطلوب');
            CONTINUE;
        END IF;

        IF v_price IS NULL OR v_price <= 0 THEN
            v_rejected := v_rejected + 1;
            v_rejections := v_rejections || jsonb_build_object('row_index', v_row_idx, 'reason', 'سعر البيع يجب أن يكون أكبر من الصفر');
            CONTINUE;
        END IF;

        v_existing_id := NULL;
        IF v_barcode IS NOT NULL THEN
            SELECT id, stock_quantity INTO v_existing_id, v_old_stock FROM public.products
            WHERE store_id = p_store_id AND barcode = v_barcode;
        END IF;

        IF v_existing_id IS NULL THEN
            SELECT id, stock_quantity INTO v_existing_id, v_old_stock FROM public.products
            WHERE store_id = p_store_id AND name_normalized = public.normalize_arabic(v_name);
        END IF;

        IF v_existing_id IS NOT NULL THEN
            IF p_mode = 'skip' THEN
                v_skipped := v_skipped + 1;
            ELSIF p_mode = 'update' THEN
                UPDATE public.products SET
                    name = v_name,
                    price = v_price,
                    cost_price = coalesce(v_cost, cost_price),
                    stock_quantity = v_stock,
                    min_stock = v_min_stock,
                    unit = v_unit,
                    sku_small_text = coalesce(v_sku, sku_small_text),
                    category_id = coalesce(v_category_id, category_id),
                    expiry_date = coalesce(v_expiry, expiry_date),
                    is_active = true,
                    updated_at = now()
                WHERE id = v_existing_id;

                v_updated := v_updated + 1;
            END IF;
        ELSE
            INSERT INTO public.products (
                store_id, name, barcode, sku_small_text, category_id,
                unit, price, cost_price, stock_quantity, min_stock,
                expiry_date, is_active
            )
            VALUES (
                p_store_id, v_name, v_barcode, v_sku, v_category_id,
                v_unit, v_price, v_cost, v_stock, v_min_stock,
                v_expiry, true
            )
            RETURNING id INTO v_new_product_id;

            v_inserted := v_inserted + 1;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'inserted', v_inserted,
        'updated', v_updated,
        'skipped', v_skipped,
        'rejected', v_rejected,
        'rejections', v_rejections
    );
END;
$$;

REVOKE ALL ON FUNCTION public.bulk_upsert_products(UUID, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulk_upsert_products(UUID, JSONB, TEXT) TO authenticated;
