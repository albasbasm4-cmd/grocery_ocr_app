import Dexie, { type Table } from 'dexie';
import type { Category, Customer, PaymentMethod, Product } from '../types';

export interface OutboxSaleItem {
  product_id: string;
  quantity: number | string;
  product_name_snapshot?: string;
  unit_price_snapshot?: string;
}

export type OutboxStatus = 'pending_sync' | 'syncing' | 'synced' | 'needs_review' | 'failed';

export interface OutboxSale {
  client_uuid: string; // Primary key
  store_id: string;
  items: OutboxSaleItem[];
  discount_amount: string;
  payment_method: PaymentMethod;
  customer_id?: string | null;
  customer_name?: string | null;
  subtotal: string;
  total_amount: string;
  created_at: string;
  status: OutboxStatus;
  retry_count: number;
  last_error?: string | null;
  error_code?: string | null;
  error_details?: string | null;
  synced_at?: string | null;
  sale_id?: string | null;
}

export interface SyncMeta {
  key: string;
  value: string;
}

export class GroceryOfflineDb extends Dexie {
  products!: Table<Product, string>;
  categories!: Table<Category, string>;
  customers!: Table<Customer, string>;
  outbox_sales!: Table<OutboxSale, string>;
  sync_meta!: Table<SyncMeta, string>;

  constructor(options?: { indexedDB?: IDBFactory; IDBKeyRange?: typeof IDBKeyRange }) {
    super('GroceryOfflineDB', options);
    this.version(1).stores({
      products: 'id, store_id, barcode, sku_small_text, name_normalized, is_active, updated_at',
      categories: 'id, store_id, sort_order, updated_at',
      customers: 'id, store_id, phone, updated_at',
      outbox_sales: 'client_uuid, store_id, status, created_at',
      sync_meta: 'key',
    });
  }
}

export const offlineDb = new GroceryOfflineDb();
