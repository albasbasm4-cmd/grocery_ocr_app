import React, { useState } from 'react';
import Decimal from 'decimal.js';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { ar } from '../../i18n/ar';
import { formatCurrencyDisplay, toLatinDigits } from '../../lib/numbers';
import { recordCustomerPayment } from '../../services/customersService';
import type { Customer } from '../../types';

interface RecordPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  customer: Customer | null;
  currencySymbol: string;
  numberFormat: 'latin' | 'arabic';
  onSuccess: () => void;
}

export const RecordPaymentModal: React.FC<RecordPaymentModalProps> = ({
  isOpen,
  onClose,
  customer,
  currencySymbol,
  numberFormat,
  onSuccess,
}) => {
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!customer) return null;

  const currentBalance = customer.balance;

  const handleQuickFillAll = () => {
    setAmount(currentBalance);
    setError(null);
  };

  const handleInputChange = (val: string) => {
    const raw = toLatinDigits(val);
    let cleaned = '';
    let hasDot = false;
    for (const ch of raw) {
      if (ch >= '0' && ch <= '9') {
        cleaned += ch;
      } else if (ch === '.' && !hasDot) {
        cleaned += '.';
        hasDot = true;
      }
    }
    setAmount(cleaned);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanAmount = amount.trim();
    if (!cleanAmount) {
      setError(ar.paymentAmountRequired);
      return;
    }

    try {
      const dec = new Decimal(cleanAmount);
      if (!dec.isFinite() || dec.lessThanOrEqualTo(0)) {
        setError(ar.paymentAmountRequired);
        return;
      }

      setLoading(true);
      setError(null);
      await recordCustomerPayment(customer.id, cleanAmount);
      setAmount('');
      onSuccess();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'فشل تسجيل الدفعة.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={ar.recordPayment}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* ملخص دين العميل */}
        <div className="bg-slate-950 border border-slate-800 rounded-2xl p-3.5 space-y-1.5 text-xs">
          <div className="flex justify-between text-slate-400">
            <span>العميل:</span>
            <span className="font-bold text-white">{customer.name}</span>
          </div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-slate-400">إجمالي الدين الحالي:</span>
            <span className="font-extrabold text-rose-400 text-base">
              {formatCurrencyDisplay(customer.balance, currencySymbol, numberFormat)}
            </span>
          </div>
        </div>

        {error && (
          <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 p-3 rounded-xl text-xs font-semibold">
            {error}
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-semibold text-slate-300">
              {ar.paymentAmount} ({currencySymbol}) *
            </label>
            {Number(currentBalance) > 0 && (
              <button
                type="button"
                onClick={handleQuickFillAll}
                className="text-[11px] font-bold text-emerald-400 hover:text-emerald-300 transition"
              >
                سداد كامل الدين
              </button>
            )}
          </div>

          <input
            type="text"
            inputMode="decimal"
            required
            value={amount}
            onChange={(e) => handleInputChange(e.target.value)}
            placeholder="0.00"
            className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-white text-lg font-bold outline-none focus:border-emerald-500 text-right"
            autoFocus
          />
        </div>

        <div className="flex gap-2 pt-2">
          <Button
            type="submit"
            variant="primary"
            disabled={loading || !amount.trim()}
            className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5"
          >
            {loading ? ar.loading : ar.recordPayment}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            {ar.cancel}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
