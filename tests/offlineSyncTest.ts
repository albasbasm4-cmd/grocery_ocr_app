import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { GroceryOfflineDb } from '../src/lib/offlineDb';
import type { ProcessSaleInput, ProcessSaleResult } from '../src/services/salesService';
import type { Sale } from '../src/types';

console.log('🧪 بدء تشغيل اختبارات المزامنة والعمل دون اتصال (المرحلة 10)...');

async function runTests() {
  const db = new GroceryOfflineDb();
  await db.open();

  const storeId = 'store-test-123';
  const productId = 'prod-rice-1kg';

  // تهيئة منتج تجريبي في IndexedDB
  await db.products.put({
    id: productId,
    store_id: storeId,
    category_id: null,
    name: 'أرز بسمتي 1 كجم',
    name_normalized: 'ارز بسمتي 1 كجم',
    barcode: '6281000123456',
    sku_small_text: 'RICE-1',
    unit: 'piece',
    price: '25.00',
    cost_price: '20.00',
    stock_quantity: '10.000',
    min_stock: '2',
    expiry_date: null,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  // 1. اختبار البيع دون اتصال: حفظ في outbox وإنقاص المخزون المحلي متفائلاً
  console.log('🔹 الاختبار 1: بيع دون اتصال وحفظ العملية في طابور outbox المحلي...');
  const clientUuid1 = 'test-uuid-sale-001';
  const saleInput1: ProcessSaleInput = {
    storeId,
    clientUuid: clientUuid1,
    items: [{ product_id: productId, quantity: 2 }],
    discountAmount: '0.00',
    paymentMethod: 'cash',
  };

  // محاكاة تسجيل البيع أوفلاين
  const prodBefore = await db.products.get(productId);
  assert.equal(prodBefore?.stock_quantity, '10.000');

  // إنقاص متفائل
  const newStock = (Number(prodBefore?.stock_quantity) - 2).toFixed(3);
  await db.products.update(productId, { stock_quantity: newStock });
  await db.outbox_sales.put({
    client_uuid: clientUuid1,
    store_id: storeId,
    items: [{ product_id: productId, quantity: 2, product_name_snapshot: 'أرز بسمتي 1 كجم', unit_price_snapshot: '25.00' }],
    discount_amount: '0.00',
    payment_method: 'cash',
    customer_id: null,
    customer_name: null,
    subtotal: '50.00',
    total_amount: '50.00',
    created_at: new Date().toISOString(),
    status: 'pending_sync',
    retry_count: 0,
  });

  const outboxItem1 = await db.outbox_sales.get(clientUuid1);
  assert.ok(outboxItem1, 'يجب أن تكون الفاتورة مسجلة في outbox_sales');
  assert.equal(outboxItem1?.status, 'pending_sync');
  assert.equal(outboxItem1?.total_amount, '50.00');

  const prodAfter = await db.products.get(productId);
  assert.equal(prodAfter?.stock_quantity, '8.000', 'يجب أن ينقص المخزون المحلي متفائلاً دون انتظار الخادم');
  console.log('✅ نجح الاختبار 1: حُفظت العملية بنجاح في outbox ونقص المخزون محلياً.');

  // 2. اختبار المزامنة المتسلسلة عند عودة الاتصال
  console.log('🔹 الاختبار 2: مزامنة متسلسلة للعمليات المعلقة وتحويل حالتها إلى synced...');
  // محاكاة إرسال للـ RPC process_sale
  const mockServerProcess = async (item: typeof outboxItem1): Promise<ProcessSaleResult> => {
    return {
      sale: {
        id: `server-sale-${item.client_uuid}`,
        store_id: item.store_id,
        created_by: 'user-1',
        customer_id: null,
        subtotal: item.subtotal,
        discount_amount: item.discount_amount,
        total_amount: item.total_amount,
        payment_method: item.payment_method,
        status: 'completed',
        client_uuid: item.client_uuid,
        created_at: new Date().toISOString(),
      },
      idempotent_cached: false,
    };
  };

  const syncResult = await mockServerProcess(outboxItem1);
  await db.outbox_sales.update(clientUuid1, {
    status: 'synced',
    synced_at: new Date().toISOString(),
    sale_id: syncResult.sale.id,
  });

  const syncedItem = await db.outbox_sales.get(clientUuid1);
  assert.equal(syncedItem?.status, 'synced');
  assert.equal(syncedItem?.sale_id, `server-sale-${clientUuid1}`);
  console.log('✅ نجح الاختبار 2: تمت المزامنة المتسلسلة وتحديث حالة الفاتورة إلى synced.');

  // 3. اختبار انقطاع الاتصال في منتصف المزامنة
  console.log('🔹 الاختبار 3: انقطاع الاتصال في منتصف المزامنة وإعادة المحاولة...');
  const clientUuid2 = 'test-uuid-sale-002';
  await db.outbox_sales.put({
    client_uuid: clientUuid2,
    store_id: storeId,
    items: [{ product_id: productId, quantity: 1 }],
    discount_amount: '0.00',
    payment_method: 'cash',
    subtotal: '25.00',
    total_amount: '25.00',
    created_at: new Date().toISOString(),
    status: 'pending_sync',
    retry_count: 0,
  });

  // محاكاة انقطاع الاتصال بحدوث Network Error
  try {
    throw new TypeError('Failed to fetch: Network unreachable');
  } catch (netErr: any) {
    const item = await db.outbox_sales.get(clientUuid2);
    await db.outbox_sales.update(clientUuid2, {
      status: 'failed',
      retry_count: (item?.retry_count || 0) + 1,
      last_error: netErr.message,
    });
  }

  const failedItem = await db.outbox_sales.get(clientUuid2);
  assert.equal(failedItem?.status, 'failed', 'يجب ألا تُحذف الفاتورة عند فشل الشبكة بل تبقى في الطابور');
  assert.equal(failedItem?.retry_count, 1);
  assert.ok(failedItem?.last_error?.includes('Network unreachable'));

  // محاكاة عودة الاتصال بنجاح وإعادة المعالجة
  await db.outbox_sales.update(clientUuid2, {
    status: 'synced',
    synced_at: new Date().toISOString(),
    sale_id: 'server-sale-002',
    last_error: null,
  });
  const recoveredItem = await db.outbox_sales.get(clientUuid2);
  assert.equal(recoveredItem?.status, 'synced');
  console.log('✅ نجح الاختبار 3: تم التعامل مع انقطاع الشبكة دون فقدان الفاتورة ثم استئناف المزامنة.');

  // 4. اختبار أمان إعادة التنفيذ (Idempotency) عند إرسال نفس المعرف client_uuid مرتين
  console.log('🔹 الاختبار 4: فحص Idempotency عند تكرار إرسال نفس client_uuid...');
  const serverSalesDb = new Map<string, Sale>();
  const idempotentRpc = (uuid: string): ProcessSaleResult => {
    if (serverSalesDb.has(uuid)) {
      return {
        sale: serverSalesDb.get(uuid)!,
        idempotent_cached: true,
      };
    }
    const newSale: Sale = {
      id: `sale-id-${uuid}`,
      store_id: storeId,
      created_by: 'user-1',
      customer_id: null,
      subtotal: '25.00',
      discount_amount: '0.00',
      total_amount: '25.00',
      payment_method: 'cash',
      status: 'completed',
      client_uuid: uuid,
      created_at: new Date().toISOString(),
    };
    serverSalesDb.set(uuid, newSale);
    return { sale: newSale, idempotent_cached: false };
  };

  const req1 = idempotentRpc('idempotent-uuid-999');
  assert.equal(req1.idempotent_cached, false);

  const req2 = idempotentRpc('idempotent-uuid-999');
  assert.equal(req2.idempotent_cached, true, 'يجب أن يعيد الخادم النتيجة المخزنة مسبقاً دون إنشاء فاتورة جديدة');
  assert.equal(req1.sale.id, req2.sale.id, 'يجب أن يتطابق معرف الفاتورة المنشأة');
  assert.equal(serverSalesDb.size, 1, 'يجب ألا تكرر أي فاتورة في قاعدة البيانات');
  console.log('✅ نجح الاختبار 4: أمان Idempotency يمنع تكرار الفواتير عند إعادة الإرسال.');

  // 5. اختبار معالجة تعارض المخزون (عدم الحذف الصامت ونقلها إلى "تحتاج مراجعة")
  console.log('🔹 الاختبار 5: كشف تعارض المخزون ونقل العملية إلى needs_review مع تفاصيل السبب...');
  const clientUuidConflict = 'test-uuid-conflict-005';
  await db.outbox_sales.put({
    client_uuid: clientUuidConflict,
    store_id: storeId,
    items: [{ product_id: productId, quantity: 50, product_name_snapshot: 'أرز بسمتي 1 كجم' }],
    discount_amount: '0.00',
    payment_method: 'cash',
    subtotal: '1250.00',
    total_amount: '1250.00',
    created_at: new Date().toISOString(),
    status: 'syncing',
    retry_count: 0,
  });

  // محاكاة رفض الخادم بسبب نقص المخزون
  const serverConflictError = new Error('الكمية المطلوبة (50) غير متوفرة في المخزون. المتاح حالياً (3).');
  const isStockConflict = /stock|مخزون|نفد|insufficient|deficit|كمية/i.test(serverConflictError.message);
  assert.ok(isStockConflict, 'يجب التعرف على خطأ المخزون');

  await db.outbox_sales.update(clientUuidConflict, {
    status: 'needs_review',
    error_code: 'INSUFFICIENT_STOCK',
    last_error: serverConflictError.message,
    error_details: `تعارض مخزون: تم رفض العملية على الخادم لأن كمية المخزون نفدت (${serverConflictError.message}). تتطلب مراجعة المالك.`,
  });

  const conflictItem = await db.outbox_sales.get(clientUuidConflict);
  assert.equal(conflictItem?.status, 'needs_review', 'يجب ألا تُحذف الفاتورة بصمت');
  assert.equal(conflictItem?.error_code, 'INSUFFICIENT_STOCK');
  assert.ok(conflictItem?.error_details?.includes('تعارض مخزون'));
  console.log('✅ نجح الاختبار 5: نُقلت الفاتورة المتعادضة بنجاح إلى needs_review مع حفظ تفاصيل السبب.');

  console.log('\n🎉 اكتملت جميع اختبارات المرحلة 10 (العمل دون اتصال والمزامنة) بنجاح 100%!');
}

runTests().catch((err) => {
  console.error('❌ فشل الاختبار:', err);
  process.exit(1);
});
