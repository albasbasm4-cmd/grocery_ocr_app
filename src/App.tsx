export default function App() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 text-center">
      <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-5">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-4xl shadow-inner">
          🛒
        </div>
        
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">نظام بقالة POS وإدارة المخزون</h1>
          <p className="text-xs text-slate-400 mt-1">تطبيق جوال فائق السرعة عبر Capacitor و React</p>
        </div>

        <div className="bg-slate-950/80 border border-slate-800/80 rounded-2xl p-4 text-right space-y-2.5 text-xs">
          <div className="flex items-center justify-between border-b border-slate-800/60 pb-2">
            <span className="text-slate-400">حالة المرحلة:</span>
            <span className="inline-flex items-center gap-1.5 text-emerald-400 font-semibold">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              المرحلة 0: الهيكل التأسيسي
            </span>
          </div>
          <div className="flex items-center justify-between border-b border-slate-800/60 pb-2">
            <span className="text-slate-400">واجهة المستخدم:</span>
            <span className="text-slate-200 font-mono">React 18 + Vite + TS + Tailwind</span>
          </div>
          <div className="flex items-center justify-between border-b border-slate-800/60 pb-2">
            <span className="text-slate-400">الاتجاه واللغة:</span>
            <span className="text-slate-200">عربي بالكامل (RTL)</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-400">القاعدة السحابية:</span>
            <span className="text-slate-200 font-mono">Supabase (PostgreSQL + RLS + RPC)</span>
          </div>
        </div>

        <p className="text-[11px] text-slate-400 leading-relaxed border-t border-slate-800/60 pt-3">
          تم توثيق كافة القرارات المعمارية في ملف <code className="text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded font-mono">docs/ARCHITECTURE.md</code> بانتظار توجيهات المرحلة 1.
        </p>
      </div>
    </div>
  );
}
