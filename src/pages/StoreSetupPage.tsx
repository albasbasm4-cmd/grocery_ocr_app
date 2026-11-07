import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { ar } from '../i18n/ar';

export default function StoreSetupPage({ initialStep = 'store' }: { initialStep?: 'store' | 'pin' }) {
  const { refreshStore } = useAuth();
  const [step, setStep] = useState<'store' | 'pin'>(initialStep);
  const [name, setName] = useState(''); const [currency, setCurrency] = useState('SAR'); const [symbol, setSymbol] = useState(ar.defaultCurrencySymbol);
  const [pin, setPin] = useState(''); const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function createStore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); if (!name.trim()) { setError(ar.storeRequired); return; }
    setBusy(true);
    const { error: rpcError } = await supabase.rpc('create_store', { p_name: name.trim(), p_currency_code: currency.trim().toUpperCase(), p_currency_symbol: symbol.trim() });
    setBusy(false); if (rpcError) { setError(rpcError.message); return; }
    await refreshStore(); setStep('pin');
  }
  async function savePin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    if (!/^\d{4,6}$/.test(pin)) { setError(ar.invalidPin); return; }
    if (pin !== confirm) { setError(ar.pinMismatch); return; }
    setBusy(true);
    const { data: member } = await supabase.from('store_members').select('store_id').limit(1).maybeSingle();
    const storeId = member?.store_id;
    if (!storeId) { setBusy(false); setError(ar.genericError); return; }
    const { error: rpcError } = await supabase.rpc('set_admin_pin', { p_store_id: storeId, p_new_pin: pin, p_old_pin: null });
    setBusy(false); if (rpcError) { setError(rpcError.message); return; }
    await refreshStore(); window.location.assign('/');
  }
  return <main className="flex min-h-screen items-center justify-center p-4"><section className="w-full max-w-md rounded-3xl border border-slate-700 bg-slate-900 p-6 sm:p-8">
    <p className="mb-2 text-sm font-semibold text-emerald-300">{step === 'store' ? ar.setupStepOne : ar.setupStepTwo}</p><h1 className="mb-6 text-2xl font-bold">{step === 'store' ? ar.shopSetupTitle : ar.setPinTitle}</h1>
    {step === 'store' ? <form onSubmit={createStore} className="space-y-4"><label className="block text-sm">{ar.shopName}<input className="field mt-2" value={name} onChange={(e) => setName(e.target.value)} /></label><label className="block text-sm">{ar.currency}<input className="field mt-2" value={currency} onChange={(e) => setCurrency(e.target.value)} /></label><label className="block text-sm">{ar.currencySymbol}<input className="field mt-2" value={symbol} onChange={(e) => setSymbol(e.target.value)} /></label><button className="button-primary w-full" disabled={busy}>{busy ? ar.loading : ar.createShop}</button></form>
    : <form onSubmit={savePin} className="space-y-4"><p className="text-sm text-slate-400">{ar.pinPurpose}</p><label className="block text-sm">{ar.pin}<input className="field mt-2" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} /></label><label className="block text-sm">{ar.confirmPin}<input className="field mt-2" type="password" inputMode="numeric" value={confirm} onChange={(e) => setConfirm(e.target.value.replace(/\D/g, '').slice(0, 6))} /></label><button className="button-primary w-full" disabled={busy}>{busy ? ar.loading : ar.savePin}</button></form>}
    {error && <p role="alert" className="mt-4 rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
  </section></main>;
}
