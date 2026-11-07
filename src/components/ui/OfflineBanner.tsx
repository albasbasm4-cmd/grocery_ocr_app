import React, { useEffect, useState, useCallback } from 'react';
import { Wifi, WifiOff, RefreshCw, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import {
  getOutboxStats,
  processOutbox,
  syncLocalData,
  subscribeToSyncChanges,
} from '../../services/offlineSyncService';
import { NeedsReviewModal } from '../pos/NeedsReviewModal';

export const OfflineBanner: React.FC = () => {
  const { store } = useAuth();
  const [online, setOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState<boolean>(false);
  const [stats, setStats] = useState<{
    pendingCount: number;
    syncingCount: number;
    needsReviewCount: number;
    syncedCount: number;
    lastSuccessfulSync: string | null;
  }>({
    pendingCount: 0,
    syncingCount: 0,
    needsReviewCount: 0,
    syncedCount: 0,
    lastSuccessfulSync: null,
  });

  const refreshStats = useCallback(async () => {
    if (!store?.id) return;
    try {
      const s = await getOutboxStats(store.id);
      setStats(s);
    } catch {
      // ignore
    }
  }, [store?.id]);

  const handleSyncNow = useCallback(async () => {
    if (!store?.id || !navigator.onLine || isSyncing) return;
    setIsSyncing(true);
    try {
      await syncLocalData(store.id);
      await processOutbox(store.id);
      await refreshStats();
    } finally {
      setIsSyncing(false);
    }
  }, [store?.id, isSyncing, refreshStats]);

  useEffect(() => {
    void refreshStats();

    const unsubscribe = subscribeToSyncChanges(() => {
      void refreshStats();
    });

    const handleOnline = () => {
      setOnline(true);
      if (store?.id) {
        // مزامنة تلقائية فور عودة الاتصال
        void handleSyncNow();
      }
    };

    const handleOffline = () => {
      setOnline(false);
      void refreshStats();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // فحص دوري خفيف كل دقيقة
    const interval = setInterval(() => {
      void refreshStats();
    }, 60000);

    return () => {
      unsubscribe();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, [store?.id, handleSyncNow, refreshStats]);

  // تنسيق وقت آخر مزامنة
  const formatLastSync = (isoString: string | null) => {
    if (!isoString) return 'لم تتم بعد';
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return 'غير متوفر';
    }
  };

  return (
    <>
      <div
        className={`w-full px-3 py-1.5 text-xs border-b transition-colors flex flex-wrap items-center justify-between gap-2 z-40 ${
          !online
            ? 'bg-amber-500/15 border-amber-500/30 text-amber-200'
            : 'bg-slate-900/95 border-slate-800 text-slate-300'
        }`}
        dir="rtl"
      >
        {/* حالة الاتصال وتوقيت آخر مزامنة */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="flex items-center gap-1.5 font-medium">
            {online ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span className="text-emerald-400 font-bold flex items-center gap-1">
                  <Wifi className="w-3.5 h-3.5 inline" /> متصل
                </span>
              </>
            ) : (
              <>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                <span className="text-amber-400 font-bold flex items-center gap-1">
                  <WifiOff className="w-3.5 h-3.5 inline" /> غير متصل
                </span>
              </>
            )}
          </div>

          <span className="text-slate-500">|</span>

          <span className="text-[11px] text-slate-400">
            آخر مزامنة: {formatLastSync(stats.lastSuccessfulSync)}
          </span>

          {/* عدّاد الفواتير بانتظار المزامنة */}
          {(stats.pendingCount > 0 || stats.syncingCount > 0) && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse">
              ⏳ {stats.pendingCount + stats.syncingCount} بانتظار المزامنة
            </span>
          )}

          {/* تنبيه الفواتير التي تحتاج مراجعة تعارض مخزون */}
          {stats.needsReviewCount > 0 && (
            <button
              onClick={() => setIsReviewModalOpen(true)}
              className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-destructive/20 text-destructive-foreground border border-destructive/40 hover:bg-destructive/30 transition-all cursor-pointer"
            >
              <AlertTriangle className="w-3 h-3 text-red-400 inline" />
              <span>{stats.needsReviewCount} تحتاج مراجعة</span>
            </button>
          )}
        </div>

        {/* زر مزامنة الآن */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => void handleSyncNow()}
            disabled={!online || isSyncing || !store?.id}
            className={`px-2.5 py-1 rounded-md text-[11px] font-bold flex items-center gap-1.5 transition-all active:scale-95 ${
              online
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed'
            }`}
            title="مزامنة المنتجات وطابور المبيعات الآن"
          >
            <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>{isSyncing ? 'جاري المزامنة...' : 'مزامنة الآن'}</span>
          </button>
        </div>
      </div>

      {/* نافذة تفاصيل الفواتير المحتاجة لمراجعة */}
      {store?.id && (
        <NeedsReviewModal
          isOpen={isReviewModalOpen}
          onClose={() => {
            setIsReviewModalOpen(false);
            void refreshStats();
          }}
          storeId={store.id}
          currencySymbol={store.currency_symbol || 'ر.س'}
        />
      )}
    </>
  );
};
