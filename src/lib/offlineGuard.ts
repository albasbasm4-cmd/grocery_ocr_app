/**
 * أداة التحقق من اتصال الإنترنت لحماية العمليات الحساسة (المرحلة 10)
 * تمنع العمليات الإدارية الحساسة أثناء انقطاع الإنترنت لحماية اتساق البيانات
 */

export function isOnline(): boolean {
  if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
    return navigator.onLine;
  }
  return true;
}

export function assertOnline(actionTitle: string): void {
  if (!isOnline()) {
    throw new Error(
      `عملية "${actionTitle}" تتطلب اتصالاً فعالاً بالإنترنت ولا يمكن إجراؤها في وضع عدم الاتصال.`
    );
  }
}

export function ensureOnlineWithToast(
  actionTitle: string,
  showToast: (message: string, type: 'error' | 'success' | 'info') => void
): boolean {
  if (!isOnline()) {
    showToast(
      `عملية "${actionTitle}" تتطلب اتصالاً فعالاً بالإنترنت ولا يمكن إجراؤها دون اتصال.`,
      'error'
    );
    return false;
  }
  return true;
}
