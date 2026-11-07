import Decimal from 'decimal.js';
import { supabase } from '../lib/supabase';
import { Product, ProductUnit, StockMovement } from '../types';
import { normalizeArabic } from '../lib/arabic';
import { offlineDb } from '../lib/offlineDb';
import { isOnline, assertOnline } from '../lib/offlineGuard';
import { ar } from '../i18n/ar';

export interface ProductInput {
  name: string;
  category_id: string | null;
  barcode: string | null;
  sku_small_text: string | null;
  unit: ProductUnit;
  price: string;
  cost_price: string;
  stock_quantity?: string;
  min_stock?: string;
  expiry_date?: string | null;
}

export interface ProductsFilterOptions {
  categoryId?: string | null;
  filterType?: 'all' | 'low_stock' | 'expiring_soon' | 'inactive';
  searchQuery?: string;
}

export async function fetchProducts(
  storeId: string,
  options?: ProductsFilterOptions & { page?: number; pageSize?: number }
): Promise<{ products: Product[]; hasMore: boolean }> {
  if (!isOnline()) {
    return fetchProductsOffline(storeId, options);
  }

  try {
    const { data, error } = await supabase.rpc('get_products_page', {
      p_store_id: storeId,
      p_search: options?.searchQuery ?? '',
      p_category_id: options?.categoryId || null,
      p_filter: options?.filterType ?? 'all',
      p_page: options?.page ?? 0,
      p_page_size: options?.pageSize ?? 40,
    });
    if (error) throw new Error(error.message);
    const rows = (data || []) as Array<Product & { has_more: boolean }>;
    return { products: rows.map(({ has_more: _hasMore, ...product }) => product), hasMore: Boolean(rows[0]?.has_more) };
  } catch (err) {
    return fetchProductsOffline(storeId, options);
  }
}

async function fetchProductsOffline(
  storeId: string,
  options?: ProductsFilterOptions & { page?: number; pageSize?: number }
): Promise<{ products: Product[]; hasMore: boolean }> {
  try {
    let query = offlineDb.products.where('store_id').equals(storeId);
    let items = await query.toArray();

    if (options?.filterType === 'inactive') {
      items = items.filter((p) => !p.is_active);
    } else {
      items = items.filter((p) => p.is_active);
    }

    if (options?.categoryId) {
      items = items.filter((p) => p.category_id === options.categoryId);
    }

    if (options?.searchQuery) {
      const norm = normalizeArabic(options.searchQuery.trim());
      items = items.filter(
        (p) =>
          p.name_normalized.includes(norm) ||
          (p.barcode && p.barcode.includes(norm)) ||
          (p.sku_small_text && p.sku_small_text.includes(norm))
      );
    }

    if (options?.filterType === 'low_stock') {
      items = items.filter((p) => new Decimal(p.stock_quantity || '0').lessThanOrEqualTo(p.min_stock || '5'));
    }

    const pageSize = options?.pageSize ?? 40;
    const page = options?.page ?? 0;
    const paged = items.slice(page * pageSize, (page + 1) * pageSize);

    return { products: paged, hasMore: items.length > (page + 1) * pageSize };
  } catch {
    return { products: [], hasMore: false };
  }
}

export async function checkBarcodeConflict(
  storeId: string,
  barcode: string,
  excludeProductId?: string
): Promise<Product | null> {
  const cleanBarcode = barcode.trim();
  if (!cleanBarcode) return null;

  let query = supabase
    .from('products')
    .select('id, store_id, category_id, name, name_normalized, barcode, sku_small_text, unit, price, stock_quantity, min_stock, expiry_date, is_active, created_at, updated_at')
    .eq('store_id', storeId)
    .eq('barcode', cleanBarcode);

  if (excludeProductId) {
    query = query.neq('id', excludeProductId);
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    throw new Error(error.message);
  }

  return (data as Product) || null;
}

export async function createProduct(storeId: string, input: ProductInput): Promise<Product> {
  assertOnline(ar.actionOnlineAddNewProduct);

  const trimmedName = input.name.trim();
  if (!trimmedName) {
    throw new Error(ar.productNameRequired);
  }

  const priceNum = new Decimal(input.price || '0');
  if (!priceNum.isFinite() || priceNum.isNegative()) {
    throw new Error(ar.priceMustBeNonNegative);
  }

  const costNum = new Decimal(input.cost_price || '0');
  if (!costNum.isFinite() || costNum.isNegative()) {
    throw new Error(ar.costPriceMustBeNonNegative);
  }

  // فحص تعارض الباركود
  if (input.barcode && input.barcode.trim()) {
    const conflict = await checkBarcodeConflict(storeId, input.barcode);
    if (conflict) {
      throw new Error(ar.barcodeRegisteredTo(conflict.name));
    }
  }

  const { data, error } = await supabase
    .from('products')
    .insert({
      store_id: storeId,
      category_id: input.category_id || null,
      name: trimmedName,
      name_normalized: normalizeArabic(trimmedName),
      barcode: input.barcode?.trim() || null,
      sku_small_text: input.sku_small_text?.trim() || null,
      unit: input.unit || 'piece',
      price: input.price,
      cost_price: input.cost_price,
      stock_quantity: '0',
      min_stock: input.min_stock || '5',
      expiry_date: input.expiry_date || null,
      is_active: true,
    })
    .select('id, store_id, category_id, name, name_normalized, barcode, sku_small_text, unit, price, stock_quantity, min_stock, expiry_date, is_active, created_at, updated_at')
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new Error(ar.duplicateBarcodeError);
    }
    throw new Error(error.message);
  }
  if (input.stock_quantity && new Decimal(input.stock_quantity).greaterThan(0)) {
    await adjustProductStockRpc(data.id, input.stock_quantity, ar.initialStockNote);
  }

  // تحديث النسخة المحلية في Dexie
  await offlineDb.products.put(data as Product).catch(() => undefined);

  return data as Product;
}

export async function updateProduct(
  productId: string,
  storeId: string,
  input: Partial<ProductInput> & { is_active?: boolean }
): Promise<Product> {
  assertOnline(ar.actionOnlineEditProduct);

  const updates: Record<string, unknown> = {};

  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    if (!trimmed) throw new Error(ar.productNameRequired);
    updates.name = trimmed;
    updates.name_normalized = normalizeArabic(trimmed);
  }

  if (input.price !== undefined) {
    const priceNum = new Decimal(input.price || '0');
    if (!priceNum.isFinite() || priceNum.isNegative()) {
      throw new Error(ar.priceMustBeNonNegative);
    }
    updates.price = input.price;
  }

  if (input.cost_price !== undefined) {
    const costNum = new Decimal(input.cost_price || '0');
    if (!costNum.isFinite() || costNum.isNegative()) {
      throw new Error(ar.costPriceMustBeNonNegative);
    }
    updates.cost_price = input.cost_price;
  }

  if (input.barcode !== undefined) {
    const barcodeTrimmed = input.barcode?.trim() || null;
    if (barcodeTrimmed) {
      const conflict = await checkBarcodeConflict(storeId, barcodeTrimmed, productId);
      if (conflict) {
        throw new Error(ar.barcodeRegisteredTo(conflict.name));
      }
    }
    updates.barcode = barcodeTrimmed;
  }

  if (input.sku_small_text !== undefined) {
    updates.sku_small_text = input.sku_small_text?.trim() || null;
  }

  if (input.category_id !== undefined) {
    updates.category_id = input.category_id || null;
  }

  if (input.unit !== undefined) {
    updates.unit = input.unit;
  }

  if (input.min_stock !== undefined) {
    updates.min_stock = input.min_stock;
  }

  if (input.expiry_date !== undefined) {
    updates.expiry_date = input.expiry_date || null;
  }

  // الحقول الحساسة (السعر، التكلفة، is_active) تُرسل عبر RPC لأنها تتطلب PIN
  const sensitiveUpdates: { p_selling_price?: string; p_cost_price?: string; p_is_active?: boolean } = {};
  if (input.price !== undefined) {
    sensitiveUpdates.p_selling_price = updates.price as string;
    delete updates.price;
  }
  if (input.cost_price !== undefined) {
    sensitiveUpdates.p_cost_price = updates.cost_price as string;
    delete updates.cost_price;
  }
  if (input.is_active !== undefined) {
    sensitiveUpdates.p_is_active = input.is_active;
  }

  // إذا كانت هناك حقول حساسة، أرسلها عبر RPC
  if (Object.keys(sensitiveUpdates).length > 0) {
    const { error: rpcError } = await supabase.rpc('update_product_sensitive', {
      p_store_id: storeId,
      p_product_id: productId,
      ...sensitiveUpdates,
    });
    if (rpcError) throw new Error(rpcError.message);
  }

  // إذا كانت هناك حقول عادية، أرسلها مباشرة
  if (Object.keys(updates).length === 0 && Object.keys(sensitiveUpdates).length > 0) {
    // فقط تحديثات حساسة - اجلب المنتج المحدّث
    const { data: fetchData, error: fetchError } = await supabase
      .from('products')
      .select('id, store_id, category_id, name, name_normalized, barcode, sku_small_text, unit, price, stock_quantity, min_stock, expiry_date, is_active, created_at, updated_at')
      .eq('id', productId)
      .single();
    if (fetchError) throw new Error(fetchError.message);
    await offlineDb.products.put(fetchData as Product).catch(() => undefined);
    return fetchData as Product;
  }

  const { data, error } = await supabase
    .from('products')
    .update(updates)
    .eq('id', productId)
    .select('id, store_id, category_id, name, name_normalized, barcode, sku_small_text, unit, price, stock_quantity, min_stock, expiry_date, is_active, created_at, updated_at')
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new Error(ar.duplicateBarcodeError);
    }
    throw new Error(error.message);
  }

  // تحديث النسخة المحلية في Dexie
  await offlineDb.products.put(data as Product).catch(() => undefined);

  return data as Product;
}

export async function setProductActive(productId: string, storeId: string, isActive: boolean): Promise<Product> {
  assertOnline(ar.actionOnlineToggleProduct);

  // is_active تُعدَّل عبر RPC لأنها تتطلب PIN
  const { error: rpcError } = await supabase.rpc('update_product_sensitive', {
    p_store_id: storeId,
    p_product_id: productId,
    p_is_active: isActive,
  });
  if (rpcError) throw new Error(rpcError.message);

  const { data, error } = await supabase
    .from('products')
    .select('id, store_id, category_id, name, name_normalized, barcode, sku_small_text, unit, price, stock_quantity, min_stock, expiry_date, is_active, created_at, updated_at')
    .eq('id', productId)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  await offlineDb.products.put(data as Product).catch(() => undefined);

  return data as Product;
}

export async function adjustProductStockRpc(
  productId: string,
  newQuantity: string | number,
  reason: string
): Promise<{ success: boolean; new_quantity: number }> {
  assertOnline(ar.actionOnlineAdjustStock);

  const qty = new Decimal(String(newQuantity));
  if (!qty.isFinite() || qty.isNegative()) {
    throw new Error(ar.stockMustBeNonNegative);
  }

  const cleanReason = reason.trim();
  if (!cleanReason) {
    throw new Error(ar.adjustStockReason + ar.reasonRequiredSuffix);
  }

  const { data, error } = await supabase.rpc('adjust_stock', {
    p_product_id: productId,
    p_new_quantity: qty.toFixed(3),
    p_reason: cleanReason,
  });

  if (error) {
    throw new Error(error.message);
  }

  // تحديث المخزون المحلي في Dexie
  await offlineDb.products.update(productId, {
    stock_quantity: qty.toFixed(3),
  }).catch(() => undefined);

  return data as { success: boolean; new_quantity: number };
}

export async function fetchProductCosts(storeId: string, productIds: string[]): Promise<Map<string, string>> {
  if (!productIds.length) return new Map();
  const { data, error } = await supabase.rpc('get_product_costs', { p_store_id: storeId, p_product_ids: productIds });
  if (error) throw new Error(error.message);
  return new Map(((data || []) as Array<{ product_id: string; cost_price: string | number }>).map((row) => [row.product_id, String(row.cost_price)]));
}

export async function fetchProductById(productId: string): Promise<Product> {
  if (!isOnline()) {
    const local = await offlineDb.products.get(productId);
    if (local) return local;
  }

  const { data, error } = await supabase
    .from('products')
    .select('id, store_id, category_id, name, name_normalized, barcode, sku_small_text, unit, price, stock_quantity, min_stock, expiry_date, is_active, created_at, updated_at')
    .eq('id', productId)
    .single();

  if (error) {
    const local = await offlineDb.products.get(productId);
    if (local) return local;
    throw new Error(error.message);
  }

  return data as Product;
}

export async function fetchProductMovements(productId: string): Promise<StockMovement[]> {
  const { data, error } = await supabase
    .from('stock_movements')
    .select('*')
    .eq('product_id', productId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data || []) as StockMovement[];
}

export async function searchProducts(storeId: string, query: string): Promise<Product[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  if (!isOnline()) {
    const norm = normalizeArabic(trimmed);
    const locals = await offlineDb.products
      .where('store_id')
      .equals(storeId)
      .and((p) => p.is_active)
      .toArray();

    return locals
      .filter(
        (p) =>
          p.name_normalized.includes(norm) ||
          (p.barcode && p.barcode.includes(trimmed)) ||
          (p.sku_small_text && p.sku_small_text.includes(trimmed))
      )
      .slice(0, 20);
  }

  try {
    const res = await fetchProducts(storeId, { searchQuery: query, pageSize: 20 });
    return res.products;
  } catch {
    const norm = normalizeArabic(trimmed);
    const locals = await offlineDb.products
      .where('store_id')
      .equals(storeId)
      .and((p) => p.is_active)
      .toArray();

    return locals
      .filter(
        (p) =>
          p.name_normalized.includes(norm) ||
          (p.barcode && p.barcode.includes(trimmed)) ||
          (p.sku_small_text && p.sku_small_text.includes(trimmed))
      )
      .slice(0, 20);
  }
}
