import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { CartProvider } from './contexts/CartContext';
import { RequireAuth } from './components/RequireAuth';
import { PinProtected } from './components/PinProtected';
import { AppLayout } from './components/layout/AppLayout';
import { ToastProvider } from './contexts/ToastContext';
import { ToastContainer } from './components/ui/Toast';
import { SettingsProvider } from './contexts/SettingsContext';
import AuthPage from './pages/AuthPage';
import StoreSetupPage from './pages/StoreSetupPage';
import DashboardPage from './pages/DashboardPage';
import StaffManagementPage from './pages/StaffManagementPage';
import ChangePinPage from './pages/ChangePinPage';
import UnauthorizedPage from './pages/UnauthorizedPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import SettingsPage from './pages/SettingsPage';
import ProductsPage from './pages/ProductsPage';
import PosPage from './pages/PosPage';
import CategoriesPage from './pages/CategoriesPage';
import SalesPage from './pages/SalesPage';
import ReportsPage from './pages/ReportsPage';
import CustomersPage from './pages/CustomersPage';
import AiChatPage from './pages/AiChatPage';
import JavaExportPage from './pages/JavaExportPage';
import { ar } from './i18n/ar';
import { supabase } from './lib/supabase';
import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePermissions } from './hooks/usePermissions';

function SetupRoute() {
  const { user, store, loading } = useAuth();
  if (loading) return <main className="grid min-h-screen place-items-center">{ar.loading}</main>;
  if (!user) return <Navigate to="/login" replace />;
  if (!store) return <StoreSetupPage />;
  return <ExistingStorePinSetup />;
}

function ExistingStorePinSetup() {
  const { store, role } = useAuth();
  const [status, setStatus] = useState<'checking' | 'missing' | 'ready'>('checking');
  useEffect(() => {
    if (!store || role !== 'owner') { setStatus('ready'); return; }
    let active = true;
    void supabase.rpc('is_admin_pin_set', { p_store_id: store.id }).then(({ data, error }) => {
      if (active) setStatus(!error && data === false ? 'missing' : 'ready');
    });
    return () => { active = false; };
  }, [store, role]);
  if (status === 'checking') return <main className="grid min-h-screen place-items-center">{ar.loading}</main>;
  if (status === 'missing') return <StoreSetupPage initialStep="pin" />;
  return <Navigate to="/" replace />;
}

function AuthRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<AuthPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/setup" element={<SetupRoute />} />
      <Route path="/unauthorized" element={<UnauthorizedPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/categories" element={<OwnerCategoriesRoute />} />
          <Route path="/pos" element={<PosPage />} />
          <Route path="/sales" element={<SalesPage />} />
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/ai-chat" element={<AiChatPage />} />
          <Route path="/java-export" element={<OwnerJavaExportRoute />} />
          <Route element={<PinProtected />}>
            <Route path="/staff" element={<StaffManagementPage />} />
            <Route path="/change-pin" element={<ChangePinPage />} />
          </Route>
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function OwnerCategoriesRoute() {
  const { isOwner } = usePermissions();
  if (!isOwner) return <Navigate to="/unauthorized" replace />;
  return <CategoriesPage />;
}

function OwnerJavaExportRoute() {
  const { isOwner } = usePermissions();
  if (!isOwner) return <Navigate to="/unauthorized" replace />;
  return <JavaExportPage />;
}

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <SettingsProvider>
          <BrowserRouter>
            <AuthProvider>
              <CartProvider>
                <AuthRoutes />
              </CartProvider>
            </AuthProvider>
          </BrowserRouter>
          <ToastContainer />
        </SettingsProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
