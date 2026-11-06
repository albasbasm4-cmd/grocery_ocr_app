import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../hooks/usePermissions';
import { useSettings } from '../contexts/SettingsContext';
import { ar } from '../i18n/ar';
import { supabase } from '../lib/supabase';
import Decimal from 'decimal.js';
import { ErrorState } from '../components/ui/ErrorState';
import {
  TrendingUp,
  Receipt,
  AlertTriangle,
  CalendarClock,
  ShoppingCart,
  QrCode,
  PlusCircle,
  PackageOpen,
  BarChart3,
  ArrowRight,
} from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';

interface DailyStats {
  totalAmount: string;
  invoicesCount: number;
  lowStockCount: number;
  expiringCount: number;
}

export default function DashboardPage() {
  const { store } = useAuth();
  const { isOwner } = usePermissions();
  const { formatCurrency, formatNumber } = useSettings();
  const navigate = useNavigate();

  const [stats, setStats] = useState<DailyStats>({
    totalAmount: '0',
    invoicesCount: 0,
    lowStockCount: 0,
    expiringCount: 0,
  });
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string>('');

  useEffect(() => {
    if (!store?.id) return;
    let isMounted = true;

    async function loadStats() {
      try {
        setLoading(true);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayIso = today.toISOString();

        // 1. استعلام مبيعات اليوم
        const salesPromise = supabase
          .from('sales')
          .select('id, total_amount, status')
          .eq('store_id', store!.id)
          .gte('created_at', todayIso)
          .neq('status', 'voided');

        // 2. استعلام النواقص
        const lowStockPromise = supabase
          .from('view_low_stock')
          .select('id', { count: 'exact', head: true })
          .eq('store_id', store!.id);

        // 3. استعلام قرب الانتهاء
        const expiringPromise = supabase
          .from('view_expiring_soon')
          .select('id', { count: 'exact', head: true })
          .eq('store_id', store!.id);

        const [salesRes, lowStockRes, expiringRes] = await Promise.all([
          salesPromise,
          lowStockPromise,
          expiringPromise,
        ]);

        if (!isMounted) return;

        if (salesRes.error || lowStockRes.error || expiringRes.error) {
          setLoadError(ar.dashboardLoadError);
          return;
        }
        setLoadError('');
        let total = new Decimal(0);
        let count = 0;
        if (salesRes.data) {
          count = salesRes.data.length;
          total = salesRes.data.reduce((sum, sale) => sum.plus(String(sale.total_amount ?? 0)), new Decimal(0));
        }

        setStats({
          totalAmount: total.toFixed(2),
          invoicesCount: count,
          lowStockCount: lowStockRes.count ?? 0,
          expiringCount: expiringRes.count ?? 0,
        });
      } catch (err) {
        console.error('Failed to load dashboard stats:', err);
        if (isMounted) setLoadError(ar.dashboardLoadError);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    void loadStats();

    return () => {
      isMounted = false;
    };
  }, [store?.id]);

  const currencySymbol = store?.currency_symbol || 'ر.س';

  return (
    <div className="space-y-4">
      {loadError && <ErrorState message={loadError} onRetry={() => window.location.reload()} />}
      {/* بطاقة ملخص المبيعات الكبرى */}
      <Card className="bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950/40 border-emerald-500/20 shadow-lg">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <span className="text-xs text-slate-400">{ar.todayPerformance}</span>
              <h2 className="text-base font-bold text-white">{ar.todaySales}</h2>
            </div>
          </div>
          <span className="text-xs px-2.5 py-1 rounded-full bg-slate-800 text-slate-300">
            {new Date().toLocaleDateString('ar-SA', { weekday: 'short', day: 'numeric', month: 'short' })}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {/* إجمالي المبيعات (للمالك فقط) */}
          {isOwner && (
            <div className="col-span-2 sm:col-span-1 p-3 rounded-xl bg-slate-950/60 border border-slate-800">
              <p className="text-xs text-slate-400">{ar.todaySales}</p>
              <p className="text-xl sm:text-2xl font-black text-emerald-400 mt-1 truncate">
                {formatCurrency(stats.totalAmount, currencySymbol)}
              </p>
            </div>
          )}

          {/* عدد الفواتير */}
          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <Receipt className="w-3.5 h-3.5 text-sky-400" />
              <span>{ar.todayInvoices}</span>
            </div>
            <p className="text-xl sm:text-2xl font-black text-white mt-1">
              {formatNumber(stats.invoicesCount, { decimals: 0 })}
            </p>
          </div>

          {/* متوسط الفاتورة (للمالك فقط) */}
          {isOwner && (
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
              <p className="text-xs text-slate-400">{ar.todayAverage}</p>
              <p className="text-lg sm:text-xl font-bold text-slate-200 mt-1 truncate">
                {formatCurrency(
                  stats.invoicesCount > 0 ? new Decimal(stats.totalAmount).dividedBy(stats.invoicesCount).toFixed(2) : '0',
                  currencySymbol,
                  1
                )}
              </p>
            </div>
          )}
        </div>
      </Card>

      {/* تنبيهات المخزون والصلاحية */}
      <div className="grid grid-cols-2 gap-3">
        {/* النواقص */}
        <Link to="/products?filter=low_stock" className="block focus:outline-none group">
          <Card className="h-full border-amber-500/20 bg-amber-950/10 group-hover:border-amber-500/40 transition">
            <div className="flex items-center justify-between mb-2">
              <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <span className="text-xl font-black text-amber-300">
                {loading ? ar.loading : formatNumber(stats.lowStockCount, { decimals: 0 })}
              </span>
            </div>
            <h3 className="text-sm font-bold text-slate-100">{ar.lowStockAlert}</h3>
            <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">{ar.lowStockDesc}</p>
          </Card>
        </Link>

        {/* قرب انتهاء الصلاحية */}
        <Link to="/products?filter=expiring_soon" className="block focus:outline-none group">
          <Card className="h-full border-rose-500/20 bg-rose-950/10 group-hover:border-rose-500/40 transition">
            <div className="flex items-center justify-between mb-2">
              <div className="p-2 rounded-xl bg-rose-500/20 text-rose-400">
                <CalendarClock className="w-4 h-4" />
              </div>
              <span className="text-xl font-black text-rose-300">
                {loading ? ar.loading : formatNumber(stats.expiringCount, { decimals: 0 })}
              </span>
            </div>
            <h3 className="text-sm font-bold text-slate-100">{ar.expiringSoonAlert}</h3>
            <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">{ar.expiringSoonDesc}</p>
          </Card>
        </Link>
      </div>

      {/* زر البيع السريع الرئيسي البارز */}
      <Button
        onClick={() => navigate('/pos')}
        size="lg"
        variant="primary"
        className="w-full shadow-lg shadow-emerald-500/30 flex items-center justify-between px-6"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-slate-950/20">
            <ShoppingCart className="w-6 h-6" />
          </div>
          <div className="text-right">
            <p className="text-lg font-black leading-tight">{ar.startSale}</p>
            <p className="text-xs text-slate-950/80 font-medium">{ar.quickSaleDescription}</p>
          </div>
        </div>
        <ArrowRight className="w-6 h-6 rotate-180" />
      </Button>

      {/* بطاقة الاختصارات السريعة */}
      <Card>
        <h3 className="text-sm font-bold text-slate-300 mb-3">{ar.quickActions}</h3>
        <div className="grid grid-cols-2 gap-2.5">
          <Link
            to="/pos?scan=true"
            className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-slate-200 border border-slate-700/60 transition active:scale-[0.98]"
          >
            <div className="p-2 rounded-lg bg-sky-500/10 text-sky-400 shrink-0">
              <QrCode className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold leading-tight">{ar.scanBarcode}</span>
          </Link>

          {isOwner && (
            <Link
              to="/products?action=new"
              className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-slate-200 border border-slate-700/60 transition active:scale-[0.98]"
            >
              <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 shrink-0">
                <PlusCircle className="w-4 h-4" />
              </div>
              <span className="text-xs font-bold leading-tight">{ar.addProduct}</span>
            </Link>
          )}

          <Link
            to="/products?filter=low_stock"
            className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-slate-200 border border-slate-700/60 transition active:scale-[0.98]"
          >
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 shrink-0">
              <PackageOpen className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold leading-tight">{ar.checkLowStock}</span>
          </Link>

          {isOwner && (
            <Link
              to="/reports"
              className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-slate-200 border border-slate-700/60 transition active:scale-[0.98]"
            >
              <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400 shrink-0">
                <BarChart3 className="w-4 h-4" />
              </div>
              <span className="text-xs font-bold leading-tight">{ar.viewReports}</span>
            </Link>
          )}
        </div>
      </Card>
    </div>
  );
}
