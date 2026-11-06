import { useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { PinGate } from './PinGate';

export function PinProtected() {
  const { role, pinExpiresAt } = useAuth();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const active = Boolean(pinExpiresAt && new Date(pinExpiresAt).getTime() > now);
  if (role !== 'owner') return <Navigate to="/unauthorized" replace />;
  if (!active) return <><PinGate open onClose={() => window.location.assign('/')} /></>;
  return <Outlet />;
}
