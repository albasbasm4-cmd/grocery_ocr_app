import React, { useState, useEffect } from 'react';
import { CreditCard, Banknote } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { RecordPaymentModal } from './RecordPaymentModal';
import { ar } from '../../i18n/ar';
import { formatCurrencyDisplay } from '../../lib/numbers';
import { fetchCustomerSales, fetchCustomerPayments } from '../../services/customersService';
import type { Customer, CustomerPayment, Sale } from '../../types';

interface CustomerDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  customer: Customer | null;
  currencySymbol: string;
  numberFormat: 'latin' | 'arabic';
  onUpdated: () => void;
}

export const CustomerDetailsModal: React.FC<CustomerDetailsModalProps> = ({
  isOpen,
  onClose,
  customer,
  currencySymbol,
  numberFormat,
  onUpdated,
}) => {
  const [activeTab, setActiveTab] = useState<'sales' | 'payments'>('sales');
  const [sales, setSales] = useState<Sale[]>([]);
  const [payments, setPayments] = useState<CustomerPayment[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [isRecordPaymentOpen, setIsRecordPaymentOpen] = useState(false);

  useEffect(() => {
    if (!customer || !isOpen) return;
    setLoadingHistory(true);
    Promise.all([fetchCustomerSales(customer.id), fetchCustomerPayments(customer.id)])
      .then(([salesData, paymentsData]) => {
        setSales(salesData);
        setPayments(paymentsData);
      })
      .catch(console.error)
      .finally(() => setLoadingHistory(false));
  }, [customer, isOpen]);

  if (!customer) return null;

  const hasDebt = Number(customer.balance) > 0;

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title={`سجل العميل: ${customer.name}`} maxWidth="lg">
        <div className="space-y-4 text-xs">
          {/* معلومات العميل والرصيد */}
          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-extrabold text-white">{customer.name}</h3>
              {customer.phone && <p className="text-xs text-slate-400 mt-0.5">{customer.phone}</p>}
            </div>

            <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
              <div>
                <span className="text-[11px] text-slate-400 block">{ar.customerBalance}</span>
                <span
                  className={`text-base font-black ${
                    hasDebt ? 'text-rose-400' : 'text-emerald-400'
                  }`}
                >
                  {formatCurrencyDisplay(customer.balance, currencySymbol, numberFormat)}
                </span>
              </div>

              {hasDebt && (
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => setIsRecordPaymentOpen(true)}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs py-2 px-3"
                >
                  {ar.recordPayment}
                </Button>
              )}
            </div>
          </div>

          {/* التبويبات */}
          <div className="flex border-b border-slate-800 text-xs">
            <button
              type="button"
              onClick={() => setActiveTab('sales')}
              className={`pb-2 px-4 font-bold transition flex items-center gap-1.5 ${
                activeTab === 'sales'
                  ? 'border-b-2 border-emerald-500 text-emerald-400'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <CreditCard className="w-3.5 h-3.5" />
              <span>{ar.creditSalesHistory} ({sales.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('payments')}
              className={`pb-2 px-4 font-bold transition flex items-center gap-1.5 ${
                activeTab === 'payments'
                  ? 'border-b-2 border-emerald-500 text-emerald-400'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Banknote className="w-3.5 h-3.5" />
              <span>{ar.paymentsHistory} ({payments.length})</span>
            </button>
          </div>

          {/* محتوى السجل */}
          {loadingHistory ? (
            <p className="text-center text-slate-400 py-6">جارٍ تحميل السجل…</p>
          ) : activeTab === 'sales' ? (
            sales.length === 0 ? (
              <p className="text-center text-slate-500 py-6">{ar.noCreditSales}</p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto divide-y divide-slate-800/60">
                {sales.map((s) => (
                  <div key={s.id} className="pt-2 pb-1 flex items-center justify-between text-xs">
                    <div>
                      <span className="font-mono font-bold text-slate-200 block">
                        #{s.id.slice(0, 8).toUpperCase()}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {new Date(s.created_at).toLocaleString('ar-SA')}
                      </span>
                    </div>

                    <div className="text-left">
                      <span className="font-bold text-slate-200 block">
                        {formatCurrencyDisplay(s.total_amount, currencySymbol, numberFormat)}
                      </span>
                      <span
                        className={`text-[10px] font-bold ${
                          s.status === 'completed' ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {s.status === 'completed' ? ar.statusCompleted : ar.statusVoided}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : payments.length === 0 ? (
            <p className="text-center text-slate-500 py-6">{ar.noPayments}</p>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto divide-y divide-slate-800/60">
              {payments.map((p) => (
                <div key={p.id} className="pt-2 pb-1 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-bold text-emerald-400 block">دفعة نقدية مسددة</span>
                    <span className="text-[10px] text-slate-400">
                      {new Date(p.created_at).toLocaleString('ar-SA')}
                    </span>
                  </div>

                  <span className="font-black text-emerald-400 text-sm">
                    +{formatCurrencyDisplay(p.amount, currencySymbol, numberFormat)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>

      <RecordPaymentModal
        isOpen={isRecordPaymentOpen}
        onClose={() => setIsRecordPaymentOpen(false)}
        customer={customer}
        currencySymbol={currencySymbol}
        numberFormat={numberFormat}
        onSuccess={() => {
          onUpdated();
          onClose();
        }}
      />
    </>
  );
};
