import Decimal from 'decimal.js';
import { useState, useEffect } from 'react';
import { ScanLine, ShoppingBasket, Trash2, Check } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../hooks/usePermissions';
import { useSettings } from '../contexts/SettingsContext';
import { useToast } from '../contexts/ToastContext';
import { useCart } from '../contexts/CartContext';
import { BarcodeScanner } from '../components/BarcodeScanner';
import { CartItemRow } from '../components/pos/CartItemRow';
import { DiscountSection } from '../components/pos/DiscountSection';
import { PaymentMethodSelector } from '../components/pos/PaymentMethodSelector';
import { PosProductSearch } from '../components/pos/PosProductSearch';
import { SaleSuccessModal } from '../components/pos/SaleSuccessModal';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { ar } from '../i18n/ar';
import { formatCurrencyDisplay } from '../lib/numbers';
import { processSale } from '../services/salesService';
import { recordOfflineSale, syncLocalData } from '../services/offlineSyncService';
import { isOnline } from '../lib/offlineGuard';
import { lookupProductsByCode } from '../services/barcodeLookupService';
import type { PrintableReceipt, Product, Sale } from '../types';

export default function PosPage() {
  const auth = useAuth();
  const { canSell } = usePermissions();
  const store = auth.store || auth.currentStore;
  const { numberFormat } = useSettings();
  const { showToast } = useToast();

  const {
    items,
    discountAmount,
    totalAmount,
    subtotal,
    paymentMethod,
    selectedCustomer,
    addItem,
    updateItemQuantity,
    removeItem,
    clearCart,
  } = useCart();

  const [scannerOpen, setScannerOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successReceipt, setSuccessReceipt] = useState<PrintableReceipt | null>(null);
  const [isSuccessModalOpen, setIsSuccessModalOpen] = useState(false);
  const [choices, setChoices] = useState<Product[]>([]);

  const currencySymbol = store?.currency_symbol || ar.defaultCurrencySymbol;

  // مزامنة البيانات المحلية عند فتح شاشة البيع إن توفر الاتصال
  useEffect(() => {
    if (store?.id && isOnline()) {
      void syncLocalData(store.id);
    }
  }, [store?.id]);

  const handleProductSelected = (product: Product) => {
    const res = addItem(product, '1');
    if (!res.success) {
      showToast(res.error || ar.stockInvalid, 'error');
    }
  };

  const handleBarcodeScanned = async (code: string) => {
    if (!store) return;
    try {
      const found = await lookupProductsByCode(store.id, code);
      if (!found.length) {
        showToast(ar.codeNotFound, 'error');
        return;
      }
      if (found.length === 1) {
        handleProductSelected(found[0]!);
      } else {
        setChoices(found);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : ar.genericError, 'error');
    }
  };

  const handleConfirmSale = async () => {
    if (!store) return;

    if (items.length === 0) {
      showToast(ar.cartEmptySaleError, 'error');
      return;
    }

    if (paymentMethod === 'credit' && !selectedCustomer) {
      showToast(ar.customerRequiredForCredit, 'error');
      return;
    }

    try {
      setIsSubmitting(true);

      const clientUuid =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

      const salePayload = {
        storeId: store.id,
        clientUuid,
        items: items.map((i) => ({
          product_id: i.product.id,
          quantity: new Decimal(i.quantity).toString(),
        })),
        discountAmount,
        paymentMethod,
        customerId: paymentMethod === 'credit' ? selectedCustomer?.id : null,
      };

      let confirmedSale: Sale;
      let isOffline = false;

      const offlineExtra = {
        customerName: selectedCustomer ? selectedCustomer.name : null,
        subtotal,
        totalAmount,
        itemsDetails: items.map((i) => ({
          product_id: i.product.id,
          product_name_snapshot: i.product.name,
          unit_price_snapshot: i.product.price,
        })),
      };

      if (!isOnline()) {
        const offlineResult = await recordOfflineSale(salePayload, offlineExtra);
        confirmedSale = offlineResult.sale;
        isOffline = true;
      } else {
        try {
          const result = await processSale(salePayload);
          confirmedSale = result.sale;
        } catch (onlineErr: unknown) {
          const msg = onlineErr instanceof Error ? onlineErr.message : String(onlineErr);
          const isNetworkError =
            !navigator.onLine || /fetch|network|offline|failed to fetch/i.test(msg);

          if (isNetworkError) {
            const offlineResult = await recordOfflineSale(salePayload, offlineExtra);
            confirmedSale = offlineResult.sale;
            isOffline = true;
          } else {
            throw onlineErr;
          }
        }
      }

      // إعداد بيانات الإيصال الجاهز للطباعة والمشاركة
      const receiptData: PrintableReceipt = {
        storeName: store.name,
        currencySymbol,
        saleId: confirmedSale.id,
        createdAt: confirmedSale.created_at,
        paymentMethod: confirmedSale.payment_method,
        customerName: selectedCustomer ? selectedCustomer.name : null,
        items: items.map((i) => ({
          name: i.product.name,
          quantity: i.quantity,
          unitPrice: i.product.price,
          lineTotal: new Decimal(i.quantity).times(new Decimal(i.product.price)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2),
          unit: i.product.unit,
        })),
        subtotal,
        discountAmount,
        totalAmount,
      };

      // تفريغ السلة وفتح نافذة النجاح
      clearCart();
      setSuccessReceipt(receiptData);
      setIsSuccessModalOpen(true);
      if (isOffline) {
        showToast(ar.saleSavedOfflineInfo, 'info');
      } else {
        showToast(ar.saleSuccessDesc, 'success');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ar.saleFailedError;
      showToast(msg, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 pb-28 max-w-3xl mx-auto" dir="rtl">
      {/* الترويسة وأزرار الإجراءات السريعة */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-white">{ar.posTitle}</h1>
          <p className="text-xs text-slate-400 mt-0.5">{ar.scanToAdd}</p>
        </div>

        <div className="flex items-center gap-2">
          {items.length > 0 && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm(ar.clearCartConfirm)) {
                  clearCart();
                  showToast(ar.cartCleared, 'info');
                }
              }}
              className="p-2 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-xl transition"
              title={ar.clearCart}
            >
              <Trash2 className="w-5 h-5" />
            </button>
          )}

          <Button
            variant="primary"
            onClick={() => setScannerOpen(true)}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-2.5 rounded-xl shadow-lg shadow-emerald-950/40"
          >
            <ScanLine className="w-4 h-4" />
            <span>{ar.scanProduct}</span>
          </Button>
        </div>
      </div>

      {/* البحث الحي السريع للإضافة المباشرة */}
      <PosProductSearch
        onSelectProduct={handleProductSelected}
        currencySymbol={currencySymbol}
        numberFormat={numberFormat}
      />

      {/* خيارات مطابقة الباركود المتعددة إن وجدت */}
      {choices.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2">
          <p className="font-bold text-white text-sm">{ar.chooseProduct}</p>
          <div className="space-y-1.5">
            {choices.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  handleProductSelected(p);
                  setChoices([]);
                }}
                className="w-full text-right p-3 bg-slate-800/80 hover:bg-slate-800 rounded-xl flex items-center justify-between transition"
              >
                <span className="font-bold text-white text-sm">{p.name}</span>
                <span className="text-xs font-bold text-emerald-400">
                  {formatCurrencyDisplay(p.price, currencySymbol, numberFormat)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* محتويات السلة أو الحالة الفارغة */}
      {items.length === 0 ? (
        <div className="py-8 bg-slate-900/40 border border-dashed border-slate-800 rounded-3xl">
          <EmptyState
            icon={<ShoppingBasket className="w-12 h-12 text-slate-500" />}
            title={ar.cartEmpty}
            description={ar.cartEmptyDesc}
          />
        </div>
      ) : (
        <div className="space-y-3">
          {/* قائمة البنود */}
          <div className="space-y-2.5">
            {items.map((item) => (
              <CartItemRow
                key={item.product.id}
                item={item}
                currencySymbol={currencySymbol}
                numberFormat={numberFormat}
                onUpdateQuantity={(qty) => {
                  const res = updateItemQuantity(item.product.id, qty);
                  if (!res.success) {
                    showToast(res.error || ar.stockInvalid, 'error');
                  }
                }}
                onRemove={() => removeItem(item.product.id)}
              />
            ))}
          </div>

          {/* الخصم على الفاتورة */}
          <DiscountSection currencySymbol={currencySymbol} numberFormat={numberFormat} />

          {/* طريقة الدفع والعميل للآجل */}
          <PaymentMethodSelector currencySymbol={currencySymbol} numberFormat={numberFormat} />
        </div>
      )}

      {/* شريط الإجمالي وتأكيد البيع الثابت أسفل الشاشة عند وجود بنود */}
      {items.length > 0 && (
        <div className="fixed bottom-16 left-0 right-0 z-30 p-4 bg-slate-950/95 backdrop-blur-md border-t border-slate-800">
          <div className="max-w-3xl mx-auto flex items-center justify-between gap-4">
            <div>
              <span className="text-xs text-slate-400 block">{ar.finalTotal}</span>
              <span className="text-2xl font-black text-emerald-400">
                {formatCurrencyDisplay(totalAmount, currencySymbol, numberFormat)}
              </span>
            </div>

            {!canSell ? (
              <div className="flex-1 max-w-xs rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-center text-xs font-bold text-amber-300">
                {ar.cannotSellWarning}
              </div>
            ) : (
              <Button
                type="button"
                variant="primary"
                disabled={isSubmitting || (paymentMethod === 'credit' && !selectedCustomer)}
                onClick={handleConfirmSale}
                className="flex-1 max-w-xs py-3.5 text-base font-black bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-2xl shadow-xl shadow-emerald-950/50 flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <span>{ar.completingSale}</span>
                ) : (
                  <>
                    <Check className="w-5 h-5" />
                    <span>{ar.confirmSale}</span>
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* ماسح الباركود بالكاميرا */}
      <BarcodeScanner
        isOpen={scannerOpen}
        storeId={store?.id || ''}
        onClose={() => setScannerOpen(false)}
        onCode={(code) => {
          void handleBarcodeScanned(code);
        }}
        onProduct={(product) => handleProductSelected(product)}
      />

      {/* نافذة نجاح الفاتورة والمشاركة */}
      <SaleSuccessModal
        isOpen={isSuccessModalOpen}
        onClose={() => setIsSuccessModalOpen(false)}
        receipt={successReceipt}
        numberFormat={numberFormat}
      />
    </div>
  );
}
