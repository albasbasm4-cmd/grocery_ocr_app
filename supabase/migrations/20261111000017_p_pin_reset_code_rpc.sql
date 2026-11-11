CREATE OR REPLACE FUNCTION public.reset_admin_pin_with_code(
    p_store_id UUID,
    p_code TEXT,
    p_new_pin TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_reset_rec public.pin_reset_codes%ROWTYPE;
    v_code_hash TEXT;
    v_clean_code TEXT;
    v_clean_pin TEXT;
BEGIN
    IF NOT public.is_store_owner(p_store_id) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'استعادة رمز PIN متاحة لمالك المتجر فقط.');
    END IF;

    v_clean_pin := trim(p_new_pin);
    IF v_clean_pin !~ '^[0-9]{4,8}$' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'يجب أن يتكون رمز PIN الجديد من 4 إلى 8 أرقام.');
    END IF;

    v_clean_code := trim(p_code);
    IF v_clean_code !~ '^[0-9]{6}$' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'رمز التحقق غير صحيح.');
    END IF;

    v_code_hash := encode(digest(v_clean_code, 'sha256'), 'hex');

    SELECT * INTO v_reset_rec
    FROM public.pin_reset_codes
    WHERE store_id = p_store_id
      AND user_id = v_user_id
      AND used_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'لا يوجد رمز استعادة نشط. يرجى طلب رمز جديد.');
    END IF;

    IF v_reset_rec.expires_at < now() THEN
        RETURN jsonb_build_object('ok', false, 'error', 'انتهت صلاحية رمز الاستعادة. يرجى طلب رمز جديد.');
    END IF;

    IF v_reset_rec.attempts >= 5 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'تم تجاوز عدد المحاولات المسموح بها لهذا الرمز.');
    END IF;

    IF v_reset_rec.code_hash <> v_code_hash THEN
        UPDATE public.pin_reset_codes
        SET attempts = attempts + 1
        WHERE id = v_reset_rec.id;
        RETURN jsonb_build_object('ok', false, 'error', 'رمز التحقق غير صحيح.');
    END IF;

    UPDATE public.pin_reset_codes
    SET used_at = now()
    WHERE id = v_reset_rec.id;

    INSERT INTO public.admin_pins (store_id, pin_hash, failed_attempts, locked_until, updated_at)
    VALUES (p_store_id, crypt(v_clean_pin, gen_salt('bf')), 0, NULL, now())
    ON CONFLICT (store_id) DO UPDATE SET
        pin_hash = crypt(v_clean_pin, gen_salt('bf')),
        failed_attempts = 0,
        locked_until = NULL,
        updated_at = now();

    DELETE FROM public.admin_sessions WHERE store_id = p_store_id;

    INSERT INTO public.store_audit_log (store_id, actor_id, action, target_user_id, details)
    VALUES (
        p_store_id, v_user_id, 'reset_pin_with_code', v_user_id,
        jsonb_build_object('reset_code_id', v_reset_rec.id)
    );

    RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.reset_admin_pin_with_code(UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reset_admin_pin_with_code(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_admin_pin_with_code(UUID, TEXT, TEXT) TO authenticated;
