import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { Store, UserPlus, Clock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { ar } from '../i18n/ar';

interface MyJoinRequest {
  id: string;
  store_id: string;
  store_name: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired';
  created_at: string;
}

export default function StoreSetupPage({ initialStep = 'store' }: { initialStep?: 'store' | 'pin' }) {
  const { refreshStore } = useAuth();
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [step, setStep] = useState<'store' | 'pin'>(initialStep);

  // حقول إنشاء المتجر
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('SAR');
  const [symbol, setSymbol] = useState(ar.defaultCurrencySymbol);
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');

  // حقول الانضمام
  const [joinCode, setJoinCode] = useState('');
  const [pendingRequest, setPendingRequest] = useState<MyJoinRequest | null>(null);

  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // جلب الطلبات القائمة للمستخدم
  const loadMyRequests = useCallback(async () => {
    const { data, error: rpcErr } = await supabase.rpc('get_my_join_requests');
    if (!rpcErr && Array.isArray(data)) {
      const pending = (data as MyJoinRequest[]).find((r) => r.status === 'pending');
      if (pending) {
        setPendingRequest(pending);
        setMode('join');
      }
    }
  }, []);

  useEffect(() => {
    void loadMyRequests();
  }, [loadMyRequests]);

  async function createStore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (!name.trim()) {
      setError(ar.storeRequired);
      return;
    }
    setBusy(true);
    const { error: rpcError } = await supabase.rpc('create_store', {
      p_name: name.trim(),
      p_currency_code: currency.trim().toUpperCase(),
      p_currency_symbol: symbol.trim(),
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    await refreshStore();
    setStep('pin');
  }

  async function savePin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (!/^\d{4,8}$/.test(pin)) {
      setError(ar.invalidPin);
      return;
    }
    if (pin !== confirm) {
      setError(ar.pinMismatch);
      return;
    }
    setBusy(true);
    const { data: member } = await supabase.from('store_members').select('store_id').limit(1).maybeSingle();
    const storeId = member?.store_id;
    if (!storeId) {
      setBusy(false);
      setError(ar.genericError);
      return;
    }
    const { error: rpcError } = await supabase.rpc('set_admin_pin', {
      p_store_id: storeId,
      p_new_pin: pin,
      p_old_pin: null,
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    await refreshStore();
    window.location.assign('/');
  }

  async function submitJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const cleanCode = joinCode.trim().toUpperCase();
    if (!cleanCode) {
      setError(ar.joinCode);
      return;
    }
    setBusy(true);

    const { data, error: rpcErr } = await supabase.rpc('request_join_store', {
      p_join_code: cleanCode,
    });

    if (rpcErr || !data) {
      setBusy(false);
      setError(rpcErr?.message || ar.genericError);
      return;
    }

    const res = data as { success?: boolean; error?: string; request_id?: string; store_name?: string };
    if (!res.success || !res.request_id) {
      setBusy(false);
      setError(res.error || ar.genericError);
      return;
    }

    // إرسال إشعار بريدي لمالك المتجر عبر Edge Function
    void supabase.functions.invoke('notify-join-request', {
      body: { action: 'notify_owner', request_id: res.request_id },
    });

    setPendingRequest({
      id: res.request_id,
      store_id: '',
      store_name: res.store_name || '',
      status: 'pending',
      created_at: new Date().toISOString(),
    });
    setBusy(false);
  }

  async function cancelRequest(requestId: string) {
    setError('');
    setBusy(true);
    const { error: rpcErr } = await supabase.rpc('cancel_join_request', {
      p_request_id: requestId,
    });
    setBusy(false);
    if (rpcErr) {
      setError(rpcErr.message);
      return;
    }
    setPendingRequest(null);
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4" dir="rtl">
      <section className="w-full max-w-md rounded-3xl border border-slate-700 bg-slate-900 p-6 sm:p-8">
        {step === 'pin' ? (
          <div>
            <p className="mb-2 text-sm font-semibold text-emerald-300">{ar.setupStepTwo}</p>
            <h1 className="mb-6 text-2xl font-bold">{ar.setPinTitle}</h1>
            <form onSubmit={savePin} className="space-y-4">
              <p className="text-sm text-slate-400">{ar.pinPurpose}</p>
              <label className="block text-sm">
                {ar.pin} (4-8 أرقام)
                <input
                  className="field mt-2"
                  type="password"
                  inputMode="numeric"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                />
              </label>
              <label className="block text-sm">
                {ar.confirmPin}
                <input
                  className="field mt-2"
                  type="password"
                  inputMode="numeric"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value.replace(/\D/g, '').slice(0, 8))}
                />
              </label>
              <button className="button-primary w-full" disabled={busy}>
                {busy ? ar.loading : ar.savePin}
              </button>
            </form>
          </div>
        ) : pendingRequest ? (
          <div className="space-y-5 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-400">
              <Clock className="h-8 w-8 animate-pulse" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">{ar.joinRequestPendingTitle}</h1>
              <p className="mt-2 text-sm text-slate-400">{ar.joinRequestPendingDesc}</p>
              {pendingRequest.store_name && (
                <div className="mt-3 rounded-xl border border-slate-700 bg-slate-950 p-3">
                  <span className="text-xs text-slate-400">المتجر المطلوب:</span>
                  <p className="text-base font-bold text-emerald-400">{pendingRequest.store_name}</p>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2 pt-2">
              <button
                type="button"
                className="button-danger w-full"
                disabled={busy}
                onClick={() => void cancelRequest(pendingRequest.id)}
              >
                {busy ? ar.loading : ar.cancelJoinRequest}
              </button>
              <button
                type="button"
                className="button-secondary w-full"
                disabled={busy}
                onClick={() => {
                  setPendingRequest(null);
                  setMode('create');
                }}
              >
                {ar.createStoreInstead}
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div className="mb-6 flex rounded-2xl bg-slate-950 p-1 border border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setMode('create');
                  setError('');
                }}
                className={`flex-1 rounded-xl py-2.5 text-sm font-bold transition flex items-center justify-center gap-2 ${
                  mode === 'create'
                    ? 'bg-emerald-500 text-slate-950 shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Store className="h-4 w-4" />
                {ar.createMyStore}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('join');
                  setError('');
                }}
                className={`flex-1 rounded-xl py-2.5 text-sm font-bold transition flex items-center justify-center gap-2 ${
                  mode === 'join'
                    ? 'bg-emerald-500 text-slate-950 shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <UserPlus className="h-4 w-4" />
                {ar.joinStore}
              </button>
            </div>

            {mode === 'create' ? (
              <form onSubmit={createStore} className="space-y-4">
                <label className="block text-sm font-semibold text-slate-300">
                  {ar.shopName}
                  <input
                    className="field mt-2"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="مثال: بقالة الأمل"
                    autoFocus
                  />
                </label>
                <label className="block text-sm font-semibold text-slate-300">
                  {ar.currency}
                  <input
                    className="field mt-2"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                  />
                </label>
                <label className="block text-sm font-semibold text-slate-300">
                  {ar.currencySymbol}
                  <input
                    className="field mt-2"
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value)}
                  />
                </label>
                <button className="button-primary w-full" disabled={busy}>
                  {busy ? ar.loading : ar.createShop}
                </button>
              </form>
            ) : (
              <form onSubmit={submitJoin} className="space-y-4">
                <p className="text-xs text-slate-400">{ar.joinStoreDesc}</p>
                <label className="block text-sm font-semibold text-slate-300">
                  {ar.joinCode}
                  <input
                    className="field mt-2 text-center text-lg font-mono uppercase tracking-widest"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    placeholder={ar.joinCodePlaceholder}
                    maxLength={10}
                    autoFocus
                  />
                </label>
                <button className="button-primary w-full" disabled={busy || !joinCode.trim()}>
                  {busy ? ar.loading : ar.sendJoinRequest}
                </button>
              </form>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="mt-4 rounded-xl bg-red-500/10 p-3 text-sm text-red-300">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}
