import { useState, useEffect, useCallback, useMemo } from 'react';
import { Users, UserPlus, Search, RefreshCw, ArrowRight } from 'lucide-react';
import Decimal from 'decimal.js';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import { useToast } from '../contexts/ToastContext';
import { NewCustomerModal } from '../components/customers/NewCustomerModal';
import { CustomerDetailsModal } from '../components/customers/CustomerDetailsModal';
import { RecordPaymentModal } from '../components/customers/RecordPaymentModal';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { ar } from '../i18n/ar';
import { formatCurrencyDisplay } from '../lib/numbers';
import { fetchCustomers } from '../../src/services/customersService';
import type { Customer } from '../types';

export default function CustomersPage() {
  const auth = useAuth() as any;
  const store = auth.store || auth.currentStore;
  const { numberFormat } = useSettings();
  const { showToast } = useToast();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [onlyDebt, setOnlyDebt] = useState(false);

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  const [paymentCustomer, setPaymentCustomer] = useState<Customer | null>(null);
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);

  const currencySymbol = store?.currency_symbol || 'ر.س';

  const loadCustomers = useCallback(async () => {
    if (!store) return;
    try {
      setLoading(true);
      const data = await fetchCustomers(store.id, search);
      setCustomers(data);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'تعذر تحميل بيانات العملاء.', 'error');
    } finally {
      setLoading(false);
    }
  }, [store, search, showToast]);

  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers]);

  // إجمالي الديون المستحقة عبر Decimal.js
  const totalDebt = useMemo(() => {
    let sum = new Decimal(0);
    for (const c of customers) {
      try {
        const bal = new Decimal(c.balance || '0');
        if (bal.isFinite() && bal.greaterThan(0)) {
          sum = sum.plus(bal);
        }
      } catch {
        // ignore
      }
    }
    return sum.toFixed(2);
  }, [customers]);

  const filtered = useMemo(() => {
    if (!onlyDebt) return customers;
    return customers.filter((c) => {
      try {
        return new Decimal(c.balance || '0').greaterThan(0);
      } catch {
        return false;
      }
    });
  }, [customers, onlyDebt]);

  return (
    <div className="space-y-4 pb-20 max-w-3xl mx-auto" dir="rtl">
      {/* الترويسة وأزرار الإجراءات */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-white">{ar.customersTitle}</h1>
          <p className="text-xs text-slate-400 mt-0.5">إدارة حسابات العملاء ومتابعة الديون والمدفوعات</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadCustomers()}
            disabled={loading}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition"
            title="تحديث"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          <Button
            type="button"
            variant="primary"
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs py-2 px-3 rounded-xl shadow"
          >
            <UserPlus className="w-4 h-4" />
            <span>{ar.addNewCustomer}</span>
          </Button>
        </div>
      </div>

      {/* بطاقة ملخص الديون الإجمالية */}
      <div className="bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800 rounded-2xl p-4 flex items-center justify-between shadow-sm">
        <div>
          <span className="text-xs text-slate-400 block mb-1">{ar.totalCustomerDebt}</span>
          <span className="text-2xl font-black text-rose-400">
            {formatCurrencyDisplay(totalDebt, currencySymbol, numberFormat)}
          </span>
        </div>
        <div className="text-left">
          <span className="text-xs text-slate-400 block mb-1">{ar.customersCount}</span>
          <span className="text-base font-bold text-slate-200">{customers.length} عميل</span>
        </div>
      </div>

      {/* شريط البحث وتصفية المدينين */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-3">
        <div className="flex items-center bg-slate-950 border border-slate-700 focus-within:border-emerald-500 rounded-xl px-3 py-2 text-xs">
          <Search className="w-3.5 h-3.5 text-slate-400 ml-2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={ar.searchCustomerPlaceholder}
            className="w-full bg-transparent text-white outline-none text-right"
          />
        </div>

        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => setOnlyDebt(false)}
            className={`px-3 py-1.5 rounded-lg font-bold transition ${
              !onlyDebt
                ? 'bg-emerald-600 text-white shadow'
                : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            {ar.allCustomers} ({customers.length})
          </button>

          <button
            type="button"
            onClick={() => setOnlyDebt(true)}
            className={`px-3 py-1.5 rounded-lg font-bold transition ${
              onlyDebt
                ? 'bg-rose-600 text-white shadow'
                : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            {ar.filterDebtOnly}
          </button>
        </div>
      </div>

      {/* قائمة العملاء */}
      {loading ? (
        <div className="py-12 flex justify-center">
          <LoadingSpinner />
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-12 bg-slate-900/40 border border-dashed border-slate-800 rounded-3xl">
          <EmptyState
            icon={<Users className="w-10 h-10 text-slate-500" />}
            title={ar.noCustomersFound}
            description="يمكنك إضافة عملاء جدد لتسجيل الفواتير الآجلة ومتابعة التحصيل."
          />
        </div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((customer) => {
            const hasDebt = Number(customer.balance) > 0;
            return (
              <div
                key={customer.id}
                className="bg-slate-900 hover:bg-slate-850 border border-slate-800 rounded-2xl p-4 transition flex items-center justify-between gap-3 shadow-sm"
              >
                {/* النقر على تفاصيل العميل */}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCustomer(customer);
                    setIsDetailsOpen(true);
                  }}
                  className="flex-1 text-right min-w-0"
                >
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-white text-sm truncate">{customer.name}</h3>
                    {hasDebt ? (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30">
                        مدين
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                        مسدد
                      </span>
                    )}
                  </div>
                  {customer.phone && (
                    <p className="text-xs text-slate-400 mt-0.5">{customer.phone}</p>
                  )}
                  <p className="text-xs text-slate-400 mt-1">
                    الرصيد:{' '}
                    <span
                      className={`font-black ${hasDebt ? 'text-rose-400' : 'text-emerald-400'}`}
                    >
                      {formatCurrencyDisplay(customer.balance, currencySymbol, numberFormat)}
                    </span>
                  </p>
                </button>

                {/* زر سداد سريع إذا كان عليه دين */}
                <div className="flex items-center gap-2 shrink-0">
                  {hasDebt && (
                    <button
                      type="button"
                      onClick={() => {
                        setPaymentCustomer(customer);
                        setIsPaymentOpen(true);
                      }}
                      className="bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 text-xs font-bold py-2 px-3 rounded-xl transition"
                    >
                      {ar.recordPayment}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCustomer(customer);
                      setIsDetailsOpen(true);
                    }}
                    className="p-2 text-slate-500 hover:text-white rounded-xl transition"
                    title={ar.customerHistory}
                  >
                    <ArrowRight className="w-4 h-4 -rotate-180" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* نوافذ الحوار */}
      <NewCustomerModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSuccess={(_newCust) => {
          showToast(ar.customerCreated, 'success');
          void loadCustomers();
        }}
      />

      <CustomerDetailsModal
        isOpen={isDetailsOpen}
        onClose={() => setIsDetailsOpen(false)}
        customer={selectedCustomer}
        currencySymbol={currencySymbol}
        numberFormat={numberFormat}
        onUpdated={() => void loadCustomers()}
      />

      <RecordPaymentModal
        isOpen={isPaymentOpen}
        onClose={() => setIsPaymentOpen(false)}
        customer={paymentCustomer}
        currencySymbol={currencySymbol}
        numberFormat={numberFormat}
        onSuccess={() => {
          showToast(ar.paymentSuccess, 'success');
          void loadCustomers();
        }}
      />
    </div>
  );
}
