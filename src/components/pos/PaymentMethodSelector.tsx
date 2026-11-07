import React, { useEffect, useState } from 'react';
import { Banknote, UserPlus, Users, Search } from 'lucide-react';
import { useCart } from '../../contexts/CartContext';
import { useAuth } from '../../contexts/AuthContext';
import { fetchCustomers } from '../../services/customersService';
import { NewCustomerModal } from '../customers/NewCustomerModal';
import { ar } from '../../i18n/ar';
import { formatCurrencyDisplay } from '../../lib/numbers';
import type { Customer } from '../../types';

interface PaymentMethodSelectorProps {
  currencySymbol: string;
  numberFormat: 'latin' | 'arabic';
}

export const PaymentMethodSelector: React.FC<PaymentMethodSelectorProps> = ({
  currencySymbol,
  numberFormat,
}) => {
  const { paymentMethod, setPaymentMethod, selectedCustomer, setSelectedCustomer } = useCart();
  const auth = useAuth();
  const activeStore = auth.store || auth.activeStore;

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [loadingCustomers, setLoadingCustomers] = useState(false);

  useEffect(() => {
    if (paymentMethod === 'credit' && activeStore) {
      setLoadingCustomers(true);
      fetchCustomers(activeStore.id, customerSearch)
        .then(setCustomers)
        .catch(console.error)
        .finally(() => setLoadingCustomers(false));
    }
  }, [paymentMethod, activeStore, customerSearch]);

  const handleCustomerCreated = (newCust: Customer) => {
    setCustomers((prev) => [newCust, ...prev]);
    setSelectedCustomer(newCust);
    setIsPickerOpen(false);
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-xs font-bold text-slate-300">{ar.paymentMethod}</label>
        {paymentMethod === 'credit' && !selectedCustomer && (
          <span className="text-[11px] text-amber-400 font-medium">
            {ar.customerRequiredForCredit}
          </span>
        )}
      </div>

      {/* زرّي نقدي / آجل */}
      <div className="grid grid-cols-2 gap-2 p-1 bg-slate-950 rounded-xl border border-slate-800">
        <button
          type="button"
          onClick={() => {
            setPaymentMethod('cash');
            setIsPickerOpen(false);
          }}
          className={`py-2 px-3 text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 transition ${
            paymentMethod === 'cash'
              ? 'bg-emerald-600 text-white shadow'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Banknote className="w-4 h-4" />
          <span>{ar.paymentCash}</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setPaymentMethod('credit');
            setIsPickerOpen(true);
          }}
          className={`py-2 px-3 text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 transition ${
            paymentMethod === 'credit'
              ? 'bg-amber-600 text-white shadow'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>{ar.paymentCredit}</span>
        </button>
      </div>

      {/* تفاصيل العميل عند اختيار الدفع الآجل */}
      {paymentMethod === 'credit' && (
        <div className="pt-2 border-t border-slate-800/80 space-y-2 animate-in fade-in">
          {selectedCustomer ? (
            <div className="bg-slate-950 border border-amber-500/30 rounded-xl p-3 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-amber-300">{selectedCustomer.name}</p>
                {selectedCustomer.phone && (
                  <p className="text-[11px] text-slate-400">{selectedCustomer.phone}</p>
                )}
                <p className="text-[11px] text-slate-400 mt-1">
                  {ar.previousBalanceDue}{' '}
                  <span className="font-bold text-rose-400">
                    {formatCurrencyDisplay(selectedCustomer.balance, currencySymbol, numberFormat)}
                  </span>
                </p>
              </div>

              <button
                type="button"
                onClick={() => setIsPickerOpen(true)}
                className="text-xs text-amber-400 hover:text-amber-300 underline font-medium px-2 py-1"
              >
                {ar.change}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsPickerOpen(true)}
              className="w-full py-2.5 px-3 bg-slate-950 border border-dashed border-amber-500/40 hover:border-amber-500 rounded-xl text-amber-300 text-xs font-bold flex items-center justify-center gap-2 transition"
            >
              <Users className="w-4 h-4" />
              <span>{ar.selectCustomer}</span>
            </button>
          )}

          {/* قائمة اختيار العميل المنسدلة / المنبثقة */}
          {isPickerOpen && (
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2 mt-2">
              <div className="flex items-center justify-between gap-2">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-2.5" />
                  <input
                    type="text"
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    placeholder={ar.searchCustomerPlaceholderPos}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg pr-8 pl-3 py-1.5 text-xs text-white outline-none focus:border-emerald-500 text-right"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => setIsCustomerModalOpen(true)}
                  className="bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 shrink-0 transition"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>{ar.newCustomer}</span>
                </button>
              </div>

              {loadingCustomers ? (
                <p className="text-center text-xs text-slate-400 py-2">{ar.loadingGeneric}</p>
              ) : customers.length === 0 ? (
                <div className="text-center py-3">
                  <p className="text-xs text-slate-400">{ar.noMatchingCustomers}</p>
                </div>
              ) : (
                <div className="max-h-40 overflow-y-auto space-y-1 divide-y divide-slate-800/40">
                  {customers.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setSelectedCustomer(c);
                        setIsPickerOpen(false);
                      }}
                      className="w-full text-right p-2 rounded-lg hover:bg-slate-800/60 flex items-center justify-between text-xs transition"
                    >
                      <div>
                        <span className="font-bold text-slate-200 block">{c.name}</span>
                        {c.phone && <span className="text-[10px] text-slate-400">{c.phone}</span>}
                      </div>
                      <span className="text-[11px] text-slate-400">
                        {Number(c.balance) > 0 ? (
                          <span className="text-rose-400 font-bold">
                            {ar.customerDebtLabel(formatCurrencyDisplay(c.balance, currencySymbol, numberFormat))}
                          </span>
                        ) : (
                          <span className="text-emerald-400 font-medium">{ar.noDebtOnCustomer}</span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <NewCustomerModal
        isOpen={isCustomerModalOpen}
        onClose={() => setIsCustomerModalOpen(false)}
        onSuccess={handleCustomerCreated}
      />
    </div>
  );
};
