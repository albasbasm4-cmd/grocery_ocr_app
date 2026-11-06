-- PIN is required for sensitive changes only (price, cost, availability, stock levels).
-- RLS remains owner-only for every product update, and the trigger compares OLD/NEW safely.
DROP POLICY IF EXISTS "products_update_owner" ON public.products;
CREATE POLICY "products_update_owner" ON public.products
FOR UPDATE TO authenticated
USING (public.is_store_owner(store_id))
WITH CHECK (public.is_store_owner(store_id));

CREATE OR REPLACE FUNCTION public.require_pin_for_sensitive_product_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF (NEW.price IS DISTINCT FROM OLD.price)
    OR (NEW.cost_price IS DISTINCT FROM OLD.cost_price)
    OR (NEW.is_active IS DISTINCT FROM OLD.is_active)
    OR (NEW.stock_quantity IS DISTINCT FROM OLD.stock_quantity)
    OR (NEW.min_stock IS DISTINCT FROM OLD.min_stock)
  THEN
    IF NOT public.is_store_owner(OLD.store_id) OR NOT public.has_active_admin_session(OLD.store_id) THEN
      RAISE EXCEPTION 'جلسة PIN فعالة للمالك مطلوبة لتغيير السعر أو المخزون أو حالة المنتج.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS products_sensitive_fields_pin ON public.products;
CREATE TRIGGER products_sensitive_fields_pin
BEFORE UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.require_pin_for_sensitive_product_change();

-- Staff may read sale detail for receipts but must never read historical cost snapshots.
REVOKE SELECT ON public.sale_items FROM authenticated;
GRANT SELECT (id, sale_id, product_id, product_name_snapshot, unit_price_snapshot, quantity, line_total)
ON public.sale_items TO authenticated;
