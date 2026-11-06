import React from 'react';
import { useToast, ToastType } from '../../contexts/ToastContext';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';

const icons: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />,
  error: <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />,
  warning: <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />,
  info: <Info className="w-5 h-5 text-sky-400 shrink-0" />,
};

const borderClasses: Record<ToastType, string> = {
  success: 'border-emerald-500/30 bg-slate-900/95 text-slate-100',
  error: 'border-rose-500/30 bg-slate-900/95 text-slate-100',
  warning: 'border-amber-500/30 bg-slate-900/95 text-slate-100',
  info: 'border-sky-500/30 bg-slate-900/95 text-slate-100',
};

export const ToastContainer: React.FC = () => {
  const { toasts, dismissToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div
      dir="rtl"
      className="fixed top-4 left-4 right-4 z-50 flex flex-col gap-2 pointer-events-none sm:left-auto sm:right-6 sm:w-96"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto flex items-start gap-3 p-3.5 rounded-2xl border shadow-xl backdrop-blur-md transition-all duration-300 animate-in fade-in slide-in-from-top-2 ${borderClasses[toast.type]}`}
          role="alert"
        >
          {icons[toast.type]}
          <div className="flex-1 text-sm">
            {toast.title && <p className="font-bold mb-0.5">{toast.title}</p>}
            <p className="text-slate-300 leading-snug">{toast.message}</p>
          </div>
          <button
            onClick={() => dismissToast(toast.id)}
            className="text-slate-400 hover:text-white p-1 rounded-lg transition"
            aria-label="إغلاق الإشعار"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
};
