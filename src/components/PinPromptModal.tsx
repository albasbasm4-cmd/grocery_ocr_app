import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { ar } from '../i18n/ar';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
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
  const { verifyPin } = useAuth();
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = toLatinDigits(pin).trim();
    if (!/^\d{4,6}$/.test(clean)) {
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
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-slate-600">{description}</p>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">
            {error}
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-700">
            رمز PIN (٤ إلى ٦ أرقام)
          </label>
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            autoComplete="one-time-code"
            value={pin}
            onChange={(e) => {
              setPin(toLatinDigits(e.target.value).replace(/\D/g, '').slice(0, 6));
              setError(null);
            }}
            placeholder="••••"
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-center text-2xl font-bold tracking-widest text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
            autoFocus
          />
        </div>

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
  );
};
