/**
 * أنواع البيانات الأساسية للتطبيق - Grocery POS & Inventory
 * مطابقة للمحددات المعمارية: store_id كمعرّف عزل، وتفادي float.
 */

export type UserRole = 'owner' | 'staff';

export interface StoreMember {
  id: string;
  store_id: string;
  user_id: string;
  role: UserRole;
  created_at: string;
}

export interface StoreSettings {
  id: string;
  name: string;
  currency_code: string;   // e.g. 'SAR', 'YER', 'EGP'
  currency_symbol: string; // e.g. 'ر.س', 'ر.ي', 'ج.م'
  created_at: string;
}
