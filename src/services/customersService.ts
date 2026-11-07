import Decimal from 'decimal.js';
import { supabase } from '../lib/supabase';
import type { Customer, CustomerPayment, Sale } from '../types';
import { offlineDb } from '../lib/offlineDb';
import { isOnline, assertOnline } from '../lib/offlineGuard';

export interface CreateCustomerInput {
  storeId: string;
  name: string;
  phone?: string | null;
}

export async function fetchCustomers(storeId: string, search = ''): Promise<Customer[]> {
  const trimmed = search.trim();

  if (!isOnline()) {
    try {
      const locals = await offlineDb.customers.where('store_id').equals(storeId).toArray();
      if (!trimmed) return locals;
      const lower = trimmed.toLowerCase();
      return locals.filter(
        (c) => c.name.toLowerCase().includes(lower) || (c.phone && c.phone.includes(trimmed))
      );
    } catch {
      return [];
    }
  }

  try {
    let query = supabase
      .from('customers')
      .select('id, store_id, name, phone, balance, created_at')
      .eq('store_id', storeId)
      .order('name');

    if (trimmed) {
      const escaped = trimmed.replace(/[\\%_]/g, (char) => `\\${char}`);
      query = query.or(`name.ilike.%${escaped}%,phone.ilike.%${escaped}%`);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const customers = (data ?? []) as Customer[];
    await offlineDb.customers.bulkPut(customers).catch(() => undefined);
    return customers;
  } catch (err) {
    try {
      const locals = await offlineDb.customers.where('store_id').equals(storeId).toArray();
      if (!trimmed) return locals;
      const lower = trimmed.toLowerCase();
      return locals.filter(
        (c) => c.name.toLowerCase().includes(lower) || (c.phone && c.phone.includes(trimmed))
      );
    } catch {
      return [];
    }
  }
}

export async function fetchCustomerById(customerId: string): Promise<Customer | null> {
  if (!isOnline()) {
    const local = await offlineDb.customers.get(customerId);
    return local || null;
  }

  const { data, error } = await supabase
    .from('customers')
    .select('id, store_id, name, phone, balance, created_at')
    .eq('id', customerId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    const local = await offlineDb.customers.get(customerId);
    if (local) return local;
    throw new Error(error.message);
  }
  return data as Customer;
}

export async function createCustomer(input: CreateCustomerInput): Promise<Customer> {
  assertOnline('إضافة عميل جديد');

  const cleanName = input.name.trim();
  if (!cleanName) throw new Error('اسم العميل مطلوب.');

  const cleanPhone = input.phone?.trim() || null;

  const { data, error } = await supabase
    .from('customers')
    .insert({
      store_id: input.storeId,
      name: cleanName,
      phone: cleanPhone,
    })
    .select('id, store_id, name, phone, balance, created_at')
    .single();

  if (error) throw new Error(error.message);

  await offlineDb.customers.put(data as Customer).catch(() => undefined);

  return data as Customer;
}

export async function fetchCustomerSales(customerId: string): Promise<Sale[]> {
  const { data, error } = await supabase
    .from('sales')
    .select('id, store_id, created_by, customer_id, subtotal, discount_amount, total_amount, payment_method, status, client_uuid, created_at')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as Sale[];
}

export async function fetchCustomerPayments(customerId: string): Promise<CustomerPayment[]> {
  const { data, error } = await supabase
    .from('customer_payments')
    .select('id, store_id, customer_id, amount, created_by, created_at')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as CustomerPayment[];
}

export async function recordCustomerPayment(customerId: string, amount: string): Promise<CustomerPayment> {
  assertOnline('تسجيل سداد دفعة للعميل');

  const decAmount = new Decimal(amount.trim() || '0');
  if (!decAmount.isFinite() || decAmount.lessThanOrEqualTo(0)) {
    throw new Error('مبلغ السداد يجب أن يكون أكبر من الصفر.');
  }

  const { data, error } = await supabase.rpc('record_customer_payment', {
    p_customer_id: customerId,
    p_amount: decAmount.toNumber(),
  });

  if (error) throw new Error(error.message);
  return data as CustomerPayment;
}
