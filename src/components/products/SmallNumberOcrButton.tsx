import { useState } from 'react';
import { Camera, Check, RotateCcw } from 'lucide-react';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { ar } from '../../i18n/ar';
import { toLatinDigits } from '../../lib/numbers';
import { captureSmallNumberText, smallNumberOcrEnabled } from '../../services/smallNumberOcr';

interface SmallNumberOcrButtonProps {
  onConfirm: (value: string) => void;
}

export function SmallNumberOcrButton({ onConfirm }: SmallNumberOcrButtonProps) {
  const [open, setOpen] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  const capture = async () => {
    setCapturing(true);
    setError('');
    try {
      setValue(await captureSmallNumberText());
    } catch {
      setError(ar.ocrCaptureFailed);
    } finally {
      setCapturing(false);
    }
  };

  if (!smallNumberOcrEnabled) return null;
  return <>
    <Button type="button" variant="outline" onClick={() => { setOpen(true); void capture(); }} aria-label={ar.readSmallNumber}><Camera className="h-4 w-4" /></Button>
    <Modal isOpen={open} onClose={() => setOpen(false)} title={ar.ocrConfirmTitle}>
      <div className="space-y-4">
        <p className="text-sm text-slate-300">{ar.ocrConfirmHint}</p>
        {error && <p role="alert" className="rounded-xl bg-rose-950/50 p-3 text-sm text-rose-200">{error}</p>}
        <input autoFocus value={value} onChange={(event) => setValue(toLatinDigits(event.target.value))} className="field text-center text-xl font-bold tracking-wider" dir="ltr" />
        <div className="flex gap-2">
          <Button type="button" disabled={capturing || !value.trim()} className="flex-1" onClick={() => { onConfirm(value.trim()); setOpen(false); }} icon={<Check className="h-4 w-4" />}>{ar.confirmOcr}</Button>
          <Button type="button" variant="outline" disabled={capturing} onClick={() => void capture()} icon={<RotateCcw className="h-4 w-4" />}>{ar.retry}</Button>
        </div>
      </div>
    </Modal>
  </>;
}
