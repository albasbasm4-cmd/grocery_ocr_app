import { useEffect, useState } from 'react';
import { ar } from '../../i18n/ar';
import { WifiOff, Wifi } from 'lucide-react';

export const OfflineBanner: React.FC = () => {
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [showRestored, setShowRestored] = useState<boolean>(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setShowRestored(true);
      window.setTimeout(() => setShowRestored(false), 3000);
    };

    const handleOffline = () => {
      setIsOnline(false);
      setShowRestored(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (showRestored) {
    return (
      <div className="bg-emerald-500 text-slate-950 px-4 py-2 text-xs font-bold flex items-center justify-center gap-2 shadow-sm transition-all duration-300">
        <Wifi className="w-4 h-4" />
        <span>{ar.onlineBanner}</span>
      </div>
    );
  }

  if (!isOnline) {
    return (
      <div className="bg-amber-500 text-slate-950 px-4 py-2 text-xs font-bold flex items-center justify-center gap-2 shadow-sm transition-all duration-300">
        <WifiOff className="w-4 h-4 animate-pulse" />
        <span>{ar.offlineBanner}</span>
      </div>
    );
  }

  return null;
};
