CREATE OR REPLACE FUNCTION public.has_store_permission(p_store_id UUID, p_min_permission TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.store_members
    WHERE store_id = p_store_id
      AND user_id = auth.uid()
      AND is_active = true
      AND (
        role = 'owner'
        OR (
          role = 'staff'
          AND (
            p_min_permission = 'read'
            OR (p_min_permission = 'write' AND permission = 'write')
          )
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_store_member_sell(p_store_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.store_members
    WHERE store_id = p_store_id
      AND user_id = auth.uid()
      AND is_active = true
      AND (role = 'owner' OR (role = 'staff' AND can_sell = true))
  );
$$;

CREATE OR REPLACE FUNCTION public.normalize_product_unit(p_unit TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN lower(trim(coalesce(p_unit, 'piece'))) IN ('piece', 'حبة', 'حبه', 'قطعة', 'قطعه', 'واحد') THEN 'piece'
    WHEN lower(trim(coalesce(p_unit, 'piece'))) IN ('kg', 'كيلو', 'كيلوجرام', 'كجم') THEN 'kg'
    WHEN lower(trim(coalesce(p_unit, 'piece'))) IN ('g', 'غرام', 'جرام', 'غم') THEN 'g'
    WHEN lower(trim(coalesce(p_unit, 'piece'))) IN ('carton', 'كرتون', 'كرتونة', 'كرتونه') THEN 'carton'
    WHEN lower(trim(coalesce(p_unit, 'piece'))) IN ('pack', 'باكت', 'بكت', 'باقة', 'باقه') THEN 'pack'
    WHEN lower(trim(coalesce(p_unit, 'piece'))) IN ('box', 'علبة', 'علبه', 'صندوق') THEN 'box'
    WHEN lower(trim(coalesce(p_unit, 'piece'))) IN ('piece', 'kg', 'g', 'carton', 'pack', 'box', 'other') THEN lower(trim(p_unit))
    ELSE 'other'
  END;
$$;

REVOKE ALL ON FUNCTION public.has_store_permission(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_store_permission(UUID, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.can_store_member_sell(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_store_member_sell(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.normalize_product_unit(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.normalize_product_unit(TEXT) TO authenticated;
