-- Allows the authenticated owner to safely resume onboarding if the app is refreshed
-- after store creation but before the first PIN is set. The PIN hash is never exposed.
CREATE OR REPLACE FUNCTION public.is_admin_pin_set(p_store_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.is_store_member(p_store_id) THEN
    RAISE EXCEPTION 'غير مصرح للوصول إلى إعدادات هذا المتجر.';
  END IF;
  RETURN EXISTS (SELECT 1 FROM public.admin_pins WHERE store_id = p_store_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.is_admin_pin_set(UUID) TO authenticated;
