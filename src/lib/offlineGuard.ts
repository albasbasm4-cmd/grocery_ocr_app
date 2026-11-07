import { ar } from '../i18n/ar';
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
      ar.onlineRequiredForAction(actionTitle)
    );
  }
}

export function ensureOnlineWithToast(
  actionTitle: string,
  showToast: (message: string, type: 'error' | 'success' | 'info') => void
): boolean {
  if (!isOnline()) {
    showToast(
      ar.onlineRequiredForAction(actionTitle),
      'error'
    );
    return false;
  }
  return true;
}
