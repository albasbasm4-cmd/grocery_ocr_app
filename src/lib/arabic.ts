/**
 * أدوات التطبيع والفرز العربي المطابقة لقواعد التطبيع في قاعدة البيانات
 */

/**
 * تطبيع النص العربي:
 * 1. تحويل الحروف الإنجليزية إلى أحرف صغيرة وإزالة المسافات من الأطراف
 * 2. إزالة التشكيل (الفتحة، الضمة، الكسرة، السكون، الشدة، التنوين)
 * 3. إزالة التطويل / الكشيدة (ـ)
 * 4. توحيد أشكال الألف: [أ إ آ ٱ] -> ا
 * 5. توحيد التاء المربوطة: ة -> ه
 * 6. توحيد الألف المقصورة: ى -> ي
 * 7. تحويل الأرقام الهندية (الشرقية) إلى أرقام لاتينية
 * 8. اختزال المسافات المتعددة إلى مسافة واحدة
 */
export function normalizeArabic(text: string | null | undefined): string {
  if (!text) return '';

  let clean = text.trim().toLowerCase();

  // إزالة التشكيل
  clean = clean.replace(/[\u064B-\u0652\u0670]/g, '');

  // إزالة التطويل
  clean = clean.replace(/ـ/g, '');

  // توحيد أشكال الألف
  clean = clean.replace(/[أإآٱ]/g, 'ا');

  // توحيد التاء المربوطة
  clean = clean.replace(/ة/g, 'ه');

  // توحيد الألف المقصورة
  clean = clean.replace(/ى/g, 'ي');

  // تحويل الأرقام الهندية والمشرقية
  clean = clean
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776));

  // اختزال المسافات
  clean = clean.replace(/\s+/g, ' ');

  return clean;
}

/**
 * مقارن ترتيبي عربي دقيق باستخدام Intl.Collator
 */
const arabicCollator = new Intl.Collator('ar', {
  sensitivity: 'base',
  numeric: true,
  ignorePunctuation: true,
});

export function compareArabic(a: string, b: string): number {
  return arabicCollator.compare(a, b);
}

/**
 * ترتيب مصفوفة عناصر أبجدياً بالعربية حسب حقل محدد
 */
export function sortArabic<T>(items: T[], keySelector: (item: T) => string): T[] {
  return [...items].sort((a, b) => compareArabic(keySelector(a), keySelector(b)));
}
