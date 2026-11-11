import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { isOnline } from '../lib/offlineGuard';
import { ar } from '../i18n/ar';
import { PinResetModal } from '../components/PinResetModal';

export default function ChangePinPage() {
  const { store, isOwner } = useAuth();
  const [oldPin, setOldPin] = useState('');
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [resetModalOpen, setResetModalOpen] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    if (!isOnline()) {
      setError(ar.changePinRequiresOnline);
      return;
    }
    if (!store) return;
    if (!/^\d{4,8}$/.test(pin)) {
      setError(ar.invalidPin);
      return;
    }
    if (pin !== confirm) {
      setError(ar.pinMismatch);
      return;
    }
    setBusy(true);
    const { error: rpcError } = await supabase.rpc('set_admin_pin', {
      p_store_id: store.id,
      p_new_pin: pin,
      p_old_pin: oldPin,
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
    } else {
      setOldPin('');
      setPin('');
      setConfirm('');
      setNotice(ar.pinSaved);
    }
  }

  return (
    <main className="mx-auto max-w-xl p-4 sm:p-8" dir="rtl">
      <Link to="/" className="text-sm text-emerald-300">
        ← {ar.backHome}
      </Link>
      <h1 className="mb-6 mt-4 text-2xl font-bold">{ar.changePin}</h1>

      <form onSubmit={submit} className="space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-5">
        <label className="block text-sm">
          {ar.oldPin}
          <input
            className="field mt-2"
            type="password"
            inputMode="numeric"
            value={oldPin}
            onChange={(e) => setOldPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
          />
        </label>
        <label className="block text-sm">
          {ar.newPin} (4-8 أرقام)
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

        {isOwner && (
          <div className="text-left">
            <button
              type="button"
              onClick={() => setResetModalOpen(true)}
              className="text-xs text-emerald-400 hover:text-emerald-300 underline"
            >
              {ar.forgotPin}
            </button>
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-300">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm text-emerald-300">
            {notice}
          </p>
        )}

        <button className="button-primary" disabled={busy}>
          {busy ? ar.loading : ar.save}
        </button>
      </form>

      {resetModalOpen && (
        <PinResetModal
          isOpen={resetModalOpen}
          onClose={() => setResetModalOpen(false)}
          onSuccess={() => {
            setNotice(ar.pinResetSuccess);
            setResetModalOpen(false);
          }}
        />
      )}
    </main>
  );
}
