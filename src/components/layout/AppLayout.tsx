import React, { useEffect, useState } from 'react';
import { Outlet, Link } from 'react-router-dom';
import { BottomNav } from './BottomNav';
import { OfflineBanner } from '../ui/OfflineBanner';
import { useAuth } from '../../contexts/AuthContext';
import { useAndroidBackButton } from '../../hooks/useAndroidBackButton';
import { ar } from '../../i18n/ar';
import { Store, ShieldCheck, Clock, Bot } from 'lucide-react';

export const AppLayout: React.FC = () => {
  const { store, role, pinExpiresAt } = useAuth();
  const [now, setNow] = useState(Date.now());

  // تفعيل دعم زر الرجوع بهواتف أندرويد
  useAndroidBackButton();

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const remainingSeconds = pinExpiresAt
    ? Math.max(0, Math.ceil((new Date(pinExpiresAt).getTime() - now) / 1000))
    : 0;

  return (
    <div dir="rtl" className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* إعلان الاتصال بالإنترنت */}
      <OfflineBanner />

      {/* الشريط العلوي للهاتف */}
      <header className="sticky top-0 z-30 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 px-4 py-2.5">
        <div className="max-w-xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-xl bg-emerald-500/10 text-emerald-400">
              <Store className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base font-bold text-white leading-tight truncate max-w-[150px] sm:max-w-xs">
                {store?.name ?? ar.appName}
              </h1>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold ${
                    role === 'owner'
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : 'bg-sky-500/15 text-sky-300'
                  }`}
                >
                  <ShieldCheck className="w-3 h-3" />
                  {role === 'owner' ? ar.owner : ar.staff}
                </span>
                <span className="text-[10px] text-slate-400">
                  {store?.currency_symbol || 'ر.س'}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* رابط المساعد الذكي */}
            <Link
              to="/ai-chat"
              className="px-2.5 py-1.5 rounded-xl bg-slate-800/90 hover:bg-slate-750 text-emerald-400 border border-slate-700/60 transition active:scale-95 flex items-center gap-1.5 shadow-sm"
              title={ar.aiChatTitle}
            >
              <Bot className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-bold text-slate-200 hidden sm:inline">
                {ar.aiChatTitle}
              </span>
            </Link>

            {/* حالة جلسة PIN للمالك */}
            {role === 'owner' && remainingSeconds > 0 && (
              <div className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-emerald-950/80 border border-emerald-500/30 text-emerald-300 text-xs font-mono">
                <Clock className="w-3.5 h-3.5 animate-pulse text-emerald-400" />
                <span>
                  {Math.floor(remainingSeconds / 60)}:
                  {String(remainingSeconds % 60).padStart(2, '0')}
                </span>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* المحتوى الرئيسي */}
      <main className="flex-1 max-w-xl w-full mx-auto p-4 pb-28">
        <Outlet />
      </main>

      {/* شريط التنقل السفلي */}
      <BottomNav />
    </div>
  );
};
