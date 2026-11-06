import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { App as CapApp } from '@capacitor/app';
import { useToast } from '../contexts/ToastContext';
import { ar } from '../i18n/ar';

export function useAndroidBackButton() {
  const navigate = useNavigate();
  const location = useLocation();
  const { info } = useToast();
  const lastPressRef = useRef<number>(0);

  useEffect(() => {
    let handler: { remove: () => Promise<void> } | undefined;

    const setupListener = async () => {
      try {
        handler = await CapApp.addListener('backButton', ({ canGoBack }) => {
          const currentPath = location.pathname;

          // إذا كان المستخدم في الصفحة الرئيسية
          if (currentPath === '/' || currentPath === '/dashboard') {
            const now = Date.now();
            if (now - lastPressRef.current < 2000) {
              void CapApp.exitApp();
            } else {
              lastPressRef.current = now;
              info(ar.pressAgainToExit);
            }
            return;
          }

          // إذا كان في مسار فرعي ولديه سجل تراجع
          if (canGoBack || window.history.length > 1) {
            navigate(-1);
          } else {
            navigate('/', { replace: true });
          }
        });
      } catch {
        // ليس جهاز أندرويد عبر كاباسيتور
      }
    };

    void setupListener();

    return () => {
      if (handler) {
        void handler.remove();
      }
    };
  }, [location.pathname, navigate, info]);
}
