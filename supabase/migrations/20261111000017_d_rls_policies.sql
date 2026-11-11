ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_join_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pin_reset_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_join_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "products_insert_owner" ON public.products;
DROP POLICY IF EXISTS "products_insert_permission" ON public.products;
CREATE POLICY "products_insert_permission" ON public.products
FOR INSERT TO authenticated
WITH CHECK (
  public.is_store_owner(store_id)
  OR EXISTS (
    SELECT 1 FROM public.store_members
    WHERE store_id = products.store_id
      AND user_id = auth.uid()
      AND is_active = true
      AND permission = 'write'
  )
);

DROP POLICY IF EXISTS "products_update_owner" ON public.products;
DROP POLICY IF EXISTS "products_update_permission" ON public.products;
CREATE POLICY "products_update_permission" ON public.products
FOR UPDATE TO authenticated
USING (
  public.is_store_owner(store_id)
  OR EXISTS (
    SELECT 1 FROM public.store_members
    WHERE store_id = products.store_id
      AND user_id = auth.uid()
      AND is_active = true
      AND permission = 'write'
  )
)
WITH CHECK (
  public.is_store_owner(store_id)
  OR EXISTS (
    SELECT 1 FROM public.store_members
    WHERE store_id = products.store_id
      AND user_id = auth.uid()
      AND is_active = true
      AND permission = 'write'
  )
);

DROP POLICY IF EXISTS "categories_insert_owner" ON public.categories;
DROP POLICY IF EXISTS "categories_insert_permission" ON public.categories;
CREATE POLICY "categories_insert_permission" ON public.categories
FOR INSERT TO authenticated
WITH CHECK (
  public.is_store_owner(store_id)
  OR EXISTS (
    SELECT 1 FROM public.store_members
    WHERE store_id = categories.store_id
      AND user_id = auth.uid()
      AND is_active = true
      AND permission = 'write'
  )
);

DROP POLICY IF EXISTS "categories_update_owner" ON public.categories;
DROP POLICY IF EXISTS "categories_update_permission" ON public.categories;
CREATE POLICY "categories_update_permission" ON public.categories
FOR UPDATE TO authenticated
USING (
  public.is_store_owner(store_id)
  OR EXISTS (
    SELECT 1 FROM public.store_members
    WHERE store_id = categories.store_id
      AND user_id = auth.uid()
      AND is_active = true
      AND permission = 'write'
  )
)
WITH CHECK (
  public.is_store_owner(store_id)
  OR EXISTS (
    SELECT 1 FROM public.store_members
    WHERE store_id = categories.store_id
      AND user_id = auth.uid()
      AND is_active = true
      AND permission = 'write'
  )
);

DROP POLICY IF EXISTS "categories_delete_owner" ON public.categories;
CREATE POLICY "categories_delete_owner" ON public.categories
FOR DELETE TO authenticated
USING (public.is_store_owner(store_id));

DROP POLICY IF EXISTS "store_join_requests_select_user" ON public.store_join_requests;
CREATE POLICY "store_join_requests_select_user" ON public.store_join_requests
FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.is_store_owner(store_id));

DROP POLICY IF EXISTS "store_join_requests_update_cancel" ON public.store_join_requests;
CREATE POLICY "store_join_requests_update_cancel" ON public.store_join_requests
FOR UPDATE TO authenticated
USING (user_id = auth.uid() AND status = 'pending')
WITH CHECK (user_id = auth.uid() AND status = 'cancelled');

DROP POLICY IF EXISTS "store_audit_log_select_owner" ON public.store_audit_log;
CREATE POLICY "store_audit_log_select_owner" ON public.store_audit_log
FOR SELECT TO authenticated
USING (public.is_store_owner(store_id));

DROP POLICY IF EXISTS "store_join_blocks_select_owner" ON public.store_join_blocks;
CREATE POLICY "store_join_blocks_select_owner" ON public.store_join_blocks
FOR SELECT TO authenticated
USING (public.is_store_owner(store_id));
