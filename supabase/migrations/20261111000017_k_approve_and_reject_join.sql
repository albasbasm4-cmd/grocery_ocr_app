CREATE OR REPLACE FUNCTION public.approve_join_request(
    p_request_id UUID,
    p_permission TEXT DEFAULT 'read',
    p_can_sell BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_req public.store_join_requests%ROWTYPE;
BEGIN
    SELECT * INTO v_req
    FROM public.store_join_requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF NOT FOUND OR v_req.status <> 'pending' THEN
        RAISE EXCEPTION 'طلب الانضمام غير موجود أو تمت معالجته مسبقاً.';
    END IF;

    IF NOT public.is_store_owner(v_req.store_id) THEN
        RAISE EXCEPTION 'قبول طلبات الانضمام متاح لمالك المتجر فقط.';
    END IF;

    IF NOT public.has_active_admin_session(v_req.store_id) THEN
        RAISE EXCEPTION 'يتطلب قبول طلب الانضمام تأكيد رمز PIN للمدير.';
    END IF;

    IF p_permission NOT IN ('read', 'write') THEN
        RAISE EXCEPTION 'الصلاحية المحددة غير صالحة: يجب أن تكون read أو write.';
    END IF;

    INSERT INTO public.store_members (store_id, user_id, role, permission, can_sell, is_active)
    VALUES (v_req.store_id, v_req.user_id, 'staff', p_permission, coalesce(p_can_sell, false), true)
    ON CONFLICT (store_id, user_id) DO UPDATE SET
        role = 'staff',
        permission = EXCLUDED.permission,
        can_sell = EXCLUDED.can_sell,
        is_active = true;

    UPDATE public.store_join_requests
    SET status = 'approved', decided_at = now(), decided_by = auth.uid()
    WHERE id = p_request_id;

    INSERT INTO public.store_audit_log (store_id, actor_id, action, target_user_id, details)
    VALUES (
        v_req.store_id, auth.uid(), 'approve_join_request', v_req.user_id,
        jsonb_build_object(
            'request_id', p_request_id,
            'permission', p_permission,
            'can_sell', coalesce(p_can_sell, false),
            'requester_email', v_req.requester_email
        )
    );

    RETURN jsonb_build_object(
        'ok', true,
        'store_id', v_req.store_id,
        'requester_email', v_req.requester_email,
        'user_id', v_req.user_id
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_join_request(
    p_request_id UUID,
    p_block_future BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_req public.store_join_requests%ROWTYPE;
BEGIN
    SELECT * INTO v_req
    FROM public.store_join_requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF NOT FOUND OR v_req.status <> 'pending' THEN
        RAISE EXCEPTION 'طلب الانضمام غير موجود أو تمت معالجته مسبقاً.';
    END IF;

    IF NOT public.is_store_owner(v_req.store_id) THEN
        RAISE EXCEPTION 'رفض طلبات الانضمام متاح لمالك المتجر فقط.';
    END IF;

    UPDATE public.store_join_requests
    SET status = 'rejected', decided_at = now(), decided_by = auth.uid()
    WHERE id = p_request_id;

    IF p_block_future THEN
        INSERT INTO public.store_join_blocks (store_id, user_id)
        VALUES (v_req.store_id, v_req.user_id)
        ON CONFLICT (store_id, user_id) DO NOTHING;
    END IF;

    INSERT INTO public.store_audit_log (store_id, actor_id, action, target_user_id, details)
    VALUES (
        v_req.store_id, auth.uid(), 'reject_join_request', v_req.user_id,
        jsonb_build_object(
            'request_id', p_request_id,
            'blocked', p_block_future,
            'requester_email', v_req.requester_email
        )
    );

    RETURN jsonb_build_object(
        'ok', true,
        'store_id', v_req.store_id,
        'requester_email', v_req.requester_email,
        'user_id', v_req.user_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_join_request(UUID, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_join_request(UUID, TEXT, BOOLEAN) TO authenticated;
REVOKE ALL ON FUNCTION public.reject_join_request(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_join_request(UUID, BOOLEAN) TO authenticated;
