import React, { useState } from 'react';
import { CheckCircle2, Share2, PlusCircle } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { ar } from '../../i18n/ar';
import { formatCurrencyDisplay } from '../../lib/numbers';
import { shareOrPrintReceipt } from '../../services/receiptService';
import type { PrintableReceipt } from '../../types';

interface SaleSuccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  receipt: PrintableReceipt | null;
  numberFormat: 'latin' | 'arabic';
}

export const SaleSuccessModal: React.FC<SaleSuccessModalProps> = ({
  isOpen,
  onClose,
  receipt,
  numberFormat,
}) => {
  const [sharing, setSharing] = useState(false);

  if (!receipt) return null;

  const handleShareOrPrint = async () => {
    try {
      setSharing(true);
      await shareOrPrintReceipt(receipt);
    } catch (err) {
      console.error('Error sharing receipt:', err);
    } finally {
      setSharing(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={ar.saleSuccessTitle}>
      <div className="text-center space-y-4 py-2">
        <div className="w-16 h-16 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mx-auto animate-in zoom-in-50 duration-300">
          <CheckCircle2 className="w-10 h-10" />
        </div>

        <div>
          <h3 className="text-lg font-bold text-white">{ar.saleSuccessDesc}</h3>
          <p className="text-xs text-slate-400 mt-1">
            {ar.invoiceNumberPrefix(receipt.saleId.slice(0, 8).toUpperCase())}
          </p>
        </div>

        {/* ملخص المبالغ والبنود */}
        <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 text-right space-y-2 text-xs">
          <div className="flex justify-between text-slate-400">
            <span>{ar.itemsNumberCount}</span>
            <span className="font-bold text-slate-200">{ar.itemsCount(receipt.items.length)}</span>
          </div>
          <div className="flex justify-between text-slate-400">
            <span>{ar.paymentMethod}:</span>
            <span className="font-bold text-slate-200">
              {receipt.paymentMethod === 'cash' ? ar.paymentCash : ar.paymentCredit}
            </span>
          </div>
          {receipt.customerName && (
            <div className="flex justify-between text-slate-400">
              <span>{ar.customerLabel}</span>
              <span className="font-bold text-amber-300">{receipt.customerName}</span>
            </div>
          )}
          {Number(receipt.discountAmount) > 0 && (
            <div className="flex justify-between text-rose-400">
              <span>{ar.discount}:</span>
              <span className="font-bold">
                -{formatCurrencyDisplay(receipt.discountAmount, receipt.currencySymbol, numberFormat)}
              </span>
            </div>
          )}
          <div className="pt-2 border-t border-slate-800 flex justify-between items-center text-sm">
            <span className="font-bold text-slate-300">{ar.totalReceived}</span>
            <span className="font-extrabold text-emerald-400 text-lg">
              {formatCurrencyDisplay(receipt.totalAmount, receipt.currencySymbol, numberFormat)}
            </span>
          </div>
        </div>

        {/* أزرار الإجراءات */}
        <div className="space-y-2 pt-2">
          <Button
            type="button"
            variant="primary"
            onClick={handleShareOrPrint}
            disabled={sharing}
            className="w-full flex items-center justify-center gap-2 py-3"
          >
            {sharing ? (
              <span>{ar.processing}</span>
            ) : (
              <>
                <Share2 className="w-4 h-4" />
                <span>{ar.shareReceipt} / {ar.printReceipt}</span>
              </>
            )}
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            className="w-full flex items-center justify-center gap-2"
          >
            <PlusCircle className="w-4 h-4" />
            <span>{ar.newSale}</span>
          </Button>
        </div>
      </div>
    </Modal>
  );
};
