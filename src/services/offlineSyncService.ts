import Decimal from 'decimal.js';
import { supabase } from '../lib/supabase';
import { offlineDb, type OutboxSale, type OutboxStatus } from '../lib/offlineDb';
import { isOnline } from '../lib/offlineGuard';
import { processSale, type ProcessSaleInput, type ProcessSaleResult } from './salesService';
import type { Category, Customer, Product, Sale } from '../types';

type SyncListener = () => void;
const listeners = new Set<SyncListener>();

export function subscribeToSyncChanges(callback: SyncListener): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function notifySyncChanges(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch (err) {
      console.error('Error in sync listener:', err);
    }
  }
}

let isProcessingOutbox = false;

/**
 * مزامنة تزايدية لقاعدة البيانات المحلية (المنتجات، التصنيفات، العملاء)
 */
export async function syncLocalData(storeId: string, forceFull = false): Promise<void> {
  if (!storeId || !isOnline()) return;

  try {
    // 1. مزامنة التصنيفات
    const catMetaKey = `last_categories_sync_${storeId}`;
    const lastCatSync = forceFull ? null : await offlineDb.sync_meta.get(catMetaKey);

    let catQuery = supabase
      .from('categories')
      .select('id, store_id, name, name_normalized, created_at')
      .eq('store_id', storeId);

    if (lastCatSync?.value) {
      catQuery = catQuery.gt('created_at', lastCatSync.value);
    }

    const { data: categories, error: catError } = await catQuery;
    if (!catError && Array.isArray(categories) && categories.length > 0) {
      await offlineDb.categories.bulkPut(categories as Category[]);
    }
    await offlineDb.sync_meta.put({
      key: catMetaKey,
      value: new Date().toISOString(),
    });

    // 2. مزامنة العملاء
    const custMetaKey = `last_customers_sync_${storeId}`;
    const lastCustSync = forceFull ? null : await offlineDb.sync_meta.get(custMetaKey);

    let custQuery = supabase
      .from('customers')
      .select('id, store_id, name, phone, balance, created_at')
      .eq('store_id', storeId);

    if (lastCustSync?.value) {
      custQuery = custQuery.gt('created_at', lastCustSync.value);
    }

    const { data: customers, error: custError } = await custQuery;
    if (!custError && Array.isArray(customers) && customers.length > 0) {
      await offlineDb.customers.bulkPut(customers as Customer[]);
    }
    await offlineDb.sync_meta.put({
      key: custMetaKey,
      value: new Date().toISOString(),
    });

    // 3. مزامنة المنتجات التزايدية عبر updated_at
    const prodMetaKey = `last_products_sync_${storeId}`;
    const lastProdSync = forceFull ? null : await offlineDb.sync_meta.get(prodMetaKey);

    let prodQuery = supabase
      .from('products')
      .select('id, store_id, category_id, name, name_normalized, barcode, sku_small_text, unit, price, cost_price, stock_quantity, min_stock, expiry_date, is_active, created_at, updated_at')
      .eq('store_id', storeId);

    if (lastProdSync?.value) {
      prodQuery = prodQuery.gt('updated_at', lastProdSync.value);
    }

    const { data: products, error: prodError } = await prodQuery;
    if (!prodError && Array.isArray(products) && products.length > 0) {
      await offlineDb.products.bulkPut(products as Product[]);
    }

    const nowIso = new Date().toISOString();
    await offlineDb.sync_meta.put({
      key: prodMetaKey,
      value: nowIso,
    });

    // تسجيل آخر وقت مزامنة ناجحة
    await offlineDb.sync_meta.put({
      key: `last_successful_sync_${storeId}`,
      value: nowIso,
    });

    notifySyncChanges();
  } catch (err) {
    console.error('Failed to sync local data:', err);
  }
}

export interface OfflineSaleExtra {
  customerName?: string | null;
  subtotal?: string;
  totalAmount?: string;
  itemsDetails?: Array<{
    product_id: string;
    product_name_snapshot?: string;
    unit_price_snapshot?: string;
  }>;
}

/**
 * حفظ عملية البيع محلياً في طابور outbox وتعديل المخزون محلياً بشكل متفائل
 */
export async function recordOfflineSale(
  input: ProcessSaleInput,
  extra?: OfflineSaleExtra
): Promise<ProcessSaleResult> {
  const discountDec = new Decimal(input.discountAmount || '0');
  if (!discountDec.isFinite() || discountDec.isNegative()) {
    throw new Error('مبلغ الخصم غير صالح.');
  }

  if (!input.items || input.items.length === 0) {
    throw new Error('سلة البيع فارغة.');
  }

  if (input.paymentMethod === 'credit' && !input.customerId) {
    throw new Error('يجب تحديد العميل في عمليات الدفع الآجل.');
  }

  const clientUuid =
    input.clientUuid ||
    (typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`);

  const nowIso = new Date().toISOString();

  // خريطة أسماء المنتجات وأسعارها
  const detailsMap = new Map<string, { name?: string; price?: string }>();
  if (extra?.itemsDetails) {
    for (const d of extra.itemsDetails) {
      detailsMap.set(d.product_id, {
        name: d.product_name_snapshot,
        price: d.unit_price_snapshot,
      });
    }
  }

  // 1. إنقاص المخزون المحلي في IndexedDB لضمان دقة العمليات التالية دون اتصال
  for (const item of input.items) {
    try {
      const prod = await offlineDb.products.get(item.product_id);
      if (prod) {
        const currentStock = new Decimal(prod.stock_quantity || '0');
        const nextStock = Decimal.max(0, currentStock.minus(item.quantity));
        await offlineDb.products.update(item.product_id, {
          stock_quantity: nextStock.toString(),
        });
      }
    } catch {
      // ignore
    }
  }

  // 2. تحديث رصيد العميل الآجل محلياً إن وجد
  if (input.paymentMethod === 'credit' && input.customerId && extra?.totalAmount) {
    try {
      const cust = await offlineDb.customers.get(input.customerId);
      if (cust) {
        const currentBal = new Decimal(cust.balance || '0');
        const nextBal = currentBal.plus(extra.totalAmount);
        await offlineDb.customers.update(input.customerId, {
          balance: nextBal.toFixed(2),
        });
      }
    } catch {
      // ignore
    }
  }

  const outboxItems = input.items.map((i) => {
    const snap = detailsMap.get(i.product_id);
    return {
      product_id: i.product_id,
      quantity: i.quantity,
      product_name_snapshot: snap?.name,
      unit_price_snapshot: snap?.price,
    };
  });

  const outboxSale: OutboxSale = {
    client_uuid: clientUuid,
    store_id: input.storeId,
    items: outboxItems,
    discount_amount: discountDec.toFixed(2),
    payment_method: input.paymentMethod,
    customer_id: input.customerId || null,
    customer_name: extra?.customerName || null,
    subtotal: extra?.subtotal || '0.00',
    total_amount: extra?.totalAmount || '0.00',
    created_at: nowIso,
    status: 'pending_sync',
    retry_count: 0,
    last_error: null,
    error_code: null,
    error_details: null,
    synced_at: null,
    sale_id: null,
  };

  await offlineDb.outbox_sales.put(outboxSale);
  notifySyncChanges();

  // محاولة المزامنة الفورية في الخلفية إن توفر الاتصال
  if (isOnline()) {
    void processOutbox(input.storeId).catch(() => undefined);
  }

  const syntheticSale: Sale = {
    id: `offline-${clientUuid}`,
    store_id: input.storeId,
    created_by: null,
    customer_id: input.customerId || null,
    subtotal: extra?.subtotal || '0.00',
    discount_amount: discountDec.toFixed(2),
    total_amount: extra?.totalAmount || '0.00',
    payment_method: input.paymentMethod,
    status: 'completed',
    client_uuid: clientUuid,
    created_at: nowIso,
  };

  return {
    sale: syntheticSale,
    idempotent_cached: false,
  };
}

function isStockConflictError(message: string): boolean {
  return /stock|مخزون|نفد|insufficient|deficit|negative stock|كمية|لا تتوفر/i.test(message);
}

/**
 * معالجة طابور العمليات غير المزامنة بالتسلسل وإعادة المحاولة مع كشف التعارض
 */
export async function processOutbox(storeId: string): Promise<{
  syncedCount: number;
  failedCount: number;
  needsReviewCount: number;
}> {
  if (!storeId || !isOnline() || isProcessingOutbox) {
    return { syncedCount: 0, failedCount: 0, needsReviewCount: 0 };
  }

  isProcessingOutbox = true;
  let syncedCount = 0;
  let failedCount = 0;
  let needsReviewCount = 0;

  try {
    const queue = await offlineDb.outbox_sales
      .where('store_id')
      .equals(storeId)
      .and((s) => s.status === 'pending_sync' || s.status === 'failed')
      .sortBy('created_at');

    for (const item of queue) {
      if (!isOnline()) {
        break; // انقطع الاتصال في منتصف المزامنة
      }

      // وضع الحالة "قيد المزامنة"
      await offlineDb.outbox_sales.update(item.client_uuid, {
        status: 'syncing' as OutboxStatus,
      });
      notifySyncChanges();

      try {
        const payload: ProcessSaleInput = {
          storeId: item.store_id,
          clientUuid: item.client_uuid,
          items: item.items.map((i) => ({
            product_id: i.product_id,
            quantity: i.quantity,
          })),
          discountAmount: item.discount_amount,
          paymentMethod: item.payment_method,
          customerId: item.customer_id,
        };

        const result = await processSale(payload);

        // نجاح المزامنة بأمان بفضل idempotency (p_client_uuid)
        await offlineDb.outbox_sales.update(item.client_uuid, {
          status: 'synced' as OutboxStatus,
          synced_at: new Date().toISOString(),
          sale_id: result.sale.id,
          last_error: null,
          error_code: null,
          error_details: null,
        });

        syncedCount++;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);

        if (isStockConflictError(message)) {
          // تعارض في المخزون: لا يُحذف بل يُنقل إلى "تحتاج مراجعة"
          await offlineDb.outbox_sales.update(item.client_uuid, {
            status: 'needs_review' as OutboxStatus,
            error_code: 'INSUFFICIENT_STOCK',
            last_error: message,
            error_details: `تعارض مخزون: تم رفض العملية على الخادم لأن كمية المخزون نفدت (${message}). تتطلب مراجعة المالك.`,
          });
          needsReviewCount++;
        } else {
          // خطأ شبكة أو خطأ مؤقت: زيادة عداد المحاولات مع بقاء الفاتورة في الطابور
          const nextRetry = (item.retry_count || 0) + 1;
          await offlineDb.outbox_sales.update(item.client_uuid, {
            status: 'failed' as OutboxStatus,
            retry_count: nextRetry,
            last_error: message,
          });
          failedCount++;
        }
      }
      notifySyncChanges();
    }

    if (syncedCount > 0) {
      // تحديث آخر وقت مزامنة ناجحة
      await offlineDb.sync_meta.put({
        key: `last_successful_sync_${storeId}`,
        value: new Date().toISOString(),
      });
    }
  } finally {
    isProcessingOutbox = false;
    notifySyncChanges();
  }

  return { syncedCount, failedCount, needsReviewCount };
}

/**
 * الحصول على إحصائيات طابور المزامنة للمتجر
 */
export async function getOutboxStats(storeId: string): Promise<{
  pendingCount: number;
  syncingCount: number;
  needsReviewCount: number;
  syncedCount: number;
  lastSuccessfulSync: string | null;
}> {
  if (!storeId) {
    return {
      pendingCount: 0,
      syncingCount: 0,
      needsReviewCount: 0,
      syncedCount: 0,
      lastSuccessfulSync: null,
    };
  }

  const sales = await offlineDb.outbox_sales.where('store_id').equals(storeId).toArray();
  const lastSync = await offlineDb.sync_meta.get(`last_successful_sync_${storeId}`);

  let pendingCount = 0;
  let syncingCount = 0;
  let needsReviewCount = 0;
  let syncedCount = 0;

  for (const s of sales) {
    if (s.status === 'pending_sync' || s.status === 'failed') pendingCount++;
    else if (s.status === 'syncing') syncingCount++;
    else if (s.status === 'needs_review') needsReviewCount++;
    else if (s.status === 'synced') syncedCount++;
  }

  return {
    pendingCount,
    syncingCount,
    needsReviewCount,
    syncedCount,
    lastSuccessfulSync: lastSync?.value ?? null,
  };
}

/**
 * إعادة محاولة فاتورة في قائمة "تحتاج مراجعة" بعد قيام المالك بمعالجة السبب
 */
export async function retryNeedsReviewSale(clientUuid: string, storeId: string): Promise<void> {
  await offlineDb.outbox_sales.update(clientUuid, {
    status: 'pending_sync' as OutboxStatus,
    retry_count: 0,
    last_error: null,
  });
  notifySyncChanges();
  if (isOnline()) {
    void processOutbox(storeId).catch(() => undefined);
  }
}

/**
 * إلغاء/استبعاد فاتورة متعارضة يدوياً بواسطة المالك
 */
export async function dismissNeedsReviewSale(clientUuid: string, reason?: string): Promise<void> {
  await offlineDb.outbox_sales.update(clientUuid, {
    status: 'failed' as OutboxStatus,
    last_error: reason || 'تم إلغاء الفاتورة يدوياً بواسطة المالك.',
    error_details: 'مستبعدة يدوياً.',
  });
  notifySyncChanges();
}

/**
 * حذف الفواتير المزامنة بنجاح لتنظيف مساحة IndexedDB
 */
export async function clearSyncedSales(storeId: string): Promise<number> {
  const synced = await offlineDb.outbox_sales
    .where('store_id')
    .equals(storeId)
    .and((s) => s.status === 'synced')
    .primaryKeys();

  await offlineDb.outbox_sales.bulkDelete(synced);
  notifySyncChanges();
  return synced.length;
}
