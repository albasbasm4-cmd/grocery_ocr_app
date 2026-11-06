import Decimal from 'decimal.js';
import { supabase } from '../lib/supabase';
import type { Customer, CustomerPayment, Sale } from '../types';

export interface CreateCustomerInput {
  storeId: string;
  name: string;
  phone?: string | null;
}

export async function fetchCustomers(storeId: string, search = ''): Promise<Customer[]> {
  let query = supabase
    .from('customers')
    .select('id, store_id, name, phone, balance, created_at')
    .eq('store_id', storeId)
    .order('name');

  const trimmed = search.trim();
  if (trimmed) {
    const escaped = trimmed.replace(/[\\%_]/g, (char) => `\\${char}`);
    query = query.or(`name.ilike.%${escaped}%,phone.ilike.%${escaped}%`);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as Customer[];
}

export async function fetchCustomerById(customerId: string): Promise<Customer | null> {
  const { data, error } = await supabase
    .from('customers')
    .select('id, store_id, name, phone, balance, created_at')
    .eq('id', customerId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(error.message);
  }
  return data as Customer;
}

export async function createCustomer(input: CreateCustomerInput): Promise<Customer> {
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
