-- Persist PIN failures. Returning a status (rather than raising) is essential because
-- an exception would roll back failed_attempts and make the lockout ineffective.
DROP FUNCTION IF EXISTS public.verify_admin_pin(UUID, TEXT);
CREATE FUNCTION public.verify_admin_pin(p_store_id UUID, p_pin TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_pin_rec public.admin_pins%ROWTYPE;
  v_expires TIMESTAMPTZ;
BEGIN
  IF NOT public.is_store_owner(p_store_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden', 'message', 'التحقق برمز PIN متاح لمالك المتجر فقط.');
  END IF;
  SELECT * INTO v_pin_rec FROM public.admin_pins WHERE store_id = p_store_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'pin_not_set', 'message', 'لم يتم تعيين رمز PIN لهذا المتجر.');
  END IF;
  IF v_pin_rec.locked_until IS NOT NULL AND v_pin_rec.locked_until > now() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'locked', 'locked_until', v_pin_rec.locked_until,
      'message', 'تم قفل التحقق مؤقتاً بعد محاولات خاطئة.');
  END IF;
  IF crypt(p_pin, v_pin_rec.pin_hash) = v_pin_rec.pin_hash THEN
    v_expires := now() + interval '10 minutes';
    UPDATE public.admin_pins SET failed_attempts = 0, locked_until = NULL, updated_at = now()
      WHERE store_id = p_store_id;
    INSERT INTO public.admin_sessions(store_id, user_id, expires_at)
      VALUES (p_store_id, auth.uid(), v_expires);
    RETURN jsonb_build_object('ok', true, 'expires_at', v_expires);
  END IF;
  IF v_pin_rec.failed_attempts + 1 >= 5 THEN
    UPDATE public.admin_pins SET failed_attempts = v_pin_rec.failed_attempts + 1,
      locked_until = now() + interval '15 minutes', updated_at = now() WHERE store_id = p_store_id;
    RETURN jsonb_build_object('ok', false, 'code', 'locked',
      'locked_until', now() + interval '15 minutes', 'message', 'تم تجاوز المحاولات الخاطئة. أُقفل التحقق لمدة 15 دقيقة.');
  END IF;
  UPDATE public.admin_pins SET failed_attempts = v_pin_rec.failed_attempts + 1, updated_at = now()
    WHERE store_id = p_store_id;
  RETURN jsonb_build_object('ok', false, 'code', 'invalid_pin',
    'attempts_remaining', 4 - v_pin_rec.failed_attempts, 'message', 'رمز PIN غير صحيح.');
END;
$$;
GRANT EXECUTE ON FUNCTION public.verify_admin_pin(UUID, TEXT) TO authenticated;

-- Prevent direct product reads from exposing cost to staff (and other authenticated clients).
-- Cost can be exposed later through an owner-checked RPC when a cost-management screen is added.
REVOKE SELECT ON public.products FROM authenticated;
GRANT SELECT (id, store_id, category_id, name, name_normalized, barcode, sku_small_text,
  unit, price, stock_quantity, min_stock, expiry_date, is_active, created_at, updated_at)
ON public.products TO authenticated;

-- Profit data is owner-only, even if a staff member calls the reporting RPC directly.
CREATE OR REPLACE FUNCTION public.get_profit_summary(
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
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_from TIMESTAMPTZ := coalesce(p_from_date, now() - interval '30 days');
  v_to TIMESTAMPTZ := coalesce(p_to_date, now());
BEGIN
  IF NOT public.is_store_owner(p_store_id) THEN
    RAISE EXCEPTION 'تقرير الأرباح متاح لمالك المتجر فقط.';
  END IF;
  RETURN QUERY
  WITH revenue_cost AS (
    SELECT count(DISTINCT s.id)::BIGINT AS scnt,
      coalesce(sum(si.line_total), 0)::NUMERIC(14,2) AS rev,
      coalesce(sum(si.cost_price_snapshot * si.quantity), 0)::NUMERIC(14,2) AS cost
    FROM public.sale_items si JOIN public.sales s ON s.id = si.sale_id
    WHERE s.store_id = p_store_id AND s.status = 'completed' AND s.created_at BETWEEN v_from AND v_to
  )
  SELECT scnt, rev, cost, (rev - cost)::NUMERIC(14,2),
    CASE WHEN rev > 0 THEN round(((rev - cost) / rev) * 100, 2)::NUMERIC(5,2) ELSE 0::NUMERIC(5,2) END
  FROM revenue_cost;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_profit_summary(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
