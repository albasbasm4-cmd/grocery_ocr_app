/**
 * اختبار الدقة المالية ومنع أخطاء الفاصلة العائمة (المهمة 4)
 * File: tests/financialPrecisionTest.ts
 */

import Decimal from 'decimal.js';

interface TestCartItem {
  id: string;
  name: string;
  price: string;
  quantity: string;
}

function calculateCartTotals(
  items: TestCartItem[],
  discountType: 'fixed' | 'percentage',
  discountValue: string
) {
  let subtotalDec = new Decimal(0);
  let countDec = new Decimal(0);

  const lineItems = items.map((item) => {
    const q = new Decimal(item.quantity || '0');
    const p = new Decimal(item.price || '0');
    const lineTotalDec = q.times(p).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    subtotalDec = subtotalDec.plus(q.times(p));
    countDec = countDec.plus(q);
    return {
      name: item.name,
      quantity: q.toString(),
      unitPrice: p.toFixed(2),
      lineTotal: lineTotalDec.toFixed(2),
    };
  });

  const roundedSubtotal = subtotalDec.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  let discAmountDec = new Decimal(0);
  const discInput = new Decimal(discountValue || '0');
  if (discInput.isFinite() && discInput.greaterThan(0)) {
    if (discountType === 'percentage') {
      discAmountDec = roundedSubtotal.times(discInput).dividedBy(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    } else {
      discAmountDec = discInput;
    }
  }

  if (discAmountDec.greaterThan(roundedSubtotal)) {
    discAmountDec = roundedSubtotal;
  }

  const totalDec = roundedSubtotal.minus(discAmountDec);

  return {
    lineItems,
    subtotal: roundedSubtotal.toFixed(2),
    discountAmount: discAmountDec.toFixed(2),
    totalAmount: totalDec.toFixed(2),
    totalItemCount: countDec.toString(),
  };
}

async function runFinancialPrecisionSuite() {
  console.log('🧪 بدء اختبار الدقة المالية الصارمة بـ Decimal.js (المهمة 4)...');

  // 1. اختبار: 0.1 + 0.2
  console.log('\n🔹 اختبار 1: جمع المبالغ العشرية (0.1 + 0.2)...');
  const jsFloatSum = 0.1 + 0.2; // 0.30000000000000004
  const decSum = new Decimal('0.1').plus('0.2');

  if (jsFloatSum === 0.3) {
    throw new Error('JavaScript float bug was expected to manifest');
  }
  if (!decSum.equals('0.3')) {
    throw new Error(`Decimal sum failed: expected 0.3, got ${decSum.toString()}`);
  }
  if (decSum.toFixed(2) !== '0.30') {
    throw new Error(`Decimal format failed: expected 0.30, got ${decSum.toFixed(2)}`);
  }
  console.log('  ✅ نجح الفحص: Decimal.js يتفوق على خطأ JS العائم: 0.1 + 0.2 = 0.30 بالضبط.');

  // 2. اختبار: 3 × 19.99
  console.log('\n🔹 اختبار 2: ضرب الكمية بالسعر الفردي (3 × 19.99)...');
  const jsFloatMul = 3 * 19.99; // 59.970000000000006
  const decMul = new Decimal('3').times('19.99');

// Note: JS float multiplication can introduce precision loss in floating point arithmetic
  if (!decMul.equals('59.97')) {
    throw new Error(`Decimal multiplication failed: expected 59.97, got ${decMul.toString()}`);
  }
  if (decMul.toFixed(2) !== '59.97') {
    throw new Error(`Formatted total failed: expected 59.97, got ${decMul.toFixed(2)}`);
  }
  console.log('  ✅ نجح الفحص: 3 × 19.99 = 59.97 دون أي شوائب عشرية.');

  // 3. اختبار: أوزان بالكيلو وفواصل ثلاثية مثل 0.333 كجم
  console.log('\n🔹 اختبار 3: الكميات الكسرية بالكيلوغرام (0.333 كجم × 15.50 ريال/كجم)...');
  const weight = new Decimal('0.333');
  const kiloPrice = new Decimal('15.50');
  const rawLineTotal = weight.times(kiloPrice); // 5.1615
  const roundedLineTotal = rawLineTotal.toDecimalPlaces(2, Decimal.ROUND_HALF_UP); // 5.16

  if (!rawLineTotal.equals('5.1615')) {
    throw new Error(`Raw calculation failed: expected 5.1615, got ${rawLineTotal.toString()}`);
  }
  if (!roundedLineTotal.equals('5.16')) {
    throw new Error(`Rounded calculation failed: expected 5.16, got ${roundedLineTotal.toString()}`);
  }
  console.log('  ✅ نجح الفحص: 0.333 كجم × 15.50 ريال = 5.16 ريال بعد التقريب المالي الموحد ROUND_HALF_UP.');

  // 4. اختبار: محاكاة سلة مشتريات حقيقية تجمع بين أوزان ووحدات مع خصم
  console.log('\n🔹 اختبار 4: سلة مشتريات متكاملة تحتوي منتجات بالكيلو والقطعة مع خصم...');
  const cartItems: TestCartItem[] = [
    { id: '1', name: 'طماطم بالكيلو', price: '15.50', quantity: '0.333' }, // 5.16
    { id: '2', name: 'شاي ممتاز', price: '19.99', quantity: '3' },       // 59.97
    { id: '3', name: 'علكة صغيرة', price: '0.20', quantity: '1' },        // 0.20
    { id: '4', name: 'أرز فاخر', price: '45.00', quantity: '2.500' },     // 112.50
  ];

  const cartResult = calculateCartTotals(cartItems, 'percentage', '10');

  // الإجمالي قبل الخصم: 5.1615 + 59.97 + 0.20 + 112.50 = 177.8315 -> تقريب 177.83
  // الخصم 10% من 177.83 = 17.783 -> تقريب 17.78
  // الصافي النهائي: 177.83 - 17.78 = 160.05
  if (cartResult.subtotal !== '177.83') {
    throw new Error(`Cart subtotal mismatch: expected 177.83, got ${cartResult.subtotal}`);
  }
  if (cartResult.discountAmount !== '17.78') {
    throw new Error(`Cart discount mismatch: expected 17.78, got ${cartResult.discountAmount}`);
  }
  if (cartResult.totalAmount !== '160.05') {
    throw new Error(`Cart total mismatch: expected 160.05, got ${cartResult.totalAmount}`);
  }

  // التحقق من بنود الإيصال
  if (cartResult.lineItems[0]!.lineTotal !== '5.16') {
    throw new Error(`Receipt item 1 lineTotal mismatch: expected 5.16, got ${cartResult.lineItems[0]!.lineTotal}`);
  }
  if (cartResult.lineItems[1]!.lineTotal !== '59.97') {
    throw new Error(`Receipt item 2 lineTotal mismatch: expected 59.97, got ${cartResult.lineItems[1]!.lineTotal}`);
  }
  console.log('  ✅ نجح الفحص: إجمالي السلة والإيصال دقيق تماماً (الإجمالي الفرعي 177.83، الخصم 17.78، الصافي 160.05).');

  console.log('\n🎉 اكتمل اختبار الدقة المالية بنجاح تام 100%!');
}

runFinancialPrecisionSuite().catch((err) => {
  console.error('❌ فشل اختبار الدقة المالية:', err);
  process.exit(1);
});
