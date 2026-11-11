import React, { useState, useEffect, useCallback } from 'react';
import { Mail, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { ar } from '../i18n/ar';

interface PinResetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export const PinResetModal: React.FC<PinResetModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const { store, user, isOwner } = useAuth();
  const { showToast } = useToast();

  const [step, setStep] = useState<'send' | 'verify' | 'done'>('send');
  const [code, setCode] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (!isOpen) {
      setStep('send');
      setCode('');
      setNewPin('');
      setConfirmPin('');
      setError(null);
      setLoading(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((prev) => Math.max(0, prev - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleSendCode = useCallback(async () => {
    if (!store?.id) return;
    setError(null);
    setLoading(true);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('pin-reset', {
        body: { action: 'send_code', store_id: store.id },
      });
      if (invokeError) throw new Error(invokeError.message);
      if (data?.error) throw new Error(data.error as string);

      showToast(ar.forgotPinDesc, 'info');
      setStep('verify');
      setCooldown(60);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : ar.genericError);
    } finally {
      setLoading(false);
    }
  }, [store?.id, showToast]);

  const handleVerifyAndReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!store?.id) return;
    setError(null);

    const cleanCode = code.trim();
    if (!/^\d{6}$/.test(cleanCode)) {
      setError(ar.enterResetCode);
      return;
    }

    if (!/^\d{4,8}$/.test(newPin)) {
      setError(ar.invalidPin);
      return;
    }

    if (newPin !== confirmPin) {
      setError(ar.pinMismatch);
      return;
    }

    setLoading(true);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('pin-reset', {
        body: {
          action: 'verify_and_reset',
          store_id: store.id,
          code: cleanCode,
          new_pin: newPin,
        },
      });

      if (invokeError) throw new Error(invokeError.message);
      if (data?.error) throw new Error(data.error as string);

      showToast(ar.pinResetSuccess, 'success');
      setStep('done');
      if (onSuccess) onSuccess();
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : ar.genericError);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !isOwner) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={ar.forgotPinTitle}>
      <div className="space-y-4" dir="rtl">
        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs font-semibold text-rose-300">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        {step === 'send' && (
          <div className="space-y-4 text-center py-2">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-400">
              <Mail className="h-7 w-7" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-200">{ar.forgotPinDesc}</p>
              <p className="mt-1 text-xs text-slate-400">{user?.email}</p>
            </div>
            <div className="flex gap-2 pt-2">
              <Button
                type="button"
                className="flex-1"
                isLoading={loading}
                onClick={() => void handleSendCode()}
              >
                {ar.sendResetCode}
              </Button>
              <Button type="button" variant="outline" onClick={onClose}>
                {ar.cancel}
              </Button>
            </div>
          </div>
        )}

        {step === 'verify' && (
          <form onSubmit={handleVerifyAndReset} className="space-y-4">
            <p className="text-xs text-slate-400">
              أدخل رمز التحقق المرسل إلى بريدك الإلكتروني ({user?.email}) ثم عيّن رمز PIN الجديد:
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                {ar.enterResetCode} *
              </label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-center text-lg font-mono tracking-widest text-white outline-none focus:border-emerald-500"
                autoFocus
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                {ar.newPin} (4-8 أرقام) *
              </label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={8}
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                placeholder="••••"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-center text-base font-mono tracking-widest text-white outline-none focus:border-emerald-500"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                {ar.confirmPin} *
              </label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={8}
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                placeholder="••••"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-center text-base font-mono tracking-widest text-white outline-none focus:border-emerald-500"
                required
              />
            </div>

            <div className="flex items-center justify-between text-xs pt-1">
              <button
                type="button"
                disabled={loading || cooldown > 0}
                onClick={() => void handleSendCode()}
                className="text-emerald-400 hover:text-emerald-300 disabled:text-slate-500"
              >
                {cooldown > 0 ? ar.resendCodeIn(cooldown) : ar.sendResetCode}
              </button>
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                type="submit"
                className="flex-1"
                isLoading={loading}
                disabled={code.length !== 6 || newPin.length < 4}
              >
                {ar.setNewPin}
              </Button>
              <Button type="button" variant="outline" onClick={onClose}>
                {ar.cancel}
              </Button>
            </div>
          </form>
        )}

        {step === 'done' && (
          <div className="py-6 text-center space-y-3">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-400" />
            <p className="text-base font-bold text-white">{ar.pinResetSuccess}</p>
          </div>
        )}
      </div>
    </Modal>
  );
};
