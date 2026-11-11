import React, { useState } from 'react';
import Decimal from 'decimal.js';
import { RotateCcw } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useAuth } from '../../contexts/AuthContext';
import { returnItems } from '../../services/salesService';
import { ar } from '../../i18n/ar';
import { formatCurrencyDisplay, toLatinDigits } from '../../lib/numbers';
import type { SaleWithDetails } from '../../services/salesService';

interface ReturnItemsModalProps {
  isOpen: boolean;
  onClose: () => void;
  sale: SaleWithDetails | null;
  currencySymbol: string;
  numberFormat: 'latin' | 'arabic';
  onSuccess: (refundAmount: number) => void;
}

export const ReturnItemsModal: React.FC<ReturnItemsModalProps> = ({
  isOpen,
  onClose,
  sale,
  currencySymbol,
  numberFormat,
  onSuccess,
}) => {
  const { isOwner } = useAuth();
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!sale) return null;

  const handleQuantityChange = (productId: string, val: string, maxQty: string) => {
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

    try {
      if (cleaned) {
        const dec = new Decimal(cleaned);
        const max = new Decimal(maxQty);
        if (dec.greaterThan(max)) {
          cleaned = maxQty;
        }
      }
    } catch {
      // ignore
    }

    setQuantities((prev) => ({ ...prev, [productId]: cleaned }));
  };

  const getValidReturnPayload = () => {
    const itemsToReturn: Array<{ product_id: string; quantity: number }> = [];
    for (const [prodId, qtyStr] of Object.entries(quantities)) {
      try {
        const dec = new Decimal(qtyStr || '0');
        if (dec.greaterThan(0)) {
          itemsToReturn.push({ product_id: prodId, quantity: dec.toNumber() });
        }
      } catch {
        // ignore
      }
    }
    return itemsToReturn;
  };

  const performReturn = async () => {
    const itemsToReturn = getValidReturnPayload();
    if (itemsToReturn.length === 0) {
      setError(ar.returnMinOneItem);
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      const res = await returnItems(sale.id, itemsToReturn, reason);
      setQuantities({});
      setReason('');
      onSuccess(res.totalRefundAmount);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : ar.returnFailedError);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStartReturn = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOwner) {
      setError(ar.returnOwnerOnlyError);
      return;
    }

    if (!reason.trim()) {
      setError(ar.returnReasonRequired);
      return;
    }

    const payload = getValidReturnPayload();
    if (payload.length === 0) {
      setError(ar.selectReturnQtyPrompt);
      return;
    }

    void performReturn();
  };

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title={ar.returnItems} maxWidth="lg">
        <form onSubmit={handleStartReturn} className="space-y-4">
          <p className="text-xs text-slate-400">{ar.returnItemSelectPrompt}</p>

          {error && (
            <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 p-3 rounded-xl text-xs font-semibold">
              {error}
            </div>
          )}

          {/* قائمة البنود القابلة للإرجاع */}
          <div className="space-y-2 max-h-60 overflow-y-auto divide-y divide-slate-800">
            {sale.items.map((item) => {
              if (!item.product_id) return null;
              const retVal = quantities[item.product_id] ?? '';

              return (
                <div key={item.id} className="pt-2 pb-2 flex items-center justify-between gap-3 text-xs">
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-slate-100 truncate">{item.product_name_snapshot}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {ar.purchasedQtyPrice(item.quantity, formatCurrencyDisplay(item.unit_price_snapshot, currencySymbol, numberFormat))}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <label className="text-[11px] text-slate-400 shrink-0">{ar.returnLabel}</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={retVal}
                      onChange={(e) => handleQuantityChange(item.product_id!, e.target.value, item.quantity)}
                      placeholder="0"
                      className="w-16 bg-slate-950 border border-slate-700 rounded-lg p-1.5 text-center text-white font-bold text-xs outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              {ar.returnReason} *
            </label>
            <input
              type="text"
              required
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setError(null);
              }}
              placeholder={ar.returnReasonExample}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-emerald-500 text-right"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              type="submit"
              variant="primary"
              disabled={isSubmitting || !reason.trim()}
              className="flex-1 bg-amber-600 hover:bg-amber-500 text-white font-bold flex items-center justify-center gap-1.5"
            >
              <RotateCcw className="w-4 h-4" />
              <span>{isSubmitting ? ar.loading : ar.returnItems}</span>
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>
              {ar.cancel}
            </Button>
          </div>
        </form>
      </Modal>


    </>
  );
};
