/**
 * دوال معالجة وتنسيق الأرقام اللاتينية والهندية/العربية
 */

const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

/**
 * تحويل أي أرقام هندية أو مشرقية إلى أرقام لاتينية قياسية (0-9)
 */
export function toLatinDigits(value: string | number): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  return str
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776))
    .replace(/٫/g, '.') // الفاصلة العشرية العربية
    .replace(/٬/g, ''); // فاصلة الآلاف
}

/**
 * تحويل الأرقام اللاتينية إلى أرقام هندية/عربية مشرقية (٠-٩) للعرض فقط
 */
export function toArabicDigits(value: string | number): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  return str.replace(/[0-9]/g, (d) => ARABIC_DIGITS[Number(d)] ?? d);
}

/**
 * تنسيق الأرقام للعرض حسب نمط الأرقام المختار في الإعدادات
 */
export function formatNumberDisplay(
  value: number | string | null | undefined,
  format: 'latin' | 'arabic' = 'latin',
  options?: { decimals?: number; minDecimals?: number }
): string {
  if (value === null || value === undefined || value === '') return format === 'arabic' ? '٠' : '0';
  const num = typeof value === 'number' ? value : parseFloat(toLatinDigits(value));
  if (isNaN(num)) return String(value);

  const decimals = options?.decimals ?? 2;
  const minDecimals = options?.minDecimals ?? 0;

  // تنسيق قياسي
  const formattedLatin = num.toLocaleString('en-US', {
    minimumFractionDigits: minDecimals,
    maximumFractionDigits: decimals,
  });

  if (format === 'arabic') {
    return toArabicDigits(formattedLatin);
  }
  return formattedLatin;
}

/**
 * تنسيق العملة مع الرمز حسب النمط
 */
export function formatCurrencyDisplay(
  amount: number | string | null | undefined,
  currencySymbol = 'ر.س',
  format: 'latin' | 'arabic' = 'latin',
  decimals = 2
): string {
  const formattedVal = formatNumberDisplay(amount, format, { decimals, minDecimals: decimals });
  return `${formattedVal} ${currencySymbol}`;
}
