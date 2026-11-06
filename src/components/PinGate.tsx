import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { ar } from '../i18n/ar';
import { useAuth } from '../contexts/AuthContext';

function pinError(message: string): string {
  if (message.includes('قفل') || message.toLowerCase().includes('locked')) return ar.pinLocked;
  if (message.includes('غير صحيح') || message.toLowerCase().includes('incorrect')) return ar.pinWrong;
  if (message.includes('لم يتم تعيين')) return ar.pinMissing;
  return message || ar.genericError;
}
export function PinGate({ open, onClose, onVerified }: { open: boolean; onClose: () => void; onVerified?: () => void }) {
  const { store, setPinExpiresAt } = useAuth();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    if (!/^\d{4,6}$/.test(pin)) { setError(ar.invalidPin); return; }
    if (!store) return;
    setBusy(true);
    const { data, error: rpcError } = await supabase.rpc('verify_admin_pin', { p_store_id: store.id, p_pin: pin });
    setBusy(false);
    if (rpcError) { setError(pinError(rpcError.message)); return; }
    const result = data as { ok?: boolean; code?: string; message?: string; expires_at?: string } | null;
    if (!result?.ok) { setError(result?.code === 'locked' ? ar.pinLocked : result?.code === 'invalid_pin' ? ar.pinWrong : result?.message ?? ar.genericError); return; }
    const expires = result.expires_at;
    if (!expires) { setError(ar.genericError); return; }
    setPinExpiresAt(expires); setPin(''); onVerified?.();
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4" role="dialog" aria-modal="true" aria-labelledby="pin-title">
    <form onSubmit={submit} className="w-full max-w-sm space-y-5 rounded-3xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
      <div><h2 id="pin-title" className="text-xl font-bold">{ar.pinGateTitle}</h2><p className="mt-2 text-sm text-slate-400">{ar.pinGateDescription}</p></div>
      <label className="block text-sm">{ar.pin}<input autoFocus inputMode="numeric" type="password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} className="field mt-2" autoComplete="one-time-code" /></label>
      {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300" role="alert">{error}</p>}
      <div className="flex gap-3"><button className="button-primary flex-1" disabled={busy}>{busy ? ar.loading : ar.verifyPin}</button><button type="button" className="button-secondary" onClick={onClose}>{ar.back}</button></div>
    </form>
  </div>;
}
