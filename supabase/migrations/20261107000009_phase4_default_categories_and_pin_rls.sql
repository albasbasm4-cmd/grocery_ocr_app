-- المرحلة الرابعة: تصنيفات المتجر المقترحة وحماية إدارة التصنيفات بجلسة PIN

CREATE OR REPLACE FUNCTION public.seed_default_store_categories()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.categories (store_id, name, name_normalized)
  VALUES
    (NEW.id, 'ألبان', public.normalize_arabic('ألبان')),
    (NEW.id, 'حلويات', public.normalize_arabic('حلويات')),
    (NEW.id, 'خضروات', public.normalize_arabic('خضروات')),
    (NEW.id, 'فواكه', public.normalize_arabic('فواكه')),
    (NEW.id, 'مشروبات', public.normalize_arabic('مشروبات')),
    (NEW.id, 'معلبات', public.normalize_arabic('معلبات')),
    (NEW.id, 'منظفات', public.normalize_arabic('منظفات'))
  ON CONFLICT (store_id, name_normalized) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_default_store_categories ON public.stores;
CREATE TRIGGER trg_seed_default_store_categories
AFTER INSERT ON public.stores
FOR EACH ROW
EXECUTE FUNCTION public.seed_default_store_categories();

-- الإضافة متاحة للمالك، أما تعديل/حذف التصنيف فيتطلب جلسة PIN فعالة.
DROP POLICY IF EXISTS "categories_insert_owner" ON public.categories;
CREATE POLICY "categories_insert_owner" ON public.categories
FOR INSERT TO authenticated
WITH CHECK (public.is_store_owner(store_id) AND public.has_active_admin_session(store_id));

DROP POLICY IF EXISTS "categories_update_owner" ON public.categories;
CREATE POLICY "categories_update_owner" ON public.categories
FOR UPDATE TO authenticated
USING (public.is_store_owner(store_id) AND public.has_active_admin_session(store_id))
WITH CHECK (public.is_store_owner(store_id) AND public.has_active_admin_session(store_id));

DROP POLICY IF EXISTS "categories_delete_owner" ON public.categories;
CREATE POLICY "categories_delete_owner" ON public.categories
FOR DELETE TO authenticated
USING (public.is_store_owner(store_id) AND public.has_active_admin_session(store_id));

-- إضافة المنتج تشمل السعر والتكلفة، لذا تتطلب جلسة PIN منذ لحظة الإدخال.
CREATE OR REPLACE FUNCTION public.require_pin_for_product_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.is_store_owner(NEW.store_id) OR NOT public.has_active_admin_session(NEW.store_id) THEN
    RAISE EXCEPTION 'جلسة PIN فعالة للمالك مطلوبة لإضافة منتج.';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS products_insert_pin ON public.products;
CREATE TRIGGER products_insert_pin
BEFORE INSERT ON public.products
FOR EACH ROW EXECUTE FUNCTION public.require_pin_for_product_insert();

-- منع حذف التصنيف إذا ارتبطت به منتجات، بما في ذلك حالات السباق بين التحقق والحذف.
CREATE OR REPLACE FUNCTION public.prevent_category_delete_with_products()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.products WHERE category_id = OLD.id LIMIT 1) THEN
    RAISE EXCEPTION 'لا يمكن حذف تصنيف يحتوي على منتجات. انقل المنتجات إلى تصنيف آخر أولاً.';
  END IF;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS categories_no_delete_with_products ON public.categories;
CREATE TRIGGER categories_no_delete_with_products
BEFORE DELETE ON public.categories
FOR EACH ROW EXECUTE FUNCTION public.prevent_category_delete_with_products();
