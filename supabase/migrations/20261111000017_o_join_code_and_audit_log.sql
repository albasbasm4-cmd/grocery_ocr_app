CREATE OR REPLACE FUNCTION public.regenerate_store_join_code(p_store_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_candidate TEXT;
    v_tries INT := 0;
BEGIN
    IF NOT public.is_store_owner(p_store_id) THEN
        RAISE EXCEPTION 'إعادة توليد رمز الانضمام متاح لمالك المتجر فقط.';
    END IF;

    IF NOT public.has_active_admin_session(p_store_id) THEN
        RAISE EXCEPTION 'تتطلب إعادة توليد رمز الانضمام تأكيد رمز PIN للمدير.';
    END IF;

    LOOP
        v_candidate := public.generate_store_join_code();
        v_tries := v_tries + 1;
        IF NOT EXISTS (SELECT 1 FROM public.stores WHERE join_code = v_candidate) THEN
            EXIT;
        END IF;
        IF v_tries > 20 THEN
            RAISE EXCEPTION 'تعذر توليد رمز انضمام جديد.';
        END IF;
    END LOOP;

    UPDATE public.stores
    SET join_code = v_candidate
    WHERE id = p_store_id;

    INSERT INTO public.store_audit_log (store_id, actor_id, action, target_user_id, details)
    VALUES (
        p_store_id, auth.uid(), 'regenerate_join_code', auth.uid(),
        jsonb_build_object('new_code', v_candidate)
    );

    RETURN v_candidate;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_store_audit_log(p_store_id UUID, p_limit INT DEFAULT 50)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_result JSONB;
BEGIN
    IF NOT public.is_store_owner(p_store_id) THEN
        RAISE EXCEPTION 'سجل التدقيق متاح لمالك المتجر فقط.';
    END IF;

    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', l.id,
        'action', l.action,
        'actor_id', l.actor_id,
        'target_user_id', l.target_user_id,
        'details', l.details,
        'created_at', l.created_at
    ) ORDER BY l.created_at DESC), '[]'::JSONB)
    INTO v_result
    FROM (
        SELECT * FROM public.store_audit_log
        WHERE store_id = p_store_id
        ORDER BY created_at DESC
        LIMIT least(greatest(coalesce(p_limit, 50), 1), 100)
    ) l;

    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_admin_pin(p_store_id UUID, p_new_pin TEXT, p_old_pin TEXT DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE v_current public.admin_pins%ROWTYPE;
BEGIN
  IF NOT public.is_store_owner(p_store_id) THEN RAISE EXCEPTION 'تعيين رمز PIN متاح لمالك المتجر فقط.'; END IF;
  IF p_new_pin !~ '^[0-9]{4,8}$' THEN RAISE EXCEPTION 'يجب أن يتكون PIN من 4 إلى 8 أرقام.'; END IF;
  SELECT * INTO v_current FROM public.admin_pins WHERE store_id = p_store_id FOR UPDATE;
  IF FOUND THEN
    IF p_old_pin IS NULL OR crypt(p_old_pin, v_current.pin_hash) <> v_current.pin_hash THEN
      RAISE EXCEPTION 'رمز PIN الحالي غير صحيح.';
    END IF;
    UPDATE public.admin_pins SET pin_hash = crypt(p_new_pin, gen_salt('bf')),
      failed_attempts = 0, locked_until = NULL, updated_at = now() WHERE store_id = p_store_id;
  ELSE
    INSERT INTO public.admin_pins(store_id, pin_hash, failed_attempts, locked_until)
      VALUES (p_store_id, crypt(p_new_pin, gen_salt('bf')), 0, NULL);
  END IF;

  INSERT INTO public.store_audit_log (store_id, actor_id, action, target_user_id, details)
  VALUES (p_store_id, auth.uid(), 'change_pin', auth.uid(), '{}'::jsonb);

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.regenerate_store_join_code(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.regenerate_store_join_code(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.get_store_audit_log(UUID, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_store_audit_log(UUID, INT) TO authenticated;
REVOKE ALL ON FUNCTION public.set_admin_pin(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_admin_pin(UUID, TEXT, TEXT) TO authenticated;
