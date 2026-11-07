import { supabase } from '../lib/supabase';
import { Category } from '../types';
import { normalizeArabic } from '../lib/arabic';
import { offlineDb } from '../lib/offlineDb';
import { isOnline, assertOnline } from '../lib/offlineGuard';
import { ar } from '../i18n/ar';

export const DEFAULT_SUGGESTED_CATEGORIES = [
  'ألبان',
  'حلويات',
  'خضروات',
  'فواكه',
  'مشروبات',
  'معلبات',
  'منظفات',
];

export async function fetchCategories(storeId: string): Promise<Category[]> {
  if (!isOnline()) {
    try {
      return await offlineDb.categories.where('store_id').equals(storeId).toArray();
    } catch {
      return [];
    }
  }

  try {
    const { data, error } = await supabase
      .from('categories')
      .select('id, store_id, name, name_normalized, created_at')
      .eq('store_id', storeId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    const categories = (data || []) as Category[];
    await offlineDb.categories.bulkPut(categories).catch(() => undefined);
    return categories;
  } catch (err) {
    return await offlineDb.categories.where('store_id').equals(storeId).toArray().catch(() => []);
  }
}

export async function createCategory(storeId: string, name: string): Promise<Category> {
  assertOnline(ar.addCategory);

  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error(ar.categoryNameRequired);
  }

  const { data, error } = await supabase
    .from('categories')
    .insert({
      store_id: storeId,
      name: trimmed,
      name_normalized: normalizeArabic(trimmed),
    })
    .select('id, store_id, name, name_normalized, created_at')
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new Error(ar.duplicateCategory);
    }
    throw new Error(error.message);
  }

  await offlineDb.categories.put(data as Category).catch(() => undefined);

  return data as Category;
}

export async function updateCategory(categoryId: string, name: string): Promise<Category> {
  assertOnline(ar.editCategory);

  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error(ar.categoryNameRequired);
  }

  const { data, error } = await supabase
    .from('categories')
    .update({
      name: trimmed,
      name_normalized: normalizeArabic(trimmed),
    })
    .eq('id', categoryId)
    .select('id, store_id, name, name_normalized, created_at')
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new Error(ar.duplicateCategory);
    }
    throw new Error(error.message);
  }

  await offlineDb.categories.put(data as Category).catch(() => undefined);

  return data as Category;
}

export async function countProductsInCategory(categoryId: string): Promise<number> {
  const { count, error } = await supabase
    .from('products')
    .select('id', { count: 'exact', head: true })
    .eq('category_id', categoryId);

  if (error) {
    throw new Error(error.message);
  }

  return count || 0;
}

export async function deleteCategory(
  categoryId: string,
  targetCategoryIdToMove?: string
): Promise<void> {
  assertOnline(ar.deleteCategory);

  // إذا طُلب نقل المنتجات أولاً إلى تصنيف آخر
  if (targetCategoryIdToMove) {
    const { error: moveError } = await supabase
      .from('products')
      .update({ category_id: targetCategoryIdToMove })
      .eq('category_id', categoryId);

    if (moveError) {
      throw new Error(ar.actionMoveProductsError(moveError.message));
    }
  } else {
    // تحقق من عدم وجود منتجات تمنع الحذف
    const count = await countProductsInCategory(categoryId);
    if (count > 0) {
      throw new Error(
        ar.categoryDeleteCountBlocked(count)
      );
    }
  }

  const { error } = await supabase.from('categories').delete().eq('id', categoryId);

  if (error) {
    throw new Error(error.message);
  }

  await offlineDb.categories.delete(categoryId).catch(() => undefined);
}

export async function seedDefaultCategories(storeId: string): Promise<Category[]> {
  assertOnline('تهيئة التصنيفات الافتراضية');

  const rows = DEFAULT_SUGGESTED_CATEGORIES.map((name) => ({
    store_id: storeId,
    name,
    name_normalized: normalizeArabic(name),
  }));

  const { data, error } = await supabase
    .from('categories')
    .upsert(rows, { onConflict: 'store_id,name_normalized', ignoreDuplicates: true })
    .select();

  if (error) {
    throw new Error(error.message);
  }

  return (data || []) as Category[];
}
