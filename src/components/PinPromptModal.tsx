import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { ar } from '../i18n/ar';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { PinResetModal } from './PinResetModal';
import { toLatinDigits } from '../lib/numbers';

interface PinPromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  title?: string;
  description?: string;
}

export const PinPromptModal: React.FC<PinPromptModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  title = ar.pinGateTitle,
  description = ar.ownerPinRequired,
}) => {
  const { verifyPin, isOwner } = useAuth();
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetModalOpen, setResetModalOpen] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = toLatinDigits(pin).trim();
    if (!/^\d{4,8}$/.test(clean)) {
      setError(ar.invalidPin);
      return;
    }

    setLoading(true);
    setError(null);

    const result = await verifyPin(clean);
    setLoading(false);

    if (result.success) {
      setPin('');
      onSuccess();
      onClose();
    } else {
      setError(result.error || ar.invalidPin);
    }
  };

  return (
    <>
      <Modal isOpen={isOpen && !resetModalOpen} onClose={onClose} title={title}>
        <form onSubmit={handleSubmit} className="space-y-4" dir="rtl">
          <p className="text-sm text-slate-300">{description}</p>

          {error && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs font-semibold text-red-300">
              {error}
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-300">
              {ar.pin}
            </label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={8}
              autoComplete="one-time-code"
              value={pin}
              onChange={(e) => {
                setPin(toLatinDigits(e.target.value).replace(/\D/g, '').slice(0, 8));
                setError(null);
              }}
              placeholder="••••"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-center text-2xl font-bold tracking-widest text-white focus:border-emerald-500 focus:outline-none"
              autoFocus
            />
          </div>

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

          <div className="flex gap-2 pt-2">
            <Button
              type="submit"
              variant="primary"
              className="flex-1"
              disabled={loading || pin.length < 4}
            >
              {loading ? ar.loading : ar.confirm}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setPin('');
                setError(null);
                onClose();
              }}
            >
              {ar.cancel}
            </Button>
          </div>
        </form>
      </Modal>

      {resetModalOpen && (
        <PinResetModal
          isOpen={resetModalOpen}
          onClose={() => setResetModalOpen(false)}
          onSuccess={() => {
            setResetModalOpen(false);
            onClose();
          }}
        />
      )}
    </>
  );
};
