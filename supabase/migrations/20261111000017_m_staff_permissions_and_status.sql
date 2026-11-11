CREATE OR REPLACE FUNCTION public.set_member_permission(
    p_store_id UUID,
    p_user_id UUID,
    p_permission TEXT,
    p_can_sell BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    IF NOT public.is_store_owner(p_store_id) THEN
        RAISE EXCEPTION 'تعديل صلاحيات الموظفين متاح لمالك المتجر فقط.';
    END IF;

    IF NOT public.has_active_admin_session(p_store_id) THEN
        RAISE EXCEPTION 'يتطلب تعديل صلاحيات الموظف تأكيد رمز PIN للمدير.';
    END IF;

    IF EXISTS (SELECT 1 FROM public.store_members WHERE store_id = p_store_id AND user_id = p_user_id AND role = 'owner') THEN
        RAISE EXCEPTION 'لا يمكن تعديل صلاحيات مالك المتجر.';
    END IF;

    IF p_permission NOT IN ('read', 'write') THEN
        RAISE EXCEPTION 'الصلاحية غير صالحة: يجب أن تكون read أو write.';
    END IF;

    UPDATE public.store_members
    SET permission = p_permission,
        can_sell = coalesce(p_can_sell, true)
    WHERE store_id = p_store_id AND user_id = p_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'الموظف غير موجود في هذا المتجر.';
    END IF;

    INSERT INTO public.store_audit_log (store_id, actor_id, action, target_user_id, details)
    VALUES (
        p_store_id, auth.uid(), 'set_member_permission', p_user_id,
        jsonb_build_object('permission', p_permission, 'can_sell', p_can_sell)
    );

    RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.deactivate_store_member(
    p_store_id UUID,
    p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    IF NOT public.is_store_owner(p_store_id) THEN
        RAISE EXCEPTION 'تعطيل الموظفين متاح لمالك المتجر فقط.';
    END IF;

    IF NOT public.has_active_admin_session(p_store_id) THEN
        RAISE EXCEPTION 'يتطلب تعطيل الموظف تأكيد رمز PIN للمدير.';
    END IF;

    IF EXISTS (SELECT 1 FROM public.store_members WHERE store_id = p_store_id AND user_id = p_user_id AND role = 'owner') THEN
        RAISE EXCEPTION 'لا يمكن تعطيل مالك المتجر.';
    END IF;

    UPDATE public.store_members
    SET is_active = false
    WHERE store_id = p_store_id AND user_id = p_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'الموظف غير موجود في هذا المتجر.';
    END IF;

    INSERT INTO public.store_audit_log (store_id, actor_id, action, target_user_id, details)
    VALUES (p_store_id, auth.uid(), 'deactivate_member', p_user_id, '{}'::jsonb);

    RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_store_member(
    p_store_id UUID,
    p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    IF NOT public.is_store_owner(p_store_id) THEN
        RAISE EXCEPTION 'حذف الموظفين متاح لمالك المتجر فقط.';
    END IF;

    IF NOT public.has_active_admin_session(p_store_id) THEN
        RAISE EXCEPTION 'يتطلب حذف الموظف تأكيد رمز PIN للمدير.';
    END IF;

    IF EXISTS (SELECT 1 FROM public.store_members WHERE store_id = p_store_id AND user_id = p_user_id AND role = 'owner') THEN
        RAISE EXCEPTION 'لا يمكن حذف مالك المتجر.';
    END IF;

    DELETE FROM public.store_members
    WHERE store_id = p_store_id AND user_id = p_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'الموظف غير موجود في هذا المتجر.';
    END IF;

    INSERT INTO public.store_audit_log (store_id, actor_id, action, target_user_id, details)
    VALUES (p_store_id, auth.uid(), 'remove_member', p_user_id, '{}'::jsonb);

    RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.set_member_permission(UUID, UUID, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_member_permission(UUID, UUID, TEXT, BOOLEAN) TO authenticated;
REVOKE ALL ON FUNCTION public.deactivate_store_member(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deactivate_store_member(UUID, UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.remove_store_member(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_store_member(UUID, UUID) TO authenticated;
