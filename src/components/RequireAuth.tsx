import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import type { StoreRole } from '../contexts/AuthContext';
import { ar } from '../i18n/ar';
import UnauthorizedPage from '../pages/UnauthorizedPage';
import { isSupabaseConfigured } from '../lib/supabase';

export function RequireAuth({ roles }: { roles?: StoreRole[] }) {
  const { user, store, loading } = useAuth();
  if (!isSupabaseConfigured) return <main className="grid min-h-screen place-items-center p-6 text-center"><p>{ar.supabaseMissing}</p></main>;
  if (loading) return <main className="grid min-h-screen place-items-center">{ar.loading}</main>;
  if (!user) return <Navigate to="/login" replace />;
  if (!store) return <Navigate to="/setup" replace />;
  const { role } = useAuth();
  if (roles && (!role || !roles.includes(role))) return <UnauthorizedPage />;
  return <Outlet />;
}
