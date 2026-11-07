import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { PinPromptModal } from '../PinPromptModal';
import { useAuth } from '../../contexts/AuthContext';
import { voidSale } from '../../services/salesService';
import { ar } from '../../i18n/ar';
import type { SaleWithDetails } from '../../services/salesService';

interface VoidSaleModalProps {
  isOpen: boolean;
  onClose: () => void;
  sale: SaleWithDetails | null;
  onSuccess: () => void;
}

export const VoidSaleModal: React.FC<VoidSaleModalProps> = ({
  isOpen,
  onClose,
  sale,
  onSuccess,
}) => {
  const { isOwner, hasActivePinSession } = useAuth();
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);

  if (!sale) return null;

  const performVoid = async () => {
    try {
      setIsSubmitting(true);
      setError(null);
      await voidSale(sale.id, reason);
      setReason('');
      onSuccess();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : ar.voidFailedError);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStartVoid = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOwner) {
      setError(ar.staffVoidBlocked);
      return;
    }

    if (!reason.trim()) {
      setError(ar.voidReasonRequired);
      return;
    }

    // إذا كانت جلسة الـ PIN فعالة، نفّذ مباشرة؛ وإلا اطلب الـ PIN
    if (hasActivePinSession) {
      void performVoid();
    } else {
      setIsPinModalOpen(true);
    }
  };

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title={ar.voidSale}>
        <form onSubmit={handleStartVoid} className="space-y-4">
          <div className="bg-rose-500/10 border border-rose-500/20 text-rose-300 p-3 rounded-2xl flex items-start gap-2.5 text-xs">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">{ar.voidSaleConfirm}</p>
              <p className="mt-1 text-slate-400">{ar.voidInvoiceNumber(sale.id.slice(0, 8))}</p>
            </div>
          </div>

          {error && (
            <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 p-3 rounded-xl text-xs font-semibold">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              {ar.voidReason} *
            </label>
            <textarea
              required
              rows={2}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setError(null);
              }}
              placeholder={ar.voidReasonPlaceholder}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-white text-xs outline-none focus:border-rose-500 text-right"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              type="submit"
              variant="danger"
              disabled={isSubmitting || !reason.trim()}
              className="flex-1 bg-rose-600 hover:bg-rose-500 text-white font-bold"
            >
              {isSubmitting ? ar.loading : ar.voidSale}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>
              {ar.cancel}
            </Button>
          </div>
        </form>
      </Modal>

      <PinPromptModal
        isOpen={isPinModalOpen}
        onClose={() => setIsPinModalOpen(false)}
        onSuccess={() => void performVoid()}
        title={ar.voidPinModalTitle}
        description={ar.voidPinModalDesc}
      />
    </>
  );
};
