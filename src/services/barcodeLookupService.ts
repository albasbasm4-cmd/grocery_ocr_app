import { supabase } from '../lib/supabase';
import type { Product } from '../types';
import { normalizeArabic } from '../lib/arabic';

/** Search exact barcode and small SKU together. Partial short codes return candidates. */
export async function lookupProductsByCode(storeId: string, value: string): Promise<Product[]> {
  const code = value.trim();
  if (!code) return [];
  const normalized = normalizeArabic(code);
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
  for (const row of [...(byBarcode.data ?? []), ...(bySku.data ?? []), ...(barcodePartial.data ?? []), ...(skuPartial.data ?? [])]) unique.set(row.id, row as Product);
  return [...unique.values()].slice(0, 10);
}
