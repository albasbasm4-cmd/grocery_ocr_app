CREATE OR REPLACE FUNCTION public.request_join_store(p_join_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_code TEXT;
    v_store public.stores%ROWTYPE;
    v_email TEXT;
    v_req_id UUID;
    v_daily_count INT;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'يجب تسجيل الدخول لتقديم طلب انضمام.';
    END IF;

    SELECT count(*) INTO v_daily_count
    FROM public.store_join_requests
    WHERE user_id = v_user_id AND created_at >= now() - interval '1 day';

    IF v_daily_count >= 5 THEN
        RAISE EXCEPTION 'تم تجاوز الحد الأقصى للطلبات اليومية (5 طلبات). يرجى المحاولة لاحقاً.';
    END IF;

    v_code := upper(trim(coalesce(p_join_code, '')));
    IF length(v_code) < 6 OR length(v_code) > 8 THEN
        RAISE EXCEPTION 'رمز المتجر غير صحيح أو غير متطابق.';
    END IF;

    SELECT * INTO v_store FROM public.stores WHERE join_code = v_code;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'رمز المتجر غير صحيح أو غير متطابق.';
    END IF;

    IF EXISTS (SELECT 1 FROM public.store_join_blocks WHERE store_id = v_store.id AND user_id = v_user_id) THEN
        RAISE EXCEPTION 'رمز المتجر غير صحيح أو غير متطابق.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.store_members
        WHERE store_id = v_store.id AND user_id = v_user_id AND is_active = true
    ) THEN
        RAISE EXCEPTION 'أنت عضو بالفعل في هذا المتجر.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.store_join_requests
        WHERE store_id = v_store.id AND user_id = v_user_id AND status = 'pending'
    ) THEN
        RAISE EXCEPTION 'لديك طلب انضمام معلّق بالفعل لهذا المتجر.';
    END IF;

    SELECT email INTO v_email FROM auth.users WHERE id = v_user_id;

    INSERT INTO public.store_join_requests (store_id, user_id, requester_email, status)
    VALUES (v_store.id, v_user_id, coalesce(v_email, ''), 'pending')
    RETURNING id INTO v_req_id;

    RETURN jsonb_build_object(
        'ok', true,
        'request_id', v_req_id,
        'store_id', v_store.id,
        'store_name', v_store.name
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_join_request(p_request_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_user_id UUID := auth.uid();
BEGIN
    UPDATE public.store_join_requests
    SET status = 'cancelled', decided_at = now()
    WHERE id = p_request_id AND user_id = v_user_id AND status = 'pending';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'تعذر إلغاء الطلب: الطلب غير موجود أو لم يعد معلقاً.';
    END IF;

    RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.request_join_store(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_join_store(TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.cancel_join_request(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_join_request(UUID) TO authenticated;
