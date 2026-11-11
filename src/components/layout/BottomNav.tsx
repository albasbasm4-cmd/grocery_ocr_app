import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { NavLink, useLocation } from 'react-router-dom';
import { Home, Package, ShoppingCart, BarChart3, Settings } from 'lucide-react';
import { ar } from '../../i18n/ar';

export const BottomNav: React.FC = () => {
  const { store, role } = useAuth();
  const location = useLocation();
  const { data: pendingRequestsCount = 0 } = useQuery({
    queryKey: ['nav-pending-requests', store?.id],
    queryFn: async () => {
      if (!store?.id || role !== 'owner') return 0;
      const { data, error } = await supabase.rpc('get_store_join_requests', { p_store_id: store.id });
      if (error) return 0;
      const list = (data as Array<{ status: string }>) || [];
      return list.filter((r) => r.status === 'pending').length;
    },
    enabled: Boolean(store?.id && role === 'owner'),
    staleTime: 60_000,
  });

  const { data: lowStockCount = 0 } = useQuery({
    queryKey: ['nav-low-stock', store?.id],
    queryFn: async () => {
      if (!store?.id) return 0;
      const { data, error } = await supabase.rpc('get_store_alert_counts', { p_store_id: store.id, p_expiry_days: 30 });
      if (error) throw error;
      return Number((data as { low_stock_count?: number } | null)?.low_stock_count ?? 0);
    },
    enabled: Boolean(store?.id),
    staleTime: 60_000,
  });

  // إخفاء شريط التنقل السفلي في شاشات تسجيل الدخول والتهيئة
  if (['/login', '/setup', '/reset-password', '/unauthorized'].includes(location.pathname)) {
    return null;
  }

  return (
    <nav
      dir="rtl"
      className="fixed bottom-0 left-0 right-0 z-40 bg-slate-900/95 backdrop-blur-lg border-t border-slate-800 shadow-2xl safe-area-pb"
    >
      <div className="max-w-xl mx-auto flex items-center justify-around px-2 py-1 relative">
        {/* 1. الرئيسية */}
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            `flex flex-col items-center justify-center min-w-[56px] py-2 transition-colors ${
              isActive ? 'text-emerald-400 font-bold' : 'text-slate-400 hover:text-slate-200'
            }`
          }
        >
          <Home className="w-5 h-5 mb-1" />
          <span className="text-[11px] leading-none">{ar.navHome}</span>
        </NavLink>

        {/* 2. المنتجات */}
        <NavLink
          to="/products"
          className={({ isActive }) =>
            `flex flex-col items-center justify-center min-w-[56px] py-2 transition-colors ${
              isActive ? 'text-emerald-400 font-bold' : 'text-slate-400 hover:text-slate-200'
            }`
          }
        >
          <Package className="w-5 h-5 mb-1" />
          <span className="text-[11px] leading-none">{ar.navProducts}</span>
        </NavLink>

        {/* 3. البيع (زر بارز في الوسط) */}
        <NavLink
          to="/pos"
          className="relative -top-5 flex flex-col items-center justify-center group focus:outline-none"
          aria-label={ar.navPos}
        >
          <div className="w-14 h-14 rounded-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 flex items-center justify-center shadow-lg shadow-emerald-500/40 border-4 border-slate-900 group-active:scale-95 transition-all">
            <ShoppingCart className="w-7 h-7" />
          </div>
          <span className="text-[11px] font-bold text-emerald-400 mt-0.5 leading-none">{ar.navPos}</span>
        </NavLink>

        {/* 4. التقارير */}
        <NavLink
            to="/reports"
            className={({ isActive }) =>
              `flex flex-col items-center justify-center min-w-[56px] py-2 transition-colors ${
                isActive ? 'text-emerald-400 font-bold' : 'text-slate-400 hover:text-slate-200'
              }`
            }
          >
            <span className="relative"><BarChart3 className="w-5 h-5 mb-1" />{lowStockCount > 0 && <span className="absolute -left-2 -top-1 min-w-4 rounded-full bg-amber-400 px-1 text-center text-[9px] font-black text-slate-950">{lowStockCount > 99 ? '99+' : lowStockCount}</span>}</span>
            <span className="text-[11px] leading-none">{ar.navReports}</span>
          </NavLink>

        {/* 5. المزيد / الإعدادات */}
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `flex flex-col items-center justify-center min-w-[56px] py-2 transition-colors ${
              isActive ? 'text-emerald-400 font-bold' : 'text-slate-400 hover:text-slate-200'
            }`
          }
        >
          <span className="relative">
            <Settings className="w-5 h-5 mb-1" />
            {pendingRequestsCount > 0 && (
              <span className="absolute -left-2 -top-1 min-w-4 rounded-full bg-emerald-400 px-1 text-center text-[9px] font-black text-slate-950">
                {pendingRequestsCount > 99 ? '99+' : pendingRequestsCount}
              </span>
            )}
          </span>
          <span className="text-[11px] leading-none">{ar.navSettings}</span>
        </NavLink>
      </div>
    </nav>
  );
};
