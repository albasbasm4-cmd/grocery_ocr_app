ALTER TABLE public.store_members
  ADD COLUMN IF NOT EXISTS permission TEXT NOT NULL DEFAULT 'read',
  ADD COLUMN IF NOT EXISTS can_sell BOOLEAN NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_store_members_permission'
  ) THEN
    ALTER TABLE public.store_members
      ADD CONSTRAINT chk_store_members_permission CHECK (permission IN ('read', 'write'));
  END IF;
END $$;

UPDATE public.store_members
SET permission = 'read', can_sell = true
WHERE role = 'staff';

CREATE UNIQUE INDEX IF NOT EXISTS uq_store_members_single_owner
ON public.store_members (store_id)
WHERE (role = 'owner');

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS join_code TEXT;

CREATE OR REPLACE FUNCTION public.generate_store_join_code()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_chars TEXT := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_code TEXT := '';
  v_i INT;
  v_len INT := 7;
BEGIN
  FOR v_i IN 1..v_len LOOP
    v_code := v_code || substr(v_chars, floor(random() * length(v_chars) + 1)::int, 1);
  END LOOP;
  RETURN v_code;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_set_store_join_code()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_candidate TEXT;
  v_tries INT := 0;
BEGIN
  IF NEW.join_code IS NULL OR trim(NEW.join_code) = '' THEN
    LOOP
      v_candidate := public.generate_store_join_code();
      v_tries := v_tries + 1;
      IF NOT EXISTS (SELECT 1 FROM public.stores WHERE join_code = v_candidate) THEN
        NEW.join_code := v_candidate;
        EXIT;
      END IF;
      IF v_tries > 20 THEN
        RAISE EXCEPTION 'تعذر توليد رمز انضمام فريد للمتجر.';
      END IF;
    END LOOP;
  ELSE
    NEW.join_code := upper(trim(NEW.join_code));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stores_join_code ON public.stores;
CREATE TRIGGER trg_stores_join_code
BEFORE INSERT ON public.stores
FOR EACH ROW
EXECUTE FUNCTION public.trg_set_store_join_code();

DO $$
DECLARE
  v_store RECORD;
  v_candidate TEXT;
  v_tries INT;
BEGIN
  FOR v_store IN SELECT id FROM public.stores WHERE join_code IS NULL OR trim(join_code) = '' LOOP
    v_tries := 0;
    LOOP
      v_candidate := public.generate_store_join_code();
      v_tries := v_tries + 1;
      IF NOT EXISTS (SELECT 1 FROM public.stores WHERE join_code = v_candidate) THEN
        UPDATE public.stores SET join_code = v_candidate WHERE id = v_store.id;
        EXIT;
      END IF;
      IF v_tries > 20 THEN
        RAISE EXCEPTION 'تعذر توليد رمز انضمام فريد للمتجر القائم.';
      END IF;
    END LOOP;
  END LOOP;
END $$;

ALTER TABLE public.stores ALTER COLUMN join_code SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_stores_join_code'
  ) THEN
    ALTER TABLE public.stores ADD CONSTRAINT uq_stores_join_code UNIQUE (join_code);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.store_join_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requester_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  decided_by UUID REFERENCES auth.users(id),
  notified_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_store_join_requests_pending
ON public.store_join_requests (store_id, user_id)
WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_store_join_requests_store_status
ON public.store_join_requests (store_id, status);

CREATE INDEX IF NOT EXISTS idx_store_join_requests_user
ON public.store_join_requests (user_id);

CREATE TABLE IF NOT EXISTS public.pin_reset_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pin_reset_codes_lookup
ON public.pin_reset_codes (store_id, user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.store_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES auth.users(id),
  action TEXT NOT NULL,
  target_user_id UUID REFERENCES auth.users(id),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_store_audit_log_store
ON public.store_audit_log (store_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.store_join_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_store_join_blocks UNIQUE (store_id, user_id)
);
