import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { RequireAuth } from './components/RequireAuth';
import { PinProtected } from './components/PinProtected';
import AuthPage from './pages/AuthPage';
import StoreSetupPage from './pages/StoreSetupPage';
import DashboardPage from './pages/DashboardPage';
import StaffManagementPage from './pages/StaffManagementPage';
import ChangePinPage from './pages/ChangePinPage';
import UnauthorizedPage from './pages/UnauthorizedPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import { ar } from './i18n/ar';
import { supabase } from './lib/supabase';
import { useEffect, useState } from 'react';

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
function AuthRoutes() { return <Routes>
  <Route path="/login" element={<AuthPage />} />
  <Route path="/reset-password" element={<ResetPasswordPage />} />
  <Route path="/setup" element={<SetupRoute />} />
  <Route path="/unauthorized" element={<UnauthorizedPage />} />
  <Route element={<RequireAuth />}>
    <Route path="/" element={<DashboardPage />} />
    <Route element={<PinProtected />}>
      <Route path="/staff" element={<StaffManagementPage />} />
      <Route path="/change-pin" element={<ChangePinPage />} />
    </Route>
  </Route>
  <Route path="*" element={<Navigate to="/" replace />} />
</Routes>; }
export default function App() { return <BrowserRouter><AuthProvider><AuthRoutes /></AuthProvider></BrowserRouter>; }
