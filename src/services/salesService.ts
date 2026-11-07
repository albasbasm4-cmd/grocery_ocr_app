import Decimal from 'decimal.js';
import { supabase } from '../lib/supabase';
import type { Customer, PaymentMethod, Sale, SaleItem, SaleStatus } from '../types';
import { assertOnline } from '../lib/offlineGuard';
import { ar } from '../i18n/ar';

export interface ProcessSaleItemPayload {
  product_id: string;
  quantity: number | string;
}

export interface ProcessSaleInput {
  storeId: string;
  clientUuid: string;
  items: ProcessSaleItemPayload[];
  discountAmount: string;
  paymentMethod: PaymentMethod;
  customerId?: string | null;
}

export interface ProcessSaleResult {
  sale: Sale;
  idempotent_cached: boolean;
}

export interface SaleWithDetails extends Sale {
  customer?: Customer | null;
  items: SaleItem[];
}

export interface SalesFilterOptions {
  storeId: string;
  dateRange?: 'all' | 'today' | 'yesterday' | 'last7days' | 'thisMonth';
  status?: SaleStatus | 'all';
  paymentMethod?: PaymentMethod | 'all';
  limit?: number;
  offset?: number;
}

export async function processSale(input: ProcessSaleInput): Promise<ProcessSaleResult> {
  const discountDec = new Decimal(input.discountAmount || '0');
  if (!discountDec.isFinite() || discountDec.isNegative()) {
    throw new Error(ar.invalidDiscountError);
  }

  if (!input.items || input.items.length === 0) {
    throw new Error(ar.cartEmptyError);
  }

  if (input.paymentMethod === 'credit' && !input.customerId) {
    throw new Error(ar.customerRequiredCreditError);
  }

  const { data, error } = await supabase.rpc('process_sale', {
    p_store_id: input.storeId,
    p_client_uuid: input.clientUuid,
    p_items: input.items,
    p_discount_amount: discountDec.toFixed(2),
    p_payment_method: input.paymentMethod,
    p_customer_id: input.customerId || null,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as ProcessSaleResult;
}

export async function fetchSales(options: SalesFilterOptions): Promise<SaleWithDetails[]> {
  let query = supabase
    .from('sales')
    .select('*, customer:customers(id, store_id, name, phone, balance, created_at)')
    .eq('store_id', options.storeId)
    .order('created_at', { ascending: false });

  if (options.status && options.status !== 'all') {
    query = query.eq('status', options.status);
  }

  if (options.paymentMethod && options.paymentMethod !== 'all') {
    query = query.eq('payment_method', options.paymentMethod);
  }

  const now = new Date();
  if (options.dateRange === 'today') {
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    query = query.gte('created_at', startOfDay);
  } else if (options.dateRange === 'yesterday') {
    const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const endOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    query = query.gte('created_at', startOfYesterday.toISOString()).lt('created_at', endOfYesterday.toISOString());
  } else if (options.dateRange === 'last7days') {
    const past7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    query = query.gte('created_at', past7);
  } else if (options.dateRange === 'thisMonth') {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    query = query.gte('created_at', startOfMonth);
  }

  if (typeof options.limit === 'number') {
    const offset = options.offset || 0;
    query = query.range(offset, offset + options.limit - 1);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as SaleWithDetails[];
}

export async function fetchSaleDetails(saleId: string, isOwner = false): Promise<SaleWithDetails | null> {
  const { data: saleData, error: saleError } = await supabase
    .from('sales')
    .select('*, customer:customers(id, store_id, name, phone, balance, created_at)')
    .eq('id', saleId)
    .single();

  if (saleError) {
    if (saleError.code === 'PGRST116') return null;
    throw new Error(saleError.message);
  }

  const { data: itemsData, error: itemsError } = await supabase
    .from('sale_items')
    .select('id, sale_id, product_id, product_name_snapshot, unit_price_snapshot, quantity, line_total')
    .eq('sale_id', saleId)
    .order('product_name_snapshot');

  if (itemsError) throw new Error(itemsError.message);

  let items = (itemsData ?? []) as SaleItem[];

  if (isOwner) {
    try {
      const { data: costData } = await supabase.rpc('get_sale_items_cost', {
        p_sale_id: saleId,
      });
      if (Array.isArray(costData)) {
        const costMap = new Map<string, string>();
        for (const c of costData) {
          costMap.set(c.item_id, String(c.cost_price_snapshot ?? '0'));
        }
        items = items.map((item) => ({
          ...item,
          cost_price_snapshot: costMap.get(item.id) ?? '0',
        }));
      }
    } catch {
      // ignore
    }
  }

  return {
    ...(saleData as Sale),
    customer: saleData.customer as Customer | null,
    items,
  };
}

export async function voidSale(saleId: string, reason: string): Promise<void> {
  assertOnline(ar.voidSale);

  const cleanReason = reason.trim();
  if (!cleanReason) throw new Error(ar.voidReasonRequired);

  const { error } = await supabase.rpc('void_sale', {
    p_sale_id: saleId,
    p_reason: cleanReason,
  });

  if (error) throw new Error(error.message);
}

export interface ReturnItemPayload {
  product_id: string;
  quantity: number;
}

export async function returnItems(
  saleId: string,
  items: ReturnItemPayload[],
  reason: string
): Promise<{ totalRefundAmount: number }> {
  assertOnline(ar.returnItems);

  const cleanReason = reason.trim();
  if (!cleanReason) throw new Error(ar.returnReasonRequired);

  if (!items || items.length === 0) {
    throw new Error(ar.returnItemsSelectError);
  }

  const { data, error } = await supabase.rpc('return_items', {
    p_sale_id: saleId,
    p_items: items,
    p_reason: cleanReason,
  });

  if (error) throw new Error(error.message);
  return {
    totalRefundAmount: new Decimal(data?.total_refund_amount ?? 0).toNumber(),
  };
}
