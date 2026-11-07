import React, { useState } from 'react';
import { Share2, Trash2, RotateCcw } from 'lucide-react';
import Decimal from 'decimal.js';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { VoidSaleModal } from './VoidSaleModal';
import { ReturnItemsModal } from './ReturnItemsModal';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { ar } from '../../i18n/ar';
import { formatCurrencyDisplay } from '../../lib/numbers';
import { shareOrPrintReceipt } from '../../services/receiptService';
import type { SaleWithDetails } from '../../services/salesService';
import type { PrintableReceipt } from '../../types';

interface SaleDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  sale: SaleWithDetails | null;
  currencySymbol: string;
  numberFormat: 'latin' | 'arabic';
  onUpdated: () => void;
}

export const SaleDetailsModal: React.FC<SaleDetailsModalProps> = ({
  isOpen,
  onClose,
  sale,
  currencySymbol,
  numberFormat,
  onUpdated,
}) => {
  const { isOwner } = useAuth();
  const { showToast } = useToast();

  const [isVoidModalOpen, setIsVoidModalOpen] = useState(false);
  const [isReturnModalOpen, setIsReturnModalOpen] = useState(false);
  const [sharing, setSharing] = useState(false);

  if (!sale) return null;

  const isCompleted = sale.status === 'completed';

  const handleShareReceipt = async () => {
    try {
      setSharing(true);
      const receipt: PrintableReceipt = {
        storeName: ar.groceryStoreFallback,
        currencySymbol,
        saleId: sale.id,
        createdAt: sale.created_at,
        paymentMethod: sale.payment_method,
        customerName: sale.customer?.name || null,
        items: sale.items.map((i) => ({
          name: i.product_name_snapshot,
          quantity: i.quantity,
          unitPrice: i.unit_price_snapshot,
          lineTotal: i.line_total,
        })),
        subtotal: sale.subtotal,
        discountAmount: sale.discount_amount,
        totalAmount: sale.total_amount,
      };
      await shareOrPrintReceipt(receipt);
    } catch (err) {
      console.error(err);
    } finally {
      setSharing(false);
    }
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={ar.invoiceDetailsTitle(sale.id.slice(0, 8).toUpperCase())}
        maxWidth="lg"
      >
        <div className="space-y-4 text-xs">
          {/* شريط معلومات الفاتورة والحالة */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-slate-950 p-3 rounded-2xl border border-slate-800">
            <div>
              <span className="text-[11px] text-slate-400 block mb-0.5">{ar.status}</span>
              <span
                className={`inline-block px-2 py-0.5 rounded-full font-bold text-[11px] ${
                  isCompleted
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                }`}
              >
                {isCompleted ? ar.statusCompleted : ar.statusVoided}
              </span>
            </div>

            <div>
              <span className="text-[11px] text-slate-400 block mb-0.5">{ar.paymentMethod}</span>
              <span className="font-bold text-slate-200">
                {sale.payment_method === 'cash' ? ar.paymentCash : ar.paymentCredit}
              </span>
            </div>

            <div>
              <span className="text-[11px] text-slate-400 block mb-0.5">{ar.date}</span>
              <span className="font-medium text-slate-300">
                {new Date(sale.created_at).toLocaleDateString('ar-SA')}
              </span>
            </div>

            <div>
              <span className="text-[11px] text-slate-400 block mb-0.5">{ar.customerLabel.replace(":", "")}</span>
              <span className="font-bold text-amber-300 truncate block">
                {sale.customer ? sale.customer.name : ar.cashCustomer}
              </span>
            </div>
          </div>

          {/* جدول بنود الفاتورة */}
          <div>
            <h4 className="font-bold text-slate-200 text-sm mb-2">{ar.saleItems}</h4>
            <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden divide-y divide-slate-800/80">
              <div className="grid grid-cols-12 p-2.5 font-bold text-slate-400 bg-slate-900/60 text-[11px]">
                <div className={isOwner ? 'col-span-4' : 'col-span-6'}>{ar.productLabel}</div>
                <div className="col-span-2 text-center">{ar.quantity}</div>
                <div className="col-span-2 text-left">{ar.price}</div>
                {isOwner && <div className="col-span-2 text-left text-slate-400">{ar.costLabel}</div>}
                <div className="col-span-2 text-left">{ar.total}</div>
              </div>

              {sale.items.map((item) => {
                const lineProfit = isOwner
                  ? (() => {
                      try {
                        const price = new Decimal(item.unit_price_snapshot || '0');
                        const cost = new Decimal(item.cost_price_snapshot || '0');
                        const qty = new Decimal(item.quantity || '0');
                        return price.minus(cost).times(qty).toFixed(2);
                      } catch {
                        return null;
                      }
                    })()
                  : null;

                return (
                  <div key={item.id} className="grid grid-cols-12 p-2.5 items-center text-slate-200">
                    <div className={`${isOwner ? 'col-span-4' : 'col-span-6'} font-medium truncate`}>
                      {item.product_name_snapshot}
                    </div>
                    <div className="col-span-2 text-center text-slate-300 font-bold">
                      {item.quantity}
                    </div>
                    <div className="col-span-2 text-left">
                      {formatCurrencyDisplay(item.unit_price_snapshot, currencySymbol, numberFormat)}
                    </div>
                    {isOwner && (
                      <div className="col-span-2 text-left text-slate-400 text-[11px]">
                        {item.cost_price_snapshot ? (
                          <>
                            <span>
                              {formatCurrencyDisplay(item.cost_price_snapshot, currencySymbol, numberFormat)}
                            </span>
                            {lineProfit && (
                              <span className="block text-[10px] text-emerald-400 font-semibold">
                                {ar.profitLabel}: {formatCurrencyDisplay(lineProfit, currencySymbol, numberFormat)}
                              </span>
                            )}
                          </>
                        ) : (
                          '—'
                        )}
                      </div>
                    )}
                    <div className="col-span-2 text-left font-bold text-emerald-400">
                      {formatCurrencyDisplay(item.line_total, currencySymbol, numberFormat)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ملخص المبالغ */}
          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-3 space-y-1.5 text-xs">
            <div className="flex justify-between text-slate-400">
              <span>{ar.subtotal}:</span>
              <span>{formatCurrencyDisplay(sale.subtotal, currencySymbol, numberFormat)}</span>
            </div>
            {Number(sale.discount_amount) > 0 && (
              <div className="flex justify-between text-rose-400">
                <span>{ar.discount}:</span>
                <span>-{formatCurrencyDisplay(sale.discount_amount, currencySymbol, numberFormat)}</span>
              </div>
            )}
            <div className="pt-2 border-t border-slate-800 flex justify-between items-center text-sm">
              <span className="font-bold text-white">{ar.total}:</span>
              <span className="font-extrabold text-emerald-400 text-base">
                {formatCurrencyDisplay(sale.total_amount, currencySymbol, numberFormat)}
              </span>
            </div>
          </div>

          {/* أزرار العمليات */}
          <div className="pt-2 space-y-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleShareReceipt}
              disabled={sharing}
              className="w-full flex items-center justify-center gap-2 py-2.5"
            >
              <Share2 className="w-4 h-4" />
              <span>{ar.shareReceipt} / {ar.printReceipt}</span>
            </Button>

            {/* أزرار الإلغاء والإرجاع: للمالك فقط وعندما تكون الفاتورة مكتملة */}
            {isOwner && isCompleted && (
              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-800">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsReturnModalOpen(true)}
                  className="flex items-center justify-center gap-1.5 border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>{ar.returnItems}</span>
                </Button>

                <Button
                  type="button"
                  variant="danger"
                  onClick={() => setIsVoidModalOpen(true)}
                  className="flex items-center justify-center gap-1.5 bg-rose-600/20 text-rose-300 border border-rose-500/30 hover:bg-rose-600/30"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{ar.voidSale}</span>
                </Button>
              </div>
            )}
          </div>
        </div>
      </Modal>

      <VoidSaleModal
        isOpen={isVoidModalOpen}
        onClose={() => setIsVoidModalOpen(false)}
        sale={sale}
        onSuccess={() => {
          showToast(ar.voidSuccess, 'success');
          onUpdated();
          onClose();
        }}
      />

      <ReturnItemsModal
        isOpen={isReturnModalOpen}
        onClose={() => setIsReturnModalOpen(false)}
        sale={sale}
        currencySymbol={currencySymbol}
        numberFormat={numberFormat}
        onSuccess={(refund) => {
          showToast(ar.returnSuccessRefund(refund, currencySymbol), 'success');
          onUpdated();
          onClose();
        }}
      />
    </>
  );
};
