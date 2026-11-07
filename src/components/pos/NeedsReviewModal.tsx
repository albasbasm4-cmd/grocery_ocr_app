import { useState, useEffect, useCallback } from 'react';
import { offlineDb, type OutboxSale } from '../../lib/offlineDb';
import { retryNeedsReviewSale, dismissNeedsReviewSale } from '../../services/offlineSyncService';
import { Button } from '../ui/Button';

interface NeedsReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  storeId: string;
  currencySymbol: string;
}

export function NeedsReviewModal({ isOpen, onClose, storeId, currencySymbol }: NeedsReviewModalProps) {
  const [sales, setSales] = useState<OutboxSale[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  const loadSales = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    try {
      const items = await offlineDb.outbox_sales
        .where('store_id')
        .equals(storeId)
        .and((s) => s.status === 'needs_review')
        .reverse()
        .sortBy('created_at');
      setSales(items);
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    if (isOpen) {
      void loadSales();
    }
  }, [isOpen, loadSales]);

  if (!isOpen) return null;

  const handleRetry = async (clientUuid: string) => {
    setActionInProgress(clientUuid);
    try {
      await retryNeedsReviewSale(clientUuid, storeId);
      await loadSales();
    } finally {
      setActionInProgress(null);
    }
  };

  const handleDismiss = async (clientUuid: string) => {
    if (!window.confirm('هل أنت متأكد من استبعاد هذه الفاتورة المتعادضة؟ لن يتم إرسالها إلى الخادم.')) {
      return;
    }
    setActionInProgress(clientUuid);
    try {
      await dismissNeedsReviewSale(clientUuid, 'تم الاستبعاد يدوياً بواسطة المالك');
      await loadSales();
    } finally {
      setActionInProgress(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" dir="rtl">
      <div className="bg-card w-full max-w-2xl rounded-2xl shadow-2xl border border-border flex flex-col max-h-[85vh] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-border flex items-center justify-between bg-amber-500/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center text-xl font-bold">
              ⚠️
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground">فواتير تحتاج مراجعة يدوية (تعارض مخزون)</h2>
              <p className="text-xs text-muted-foreground">
                هذه العمليات تمت دون اتصال ورُفضت لاحقاً من الخادم بسبب نفاد كمية المخزون (بيع من جهاز آخر).
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground p-1 rounded-lg text-lg transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Content list */}
        <div className="p-4 overflow-y-auto space-y-4 flex-1">
          {loading ? (
            <div className="py-12 text-center text-muted-foreground">جاري تحميل الفواتير...</div>
          ) : sales.length === 0 ? (
            <div className="py-12 text-center space-y-2">
              <span className="text-4xl">🎉</span>
              <p className="text-base font-semibold text-foreground">لا توجد أي فواتير متعارضة تحتاج مراجعة!</p>
              <p className="text-xs text-muted-foreground">جميع الفواتير تمت مزامنتها بنجاح مع الخادم.</p>
            </div>
          ) : (
            sales.map((sale) => (
              <div
                key={sale.client_uuid}
                className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/5 space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold bg-muted px-2 py-0.5 rounded text-foreground">
                        #{sale.client_uuid.slice(0, 8)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(sale.created_at).toLocaleString('ar-SA')}
                      </span>
                      {sale.customer_name && (
                        <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">
                          العميل: {sale.customer_name}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-sm font-bold text-foreground">
                      المبلغ الإجمالي: {sale.total_amount} {currencySymbol}
                      <span className="text-xs font-normal text-muted-foreground mr-2">
                        ({sale.payment_method === 'cash' ? 'نقدي' : 'آجل'})
                      </span>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="inline-block px-2.5 py-1 text-xs font-bold rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400">
                      تعارض مخزون
                    </span>
                  </div>
                </div>

                {/* Error details */}
                <div className="text-xs p-2.5 rounded bg-background border border-border text-destructive space-y-1">
                  <div className="font-semibold">سبب الرفض:</div>
                  <div className="text-muted-foreground leading-relaxed">
                    {sale.error_details || sale.last_error || 'كمية غير كافية على الخادم.'}
                  </div>
                </div>

                {/* Items */}
                <div className="text-xs space-y-1 bg-muted/30 p-2 rounded border border-border/50">
                  <div className="font-semibold text-muted-foreground">أصناف الفاتورة:</div>
                  <ul className="list-disc list-inside space-y-0.5 text-foreground">
                    {sale.items.map((it, idx) => (
                      <li key={idx}>
                        {it.product_name_snapshot || it.product_id} × {it.quantity}
                        {it.unit_price_snapshot && ` (سعر الوحدة: ${it.unit_price_snapshot} ${currencySymbol})`}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Action buttons */}
                <div className="flex items-center justify-end gap-2 pt-1 border-t border-border/50">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={actionInProgress === sale.client_uuid}
                    onClick={() => handleDismiss(sale.client_uuid)}
                    className="text-xs text-destructive hover:bg-destructive/10"
                  >
                    استبعاد الفاتورة
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={actionInProgress === sale.client_uuid}
                    onClick={() => handleRetry(sale.client_uuid)}
                    className="text-xs bg-amber-600 hover:bg-amber-700 text-white"
                  >
                    {actionInProgress === sale.client_uuid ? 'جاري الإرسال...' : 'إعادة المحاولة الآن'}
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border bg-muted/20 flex justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>
            إغلاق
          </Button>
        </div>
      </div>
    </div>
  );
}
