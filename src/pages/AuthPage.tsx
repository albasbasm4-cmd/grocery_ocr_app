import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ar } from '../i18n/ar';

function authError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('invalid login credentials')) return ar.invalidCredentials;
  if (lower.includes('already registered') || lower.includes('user already registered')) return ar.emailExists;
  if (lower.includes('password') && lower.includes('at least')) return ar.weakPassword;
  if (lower.includes('email') && (lower.includes('invalid') || lower.includes('valid'))) return ar.emailInvalid;
  return message || ar.genericError;
}
export default function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'signup' | 'reset'>('login');
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setNotice('');
    if (!email.trim()) { setError(ar.emailRequired); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError(ar.emailInvalid); return; }
    setBusy(true);
    if (mode === 'reset') {
      const { error: requestError } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/reset-password` });
      setBusy(false); if (requestError) setError(authError(requestError.message)); else setNotice(ar.resetSent); return;
    }
    if (!password) { setBusy(false); setError(ar.passwordRequired); return; }
    if (mode === 'signup' && password !== confirm) { setBusy(false); setError(ar.passwordMismatch); return; }
    const result = mode === 'signup'
      ? await supabase.auth.signUp({ email: email.trim(), password })
      : await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (result.error) { setError(authError(result.error.message)); return; }
    if (mode === 'signup' && !result.data.session) { setNotice(ar.accountCreatedConfirm); return; }
    navigate('/', { replace: true });
  }
  const title = mode === 'signup' ? ar.signupTitle : mode === 'reset' ? ar.resetPassword : ar.loginTitle;
  return <main className="flex min-h-screen items-center justify-center p-4"><section className="w-full max-w-md rounded-3xl border border-slate-700 bg-slate-900 p-6 shadow-xl sm:p-8">
    <div className="mb-7 text-center"><div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-emerald-400/10 text-3xl">🛒</div><h1 className="text-2xl font-bold">{title}</h1><p className="mt-2 text-sm text-slate-400">{ar.appName}</p></div>
    <form onSubmit={submit} className="space-y-4">
      <label className="block text-sm">{ar.email}<input className="field mt-2" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      {mode !== 'reset' && <label className="block text-sm">{ar.password}<input className="field mt-2" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} /></label>}
      {mode === 'signup' && <label className="block text-sm">{ar.confirmPassword}<input className="field mt-2" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>}
      {error && <p role="alert" className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}{notice && <p role="status" className="rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-300">{notice}</p>}
      <button className="button-primary w-full" disabled={busy}>{busy ? ar.loading : mode === 'signup' ? ar.signUp : mode === 'reset' ? ar.resetPassword : ar.signIn}</button>
    </form>
    <div className="mt-5 flex flex-col items-center gap-3 text-sm text-slate-300">
      {mode === 'login' && <button className="text-emerald-300 hover:underline" onClick={() => { setMode('reset'); setError(''); setNotice(''); }}>{ar.forgotPassword}</button>}
      {mode !== 'reset' ? <p>{mode === 'login' ? ar.noAccount : ar.hasAccount} <button className="text-emerald-300 hover:underline" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setNotice(''); }}>{mode === 'login' ? ar.signUp : ar.signIn}</button></p> : <button className="text-emerald-300 hover:underline" onClick={() => setMode('login')}>{ar.back}</button>}
      <Link to="/" className="text-slate-500 hover:text-slate-300">{ar.backHome}</Link>
    </div>
  </section></main>;
}
