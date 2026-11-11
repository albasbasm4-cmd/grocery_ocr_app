CREATE OR REPLACE FUNCTION public.leave_store(p_store_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_user_id UUID := auth.uid();
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'يجب تسجيل الدخول.';
    END IF;

    IF EXISTS (SELECT 1 FROM public.store_members WHERE store_id = p_store_id AND user_id = v_user_id AND role = 'owner') THEN
        RAISE EXCEPTION 'لا يمكن لمالك المتجر مغادرته.';
    END IF;

    DELETE FROM public.store_members
    WHERE store_id = p_store_id AND user_id = v_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'أنت لست عضواً في هذا المتجر.';
    END IF;

    RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_my_stores()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_result JSONB;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN '[]'::JSONB;
    END IF;

    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'store_id', s.id,
        'name', s.name,
        'currency_code', s.currency_code,
        'currency_symbol', s.currency_symbol,
        'role', sm.role,
        'permission', sm.permission,
        'can_sell', sm.can_sell,
        'is_active', sm.is_active,
        'join_code', CASE WHEN sm.role = 'owner' THEN s.join_code ELSE NULL END
    ) ORDER BY (CASE WHEN sm.role = 'owner' THEN 0 ELSE 1 END), sm.created_at ASC), '[]'::JSONB)
    INTO v_result
    FROM public.store_members sm
    JOIN public.stores s ON s.id = sm.store_id
    WHERE sm.user_id = v_user_id AND sm.is_active = true;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.leave_store(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_store(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.list_my_stores() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_stores() TO authenticated;
