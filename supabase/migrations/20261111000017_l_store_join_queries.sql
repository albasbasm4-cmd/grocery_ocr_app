CREATE OR REPLACE FUNCTION public.get_store_join_requests(p_store_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_result JSONB;
BEGIN
    IF NOT public.is_store_owner(p_store_id) THEN
        RAISE EXCEPTION 'عرض طلبات الانضمام متاح لمالك المتجر فقط.';
    END IF;

    UPDATE public.store_join_requests
    SET status = 'expired', decided_at = now()
    WHERE store_id = p_store_id AND status = 'pending' AND created_at < now() - interval '7 days';

    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id,
        'store_id', r.store_id,
        'user_id', r.user_id,
        'requester_email', r.requester_email,
        'status', r.status,
        'created_at', r.created_at,
        'decided_at', r.decided_at
    ) ORDER BY (CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END), r.created_at DESC), '[]'::JSONB)
    INTO v_result
    FROM public.store_join_requests r
    WHERE r.store_id = p_store_id;

    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_pending_join_requests_count(p_store_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_count INT;
BEGIN
    IF NOT public.is_store_owner(p_store_id) THEN
        RETURN 0;
    END IF;

    UPDATE public.store_join_requests
    SET status = 'expired', decided_at = now()
    WHERE store_id = p_store_id AND status = 'pending' AND created_at < now() - interval '7 days';

    SELECT count(*) INTO v_count
    FROM public.store_join_requests
    WHERE store_id = p_store_id AND status = 'pending';

    RETURN coalesce(v_count, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_join_requests()
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

    UPDATE public.store_join_requests
    SET status = 'expired', decided_at = now()
    WHERE user_id = v_user_id AND status = 'pending' AND created_at < now() - interval '7 days';

    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id,
        'store_id', r.store_id,
        'store_name', s.name,
        'status', r.status,
        'created_at', r.created_at,
        'decided_at', r.decided_at
    ) ORDER BY r.created_at DESC), '[]'::JSONB)
    INTO v_result
    FROM public.store_join_requests r
    JOIN public.stores s ON s.id = r.store_id
    WHERE r.user_id = v_user_id;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_store_join_requests(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_store_join_requests(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.get_pending_join_requests_count(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pending_join_requests_count(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.get_my_join_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_join_requests() TO authenticated;
