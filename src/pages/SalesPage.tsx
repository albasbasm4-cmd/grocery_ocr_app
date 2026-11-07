import { useState, useEffect, useCallback } from 'react';
import { Receipt, Search, RefreshCw, ArrowRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import { useToast } from '../contexts/ToastContext';
import { SaleDetailsModal } from '../components/sales/SaleDetailsModal';
import { EmptyState } from '../components/ui/EmptyState';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { ar } from '../i18n/ar';
import { formatCurrencyDisplay } from '../lib/numbers';
import { fetchSales, fetchSaleDetails } from '../services/salesService';
import type { SaleWithDetails, SalesFilterOptions } from '../services/salesService';
import type { PaymentMethod, SaleStatus } from '../types';
export type DateRange = 'all' | 'today' | 'yesterday' | 'last7days' | 'thisMonth';
type PaymentFilter = 'all' | 'cash' | 'credit';
type StatusFilter = 'all' | 'completed' | 'voided';

function isDateRange(v: string): v is DateRange {
  return ['all', 'today', 'yesterday', 'last7days', 'thisMonth'].includes(v);
}
function isPaymentFilter(v: string): v is PaymentFilter {
  return ['all', 'cash', 'credit'].includes(v);
}
function isStatusFilter(v: string): v is StatusFilter {
  return ['all', 'completed', 'voided'].includes(v);
}


export default function SalesPage() {
  const auth = useAuth();
  const store = auth.store || auth.currentStore;
  const isOwner = auth.role === 'owner';
  const { numberFormat } = useSettings();
  const { showToast } = useToast();

  const [sales, setSales] = useState<SaleWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<SalesFilterOptions['dateRange']>('all');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | 'all'>('all');
  const [status, setStatus] = useState<SaleStatus | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [selectedSale, setSelectedSale] = useState<SaleWithDetails | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);

  const currencySymbol = store?.currency_symbol || ar.defaultCurrencySymbol;

  const loadSales = useCallback(async () => {
    if (!store) return;
    try {
      setLoading(true);
      const data = await fetchSales({
        storeId: store.id,
        dateRange,
        paymentMethod,
        status,
        limit: 50,
      });
      setSales(data);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : ar.loadInvoicesError, 'error');
    } finally {
      setLoading(false);
    }
  }, [store, dateRange, paymentMethod, status, showToast]);

  useEffect(() => {
    void loadSales();
  }, [loadSales]);

  const handleOpenSale = async (sale: SaleWithDetails) => {
    try {
      setLoadingDetails(true);
      const detailed = await fetchSaleDetails(sale.id, isOwner);
      if (detailed) {
        setSelectedSale(detailed);
        setIsDetailsOpen(true);
      }
    } catch (err) {
      showToast(ar.loadInvoiceDetailsError, 'error');
    } finally {
      setLoadingDetails(false);
    }
  };

  const filteredSales = sales.filter((s) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.trim().toLowerCase();
    const matchesId = s.id.toLowerCase().includes(query);
    const matchesCustomer = s.customer?.name.toLowerCase().includes(query) ?? false;
    return matchesId || matchesCustomer;
  });

  return (
    <div className="space-y-4 pb-20 max-w-3xl mx-auto" dir="rtl">
      {/* الترويسة */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-white">{ar.invoicesTitle}</h1>
          <p className="text-xs text-slate-400 mt-0.5">{ar.salesSubtitle}</p>
        </div>

        <button
          type="button"
          onClick={() => void loadSales()}
          disabled={loading}
          className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition"
          title={ar.refresh}
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* شريط البحث والفلاتر */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-3">
        {/* البحث */}
        <div className="flex items-center bg-slate-950 border border-slate-700 focus-within:border-emerald-500 rounded-xl px-3 py-2 text-xs">
          <Search className="w-3.5 h-3.5 text-slate-400 ml-2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={ar.searchInvoicePlaceholder}
            className="w-full bg-transparent text-white outline-none text-right"
          />
        </div>

        {/* فلاتر التاريخ */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
          {[
            { id: 'all', label: ar.filterAllDates },
            { id: 'today', label: ar.filterToday },
            { id: 'yesterday', label: ar.filterYesterday },
            { id: 'last7days', label: ar.filterLast7Days },
            { id: 'thisMonth', label: ar.filterThisMonth },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => { if (isDateRange(item.id)) setDateRange(item.id); }}
              className={`px-3 py-1.5 rounded-lg font-bold shrink-0 transition ${
                dateRange === item.id
                  ? 'bg-emerald-600 text-white shadow'
                  : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* فلاتر طريقة الدفع والحالة */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <select
            value={paymentMethod}
            onChange={(e) => { const v = e.target.value; if (isPaymentFilter(v)) setPaymentMethod(v); }}
            className="bg-slate-950 border border-slate-800 text-slate-300 rounded-xl px-3 py-2 outline-none focus:border-emerald-500 text-right"
          >
            <option value="all">{ar.allPaymentMethodsOption}</option>
            <option value="cash">{ar.paymentCash}</option>
            <option value="credit">{ar.paymentCredit}</option>
          </select>

          <select
            value={status}
            onChange={(e) => { const v = e.target.value; if (isStatusFilter(v)) setStatus(v); }}
            className="bg-slate-950 border border-slate-800 text-slate-300 rounded-xl px-3 py-2 outline-none focus:border-emerald-500 text-right"
          >
            <option value="all">{ar.allStatusesOption}</option>
            <option value="completed">{ar.statusCompleted}</option>
            <option value="voided">{ar.statusVoided}</option>
          </select>
        </div>
      </div>

      {/* قائمة الفواتير */}
      {loading ? (
        <div className="py-12 flex justify-center">
          <LoadingSpinner />
        </div>
      ) : filteredSales.length === 0 ? (
        <div className="py-12 bg-slate-900/40 border border-dashed border-slate-800 rounded-3xl">
          <EmptyState
            icon={<Receipt className="w-10 h-10 text-slate-500" />}
            title={ar.noSalesFound}
            description={ar.noInvoicesFilterDescription}
          />
        </div>
      ) : (
        <div className="space-y-2.5">
          {filteredSales.map((sale) => {
            const isCompleted = sale.status === 'completed';
            return (
              <button
                key={sale.id}
                type="button"
                onClick={() => void handleOpenSale(sale)}
                disabled={loadingDetails}
                className="w-full text-right bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-slate-700 rounded-2xl p-4 transition flex flex-col gap-2 group shadow-sm"
              >
                {/* الصف العلوي: رقم الفاتورة، التاريخ، والحالة */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-white text-sm">
                      #{sale.id.slice(0, 8).toUpperCase()}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        isCompleted
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                      }`}
                    >
                      {isCompleted ? ar.statusCompleted : ar.statusVoided}
                    </span>
                  </div>

                  <span className="text-xs text-slate-400">
                    {new Date(sale.created_at).toLocaleString('ar-SA', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>

                {/* الصف السفلي: العميل، طريقة الدفع، والإجمالي */}
                <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
                  <div className="flex items-center gap-2 text-xs">
                    <span
                      className={`px-2 py-0.5 rounded-lg font-bold text-[11px] ${
                        sale.payment_method === 'cash'
                          ? 'bg-slate-800 text-slate-300'
                          : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      }`}
                    >
                      {sale.payment_method === 'cash' ? ar.paymentCash : ar.paymentCredit}
                    </span>
                    {sale.customer && (
                      <span className="text-slate-300 font-bold truncate max-w-[130px]">
                        {sale.customer.name}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="text-base font-extrabold text-emerald-400">
                      {formatCurrencyDisplay(sale.total_amount, currencySymbol, numberFormat)}
                    </span>
                    <ArrowRight className="w-4 h-4 text-slate-500 group-hover:-translate-x-1 transition" />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* نافذة التفاصيل */}
      <SaleDetailsModal
        isOpen={isDetailsOpen}
        onClose={() => setIsDetailsOpen(false)}
        sale={selectedSale}
        currencySymbol={currencySymbol}
        numberFormat={numberFormat}
        onUpdated={() => void loadSales()}
      />
    </div>
  );
}
