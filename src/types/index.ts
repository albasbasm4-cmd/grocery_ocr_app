/**
 * أنواع البيانات الأساسية ومطابقة جداول قاعدة البيانات - Grocery POS & Inventory
 * مطابقة للمحددات المعمارية: store_id كمعرّف عزل، وتفادي float.
 */

export type UserRole = 'owner' | 'staff';

export type ProductUnit = 'piece' | 'kg' | 'g' | 'carton' | 'pack' | 'box' | 'other';

export type PaymentMethod = 'cash' | 'credit';

export type SaleStatus = 'completed' | 'voided';

export type StockMovementType = 'sale' | 'return' | 'purchase' | 'adjustment' | 'damage' | 'void';

export interface Store {
  id: string;
  name: string;
  currency_code: string;
  currency_symbol: string;
  created_at: string;
}

export interface StoreMember {
  store_id: string;
  user_id: string;
  role: UserRole;
  created_at: string;
}

export interface Category {
  id: string;
  store_id: string;
  name: string;
  name_normalized: string;
  created_at: string;
}

export interface Product {
  id: string;
  store_id: string;
  category_id: string | null;
  name: string;
  name_normalized: string;
  barcode: string | null;
  sku_small_text: string | null;
  unit: ProductUnit;
  price: string; // تمثيل نصي لتجنب أخطاء float وتحويله عبر decimal.js
  cost_price: string;
  stock_quantity: string;
  min_stock: string;
  expiry_date: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Customer {
  id: string;
  store_id: string;
  name: string;
  phone: string | null;
  balance: string;
  created_at: string;
}

export interface Sale {
  id: string;
  store_id: string;
  created_by: string | null;
  customer_id: string | null;
  subtotal: string;
  discount_amount: string;
  total_amount: string;
  payment_method: PaymentMethod;
  status: SaleStatus;
  client_uuid: string;
  created_at: string;
}

export interface SaleItem {
  id: string;
  sale_id: string;
  product_id: string | null;
  product_name_snapshot: string;
  unit_price_snapshot: string;
  cost_price_snapshot: string;
  quantity: string;
  line_total: string;
}

export interface StockMovement {
  id: string;
  store_id: string;
  product_id: string;
  type: StockMovementType;
  quantity_delta: string;
  reference_id: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export interface CustomerPayment {
  id: string;
  store_id: string;
  customer_id: string;
  amount: string;
  created_by: string | null;
  created_at: string;
}
