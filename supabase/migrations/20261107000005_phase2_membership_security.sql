-- Phase 2: per-store membership status and server-only staff administration.
-- Direct store_members writes are deliberately disallowed; manage-staff Edge Function uses service_role.
ALTER TABLE public.store_members
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.is_store_member(p_store_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.store_members
    WHERE store_id = p_store_id AND user_id = auth.uid() AND is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_store_owner(p_store_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.store_members
    WHERE store_id = p_store_id AND user_id = auth.uid()
      AND role = 'owner' AND is_active = true
  );
$$;

-- Remove the broad owner FOR ALL policy: role changes and membership removal must go through
-- the owner/PIN-checked Edge Function, not a client-side table mutation.
DROP POLICY IF EXISTS "store_members_modify_owner" ON public.store_members;
DROP POLICY IF EXISTS "store_members_select" ON public.store_members;
CREATE POLICY "store_members_select" ON public.store_members
FOR SELECT TO authenticated
USING (public.is_store_member(store_id));

-- Make PIN verification owner-only even if a staff member calls the RPC directly.
CREATE OR REPLACE FUNCTION public.verify_admin_pin(p_store_id UUID, p_pin TEXT)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_pin_rec public.admin_pins%ROWTYPE;
  v_expires TIMESTAMPTZ;
BEGIN
  IF NOT public.is_store_owner(p_store_id) THEN
    RAISE EXCEPTION 'التحقق برمز PIN متاح لمالك المتجر فقط.';
  END IF;
  SELECT * INTO v_pin_rec FROM public.admin_pins WHERE store_id = p_store_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'لم يتم تعيين رمز PIN للمدير في هذا المتجر بعد.'; END IF;
  IF v_pin_rec.locked_until IS NOT NULL AND v_pin_rec.locked_until > now() THEN
    RAISE EXCEPTION 'تم قفل التحقق مؤقتاً حتى %', v_pin_rec.locked_until;
  END IF;
  IF crypt(p_pin, v_pin_rec.pin_hash) = v_pin_rec.pin_hash THEN
    v_expires := now() + interval '10 minutes';
    UPDATE public.admin_pins SET failed_attempts = 0, locked_until = NULL, updated_at = now()
      WHERE store_id = p_store_id;
    INSERT INTO public.admin_sessions(store_id, user_id, expires_at)
      VALUES (p_store_id, auth.uid(), v_expires);
    RETURN v_expires;
  END IF;
  IF v_pin_rec.failed_attempts + 1 >= 5 THEN
    UPDATE public.admin_pins SET failed_attempts = v_pin_rec.failed_attempts + 1,
      locked_until = now() + interval '15 minutes', updated_at = now() WHERE store_id = p_store_id;
    RAISE EXCEPTION 'تم تجاوز المحاولات الخاطئة. أُقفل التحقق لمدة 15 دقيقة.';
  END IF;
  UPDATE public.admin_pins SET failed_attempts = v_pin_rec.failed_attempts + 1, updated_at = now()
    WHERE store_id = p_store_id;
  RAISE EXCEPTION 'رمز PIN غير صحيح. المحاولات المتبقية: %', 4 - v_pin_rec.failed_attempts;
END;
$$;

-- set_admin_pin must not be invoked by staff. Enforce 4-6 digits consistently with the UI.
CREATE OR REPLACE FUNCTION public.set_admin_pin(p_store_id UUID, p_new_pin TEXT, p_old_pin TEXT DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE v_current public.admin_pins%ROWTYPE;
BEGIN
  IF NOT public.is_store_owner(p_store_id) THEN RAISE EXCEPTION 'تعيين رمز PIN متاح لمالك المتجر فقط.'; END IF;
  IF p_new_pin !~ '^\d{4,6}$' THEN RAISE EXCEPTION 'يجب أن يتكون PIN من 4 إلى 6 أرقام.'; END IF;
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
  RETURN true;
END;
$$;

-- Harden product updates: only a verified owner can update; the existing policy's PIN requirement
-- is intentionally kept as a conservative database-level boundary for all product updates.
DROP POLICY IF EXISTS "products_update_owner" ON public.products;
CREATE POLICY "products_update_owner" ON public.products
FOR UPDATE TO authenticated
USING (public.is_store_owner(store_id) AND public.has_active_admin_session(store_id))
WITH CHECK (public.is_store_owner(store_id) AND public.has_active_admin_session(store_id));

GRANT EXECUTE ON FUNCTION public.is_store_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_store_owner(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_admin_pin(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_admin_pin(UUID, TEXT, TEXT) TO authenticated;
