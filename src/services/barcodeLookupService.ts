import { supabase } from '../lib/supabase';
import type { Product } from '../types';
import { normalizeArabic } from '../lib/arabic';
import { offlineDb } from '../lib/offlineDb';
import { isOnline } from '../lib/offlineGuard';

/**
 * البحث عن المنتجات بالباركود أو كود SKU الصغير
 * يدعم العمل دون اتصال بالإنترنت عبر IndexedDB (المرحلة 10)
 */
export async function lookupProductsByCode(storeId: string, value: string): Promise<Product[]> {
  const code = value.trim();
  if (!code) return [];
  const normalized = normalizeArabic(code);

  // إذا كان التطبيق دون اتصال، نقوم بالبحث فوراً في قاعدة البيانات المحلية Dexie
  if (!isOnline()) {
    return lookupProductsOffline(storeId, code, normalized);
  }

  try {
    const escaped = normalized.replace(/[\\%_]/g, (character) => `\\${character}`);
    const columns = 'id, store_id, category_id, name, name_normalized, barcode, sku_small_text, unit, price, stock_quantity, min_stock, expiry_date, is_active, created_at, updated_at';
    const [byBarcode, bySku, barcodePartial, skuPartial] = await Promise.all([
      supabase.from('products').select(columns).eq('store_id', storeId).eq('is_active', true).eq('barcode', code).limit(10),
      supabase.from('products').select(columns).eq('store_id', storeId).eq('is_active', true).eq('sku_small_text', code).limit(10),
      supabase.from('products').select(columns).eq('store_id', storeId).eq('is_active', true).ilike('barcode', `%${escaped}%`).limit(10),
      supabase.from('products').select(columns).eq('store_id', storeId).eq('is_active', true).ilike('sku_small_text', `%${escaped}%`).limit(10),
    ]);

    const failure = [byBarcode, bySku, barcodePartial, skuPartial].find((result) => result.error);
    if (failure?.error) throw new Error(failure.error.message);

    const unique = new Map<string, Product>();
    for (const row of [...(byBarcode.data ?? []), ...(bySku.data ?? []), ...(barcodePartial.data ?? []), ...(skuPartial.data ?? [])]) {
      unique.set(row.id, row as Product);
    }
    const results = [...unique.values()].slice(0, 10);

    // إذا لم نجد شيئاً على الخادم لسبب ما، نتفقد النسخة المحلية
    if (results.length === 0) {
      return lookupProductsOffline(storeId, code, normalized);
    }

    return results;
  } catch (err) {
    // في حال حدوث خطأ في الاتصال بالشبكة، نلجأ إلى IndexedDB
    return lookupProductsOffline(storeId, code, normalized);
  }
}

async function lookupProductsOffline(storeId: string, code: string, normalized: string): Promise<Product[]> {
  try {
    // 1. تسريع البحث المباشر للباركود عبر فهرس Dexie (O(1))
    if (code) {
      const exactBarcode = await offlineDb.products.where('barcode').equals(code).first();
      if (exactBarcode && exactBarcode.store_id === storeId && exactBarcode.is_active) {
        return [exactBarcode];
      }
      const exactSku = await offlineDb.products.where('sku_small_text').equals(code).first();
      if (exactSku && exactSku.store_id === storeId && exactSku.is_active) {
        return [exactSku];
      }
    }

    // 2. تسريع البحث النصي بالبادئة عبر فهرس name_normalized
    if (normalized.length >= 2) {
      const prefixMatches = await offlineDb.products
        .where('name_normalized')
        .startsWith(normalized)
        .filter((p) => p.store_id === storeId && p.is_active)
        .limit(10)
        .toArray();
      if (prefixMatches.length > 0) {
        return prefixMatches;
      }
    }

    // 3. مسح مرن للأجزاء المطابقة
    const allStoreProducts = await offlineDb.products
      .where('store_id')
      .equals(storeId)
      .and((p) => p.is_active)
      .toArray();

    const matches = allStoreProducts.filter((p) => {
      const pBarcode = p.barcode?.trim() || '';
      const pSku = p.sku_small_text?.trim() || '';
      return (
        pBarcode === code ||
        pSku === code ||
        (code.length >= 3 && (pBarcode.includes(code) || pSku.includes(code))) ||
        p.name_normalized.includes(normalized)
      );
    });

    return matches.slice(0, 10);
  } catch (err) {
    console.error('Offline barcode lookup error:', err);
    return [];
  }
}
