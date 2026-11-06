import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../hooks/usePermissions';
import { ar } from '../i18n/ar';
export default function DashboardPage() {
  const { store, role, user, signOut, pinExpiresAt } = useAuth();
  const { isOwner, isStaff } = usePermissions();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const remaining = pinExpiresAt ? Math.max(0, Math.ceil((new Date(pinExpiresAt).getTime() - now) / 1000)) : 0;
  return <main className="mx-auto max-w-3xl p-4 sm:p-8"><header className="flex items-start justify-between gap-4"><div><p className="text-sm text-emerald-300">{ar.appName}</p><h1 className="mt-1 text-2xl font-bold">{store?.name ?? ar.dashboard}</h1><p className="mt-2 text-sm text-slate-400">{user?.email} · {role === 'owner' ? ar.owner : ar.staff}</p></div><button onClick={() => void signOut()} className="button-secondary">{ar.signOut}</button></header>
    <section className="mt-8 grid gap-4 sm:grid-cols-2"><article className="rounded-2xl border border-slate-700 bg-slate-900 p-5"><h2 className="font-semibold">{ar.dashboard}</h2><p className="mt-2 text-sm text-slate-400">{ar.phaseReady}</p></article><article className="rounded-2xl border border-slate-700 bg-slate-900 p-5"><h2 className="font-semibold">{ar.role}</h2><p className="mt-2 text-sm text-slate-400">{isOwner ? ar.ownerPermissions : ar.staffPermissions}</p>{isStaff && <p className="mt-3 rounded-xl bg-amber-400/10 p-3 text-xs text-amber-200">{ar.securityNote}</p>}{isOwner && <p className="mt-3 text-sm text-emerald-300">{ar.pinSession}: {remaining > 0 ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}` : ar.inactive}</p>}</article></section>
    {isOwner && <nav className="mt-6 flex flex-wrap gap-3"><Link className="button-secondary" to="/staff">{ar.staffManagement}</Link><Link className="button-secondary" to="/change-pin">{ar.changePin}</Link></nav>}
  </main>;
}
