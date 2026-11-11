CREATE OR REPLACE FUNCTION public.prevent_owner_deletion_or_deactivation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.role = 'owner' THEN
      RAISE EXCEPTION 'لا يمكن حذف مالك المتجر.';
    END IF;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.role = 'owner' AND (NEW.is_active = FALSE OR NEW.role <> 'owner') THEN
      RAISE EXCEPTION 'لا يمكن تعطيل مالك المتجر أو تغيير دوره.';
    END IF;
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_owner_tampering ON public.store_members;
CREATE TRIGGER trg_prevent_owner_tampering
BEFORE UPDATE OR DELETE ON public.store_members
FOR EACH ROW EXECUTE FUNCTION public.prevent_owner_deletion_or_deactivation();

DROP TRIGGER IF EXISTS products_sensitive_fields_pin ON public.products;
DROP TRIGGER IF EXISTS products_insert_pin ON public.products;

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
      IF NEW.cost_price IS NOT NULL THEN
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

DROP TRIGGER IF EXISTS trg_enforce_product_write_permissions ON public.products;
CREATE TRIGGER trg_enforce_product_write_permissions
BEFORE INSERT OR UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.enforce_product_write_permissions();

CREATE OR REPLACE FUNCTION public.update_product_sensitive(
  p_store_id UUID,
  p_product_id UUID,
  p_selling_price NUMERIC(14,2) DEFAULT NULL,
  p_cost_price NUMERIC(14,2) DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_is_owner BOOLEAN;
  v_can_write BOOLEAN;
BEGIN
  v_is_owner := public.is_store_owner(p_store_id);
  v_can_write := EXISTS (
    SELECT 1 FROM public.store_members
    WHERE store_id = p_store_id
      AND user_id = auth.uid()
      AND is_active = true
      AND permission = 'write'
  );

  IF NOT (v_is_owner OR v_can_write) THEN
    RAISE EXCEPTION 'غير مصرح: ليس لديك صلاحية تعديل هذا المنتج.';
  END IF;

  IF NOT v_is_owner THEN
    IF p_cost_price IS NOT NULL THEN
      RAISE EXCEPTION 'غير مصرح: لا يمكن للموظف تعديل سعر التكلفة.';
    END IF;
    IF p_is_active IS NOT NULL THEN
      RAISE EXCEPTION 'غير مصرح: لا يمكن للموظف تغيير حالة تفعيل المنتج.';
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product_id AND store_id = p_store_id) THEN
    RAISE EXCEPTION 'المنتج غير موجود في هذا المتجر.';
  END IF;

  UPDATE public.products SET
    price      = COALESCE(p_selling_price, price),
    cost_price = CASE WHEN v_is_owner THEN COALESCE(p_cost_price, cost_price) ELSE cost_price END,
    is_active  = CASE WHEN v_is_owner THEN COALESCE(p_is_active, is_active) ELSE is_active END,
    updated_at = now()
  WHERE id = p_product_id AND store_id = p_store_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_product_sensitive(UUID, UUID, NUMERIC, NUMERIC, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_product_sensitive(UUID, UUID, NUMERIC, NUMERIC, BOOLEAN) TO authenticated;
