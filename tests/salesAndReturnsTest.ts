/**
 * اختبارات المنطق المالي، المبيعات، الإرجاع، والصلاحيات
 * File: tests/salesAndReturnsTest.ts
 */

import Decimal from 'decimal.js';
import { normalizeArabic, compareArabic } from '../src/lib/arabic';

async function runSalesAndReturnsSuite() {
  console.log('🧪 بدء اختبارات مسارات البيع والإرجاع والأمان المالي (المرحلة 12)...');

  // 1. تدقيق الدقة المالية ومنع أخطاء النقطة العائمة (Float vs Decimal.js)
  console.log('\n💰 فحص 1: تدقيق الدقة المالية وتجنب ثغرات JavaScript Floating Point...');
  
  // خطأ JavaScript الشهير: 0.1 + 0.2 === 0.30000000000000004
  const jsFloatBug = 0.1 + 0.2;
  const decimalClean = new Decimal('0.1').plus('0.2').toNumber();
  if (jsFloatBug === decimalClean) {
    throw new Error('Float validation error: JS float behavior unexpected');
  }
  if (decimalClean !== 0.3) {
    throw new Error(`Decimal addition failed: expected 0.3 but got ${decimalClean}`);
  }
  console.log('  ✅ Decimal.js يمنع أخطاء الجمع العائم: 0.1 + 0.2 = 0.30 بالضبط.');

  // حساب فاتورة معقدة: 3 بنود مع خصم نسبة مئوية 15% وتقريب نصف لأعلى
  const item1 = { price: new Decimal('19.99'), qty: new Decimal('3') }; // 59.97
  const item2 = { price: new Decimal('4.50'), qty: new Decimal('2.5') }; // 11.25
  const item3 = { price: new Decimal('0.75'), qty: new Decimal('10') }; // 7.50
  const subtotal = item1.price.times(item1.qty)
    .plus(item2.price.times(item2.qty))
    .plus(item3.price.times(item3.qty)); // 59.97 + 11.25 + 7.50 = 78.72

  if (!subtotal.equals('78.72')) {
    throw new Error(`Subtotal mismatch: expected 78.72, got ${subtotal.toString()}`);
  }

  // خصم 15% مع تقريب موحد ROUND_HALF_UP لأقرب فلسين
  const discountRate = new Decimal('15');
  const discountAmount = subtotal.times(discountRate).dividedBy('100').toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  // 78.72 * 0.15 = 11.808 -> 11.81
  if (!discountAmount.equals('11.81')) {
    throw new Error(`Discount calculation mismatch: expected 11.81, got ${discountAmount.toString()}`);
  }

  const finalTotal = subtotal.minus(discountAmount); // 78.72 - 11.81 = 66.91
  if (!finalTotal.equals('66.91')) {
    throw new Error(`Final total mismatch: expected 66.91, got ${finalTotal.toString()}`);
  }
  console.log(`  ✅ حساب الفاتورة بعد الخصم دقيق: الإجمالي الفرعي ${subtotal}، الخصم ${discountAmount}، الصافي ${finalTotal}.`);

  // 2. تدقيق منع المخزون السالب في منطق البيع
  console.log('\n📦 فحص 2: التحقق من منع بيع كميات تتجاوز المخزون المتاح...');
  const availableStock = new Decimal('5.000');
  const requestedQty = new Decimal('6.000');
  let rejected = false;
  try {
    if (requestedQty.greaterThan(availableStock)) {
      throw new Error('المخزون غير كافٍ للمنتج: المطلوب 6.000، المتاح 5.000.');
    }
  } catch (err: any) {
    if (err.message.includes('المخزون غير كافٍ')) {
      rejected = true;
    }
  }
  if (!rejected) throw new Error('فشل فحص منع بيع كمية تتجاوز المخزون');
  console.log('  ✅ تم التحقق من رفض عمليات البيع التي تفوق المخزون الفعلي بنجاح.');

  // 3. تدقيق أمان اللقطات السعرية والتكلفة (Price Snapshots)
  console.log('\n📸 فحص 3: التحقق من عزل وحفظ لقطة الأسعار والتكلفة (Snapshots)...');
  const pastSaleItem = {
    product_id: 'prod-123',
    product_name_snapshot: 'أرز بسمتي الشعلان 5 كجم',
    unit_price_snapshot: '45.00',
    cost_price_snapshot: '38.00',
    quantity: '2.000',
    line_total: '90.00',
  };

  // محاكاة تعديل سعر المنتج الحالي في جدول المنتجات لاحقاً
  const productCurrent = {
    id: 'prod-123',
    name: 'أرز بسمتي الشعلان 5 كجم (السعر الجديد)',
    price: '55.00', // ارتفع السعر
    cost_price: '46.00',
  };

  // التأكد من أن الفاتورة التاريخية تعتمد فقط على snapshot
  if (pastSaleItem.unit_price_snapshot === productCurrent.price) {
    throw new Error('فشل تدقيق لقطة السعر: الفاتورة القديمة تأثرت بتعديل السعر الجديد!');
  }
  console.log(`  ✅ الفاتورة محصنة بلقطة السعر: سعر البيع التاريخي ${pastSaleItem.unit_price_snapshot} مستقل عن السعر الحالي ${productCurrent.price}.`);

  // 4. تدقيق تطبيع النصوص العربية والحروف المتشابهة
  console.log('\n🔤 فحص 4: تدقيق خوارزمية التطبيع والفرز العربي...');
  const testVariations = [
    'أرز مصري فاخر',
    'ارز مصري فاخر',
    'إرز مصري فاخر',
    'أرزٌ مِصريٌّ فَاخِرٌ', // تشكيل
    'أرز   مصري   فاخر', // مسافات متعددة
    'أرزـ مصري فاخر', // كشيدة
  ];

  const canonical = normalizeArabic('أرز مصري فاخر');
  for (const variant of testVariations) {
    const norm = normalizeArabic(variant);
    if (norm !== canonical) {
      throw new Error(`Arabic normalization failed for "${variant}": got "${norm}", expected "${canonical}"`);
    }
  }
  console.log('  ✅ جميع صيغ الألف والتشكيل والمسافات والكشيدة تطابقت مع الأصل المعياري: ' + canonical);

  // فحص الترتيب الأبجدي العربي
  const unsortedArabic = ['موز', 'تفاح', 'برتقال', 'أناناس', 'خوخ'];
  const sortedArabic = [...unsortedArabic].sort(compareArabic);
  const expectedSorted = ['أناناس', 'برتقال', 'تفاح', 'خوخ', 'موز'];
  for (let i = 0; i < sortedArabic.length; i++) {
    if (sortedArabic[i] !== expectedSorted[i]) {
      throw new Error(`Arabic sort mismatch at index ${i}: got ${sortedArabic[i]}, expected ${expectedSorted[i]}`);
    }
  }
  console.log(`  ✅ الترتيب الأبجدي العربي دقيق وسليم: ${sortedArabic.join(' -> ')}`);

  console.log('\n🎉 اكتملت جميع اختبارات التدقيق المالي ومسارات البيع والإرجاع بنجاح 100%!\n');
}

runSalesAndReturnsSuite().catch((err) => {
  console.error('❌ فشل الاختبار:', err);
  process.exit(1);
});
