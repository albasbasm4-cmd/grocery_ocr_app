import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { ar } from '../i18n/ar';

type StaffRow = { user_id: string; role: string; is_active: boolean; email: string | null };
export default function StaffManagementPage() {
  const { store } = useAuth();
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  const callFunction = useCallback(async (body: Record<string, unknown>) => {
    const { data, error: invokeError } = await supabase.functions.invoke('manage-staff', { body: { store_id: store?.id, ...body } });
    if (invokeError) throw new Error(invokeError.message);
    if (data?.error) throw new Error(data.error as string);
    return data as { staff?: StaffRow[] };
  }, [store?.id]);
  const load = useCallback(async () => {
    if (!store) return;
    try { const data = await callFunction({ action: 'list' }); setStaff(data.staff ?? []); }
    catch (err) { setError(err instanceof Error ? err.message : ar.genericError); }
  }, [callFunction, store]);
  useEffect(() => { void load(); }, [load]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setNotice('');
    if (!email.trim() || !password || password.length < 8) { setError(!email.trim() ? ar.emailRequired : ar.weakPassword); return; }
    setBusy(true);
    try { await callFunction({ action: 'create', email: email.trim(), password }); setEmail(''); setPassword(''); setNotice(ar.staffCreated); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : ar.genericError); }
    finally { setBusy(false); }
  }
  async function action(userId: string, actionName: 'deactivate' | 'remove') {
    setError(''); setNotice(''); setBusy(true);
    try { await callFunction({ action: actionName, user_id: userId }); setNotice(actionName === 'deactivate' ? ar.staffDeactivated : ar.staffRemoved); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : ar.genericError); }
    finally { setBusy(false); }
  }
  return <main className="mx-auto max-w-3xl p-4 sm:p-8"><Link to="/" className="text-sm text-emerald-300">← {ar.backHome}</Link><h1 className="mt-4 text-2xl font-bold">{ar.staffManagement}</h1><p className="mt-2 text-sm text-slate-400">{ar.securityNote}</p>
    <form onSubmit={submit} className="mt-6 space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-5"><h2 className="font-semibold">{ar.addStaff}</h2><label className="block text-sm">{ar.email}<input className="field mt-2" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label><label className="block text-sm">{ar.temporaryPassword}<input className="field mt-2" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} /></label><button className="button-primary" disabled={busy}>{busy ? ar.loading : ar.add}</button></form>
    {error && <p role="alert" className="mt-4 rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}{notice && <p role="status" className="mt-4 rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-300">{notice}</p>}
    <section className="mt-8 space-y-3"><h2 className="font-semibold">{ar.staffList}</h2>{staff.length === 0 ? <p className="text-sm text-slate-500">{ar.noStaff}</p> : staff.map((member) => <article key={member.user_id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-700 bg-slate-900 p-4"><div><p className="font-medium">{member.email ?? member.user_id}</p><p className="mt-1 text-xs text-slate-400">{member.is_active ? ar.active : ar.inactive}</p></div><div className="flex gap-2">{member.is_active && <button disabled={busy} className="button-secondary" onClick={() => void action(member.user_id, 'deactivate')}>{ar.deactivate}</button>}<button disabled={busy} className="button-danger" onClick={() => void action(member.user_id, 'remove')}>{ar.remove}</button></div></article>)}</section>
  </main>;
}
