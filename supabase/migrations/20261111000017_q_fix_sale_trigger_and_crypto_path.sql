CREATE OR REPLACE FUNCTION public.enforce_product_write_permissions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_store_id UUID;
  v_is_owner BOOLEAN;
  v_can_write BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - 'stock_quantity' - 'updated_at') = (to_jsonb(OLD) - 'stock_quantity' - 'updated_at') THEN
      RETURN NEW;
    END IF;
  END IF;

  v_store_id := COALESCE(NEW.store_id, OLD.store_id);
  v_is_owner := public.is_store_owner(v_store_id);
  v_can_write := EXISTS (
    SELECT 1 FROM public.store_members
    WHERE store_id = v_store_id
      AND user_id = auth.uid()
      AND is_active = true
      AND permission = 'write'
  );

  IF NOT (v_is_owner OR v_can_write) THEN
    RAISE EXCEPTION 'غير مصرح: ليس لديك صلاحية تعديل أو إضافة منتجات في هذا المتجر.';
  END IF;

  IF NOT v_is_owner THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.cost_price IS DISTINCT FROM 0 THEN
        RAISE EXCEPTION 'غير مصرح: لا يمكن للموظف تحديد سعر التكلفة.';
      END IF;
      IF NEW.is_active = FALSE THEN
        RAISE EXCEPTION 'غير مصرح: لا يمكن للموظف تعطيل المنتج.';
      END IF;
    ELSIF TG_OP = 'UPDATE' THEN
      IF NEW.cost_price IS DISTINCT FROM OLD.cost_price THEN
        RAISE EXCEPTION 'غير مصرح: لا يمكن للموظف تعديل سعر التكلفة.';
      END IF;
      IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
        RAISE EXCEPTION 'غير مصرح: لا يمكن للموظف تغيير حالة تفعيل المنتج.';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.set_admin_pin(UUID, TEXT, TEXT) SET search_path = public, extensions, auth;
ALTER FUNCTION public.reset_admin_pin_with_code(UUID, TEXT, TEXT) SET search_path = public, extensions, auth;

CREATE OR REPLACE FUNCTION public.block_expired_join_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'pending' AND NEW.status = 'approved' AND OLD.created_at < now() - interval '7 days' THEN
    RAISE EXCEPTION 'انتهت صلاحية طلب الانضمام (أكثر من 7 أيام).';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_expired_join_approval ON public.store_join_requests;
CREATE TRIGGER trg_block_expired_join_approval
BEFORE UPDATE ON public.store_join_requests
FOR EACH ROW EXECUTE FUNCTION public.block_expired_join_approval();
