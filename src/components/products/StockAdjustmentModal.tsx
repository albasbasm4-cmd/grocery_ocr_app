import Decimal from 'decimal.js';
import { useState, type FormEvent } from 'react';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { NumberInput } from '../ui/NumberInput';
import { ar } from '../../i18n/ar';
import type { Product } from '../../types';

interface StockAdjustmentModalProps {
  product: Product | null;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (quantity: string, reason: string) => Promise<void>;
  isSaving?: boolean;
}

export function StockAdjustmentModal({ product, isOpen, onClose, onSubmit, isSaving }: StockAdjustmentModalProps) {
  const [quantity, setQuantity] = useState('0');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    if (!reason.trim()) { setError(ar.adjustStockReason + ar.reasonRequiredSuffix); return; }
    if (!/^\d+(\.\d{1,3})?$/.test(quantity) || !new Decimal(quantity).isFinite() || new Decimal(quantity).isNegative()) { setError(ar.stockInvalid); return; }
    try {
      await onSubmit(quantity, reason.trim());
      onClose();
      setReason('');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : ar.genericError);
    }
  };
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={ar.adjustStock}>
      <form className="space-y-4" onSubmit={submit}>
        <p className="text-sm text-slate-400">{ar.productStockSummary(product?.name || "", ar.stockQuantity, product?.stock_quantity ?? 0)}</p>
        <NumberInput label={ar.newStockQuantity} value={quantity} onChange={setQuantity} allowDecimals />
        <label className="block text-sm font-semibold text-slate-300">{ar.adjustStockReason}
          <textarea className="field mt-2 min-h-[90px]" value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        {error && <p role="alert" className="rounded-xl bg-rose-500/10 p-3 text-sm text-rose-300">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" className="flex-1" isLoading={isSaving}>{ar.save}</Button>
          <Button type="button" variant="outline" onClick={onClose}>{ar.cancel}</Button>
        </div>
      </form>
    </Modal>
  );
}
