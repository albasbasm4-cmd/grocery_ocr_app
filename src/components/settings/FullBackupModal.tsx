import { useState } from 'react';
import { Database, Download, CheckCircle2, AlertCircle } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { PinPromptModal } from '../PinPromptModal';
import { usePermissions } from '../../hooks/usePermissions';
import { ar } from '../../i18n/ar';
import { exportFullStoreBackup } from '../../services/importExportService';

interface FullBackupModalProps {
  isOpen: boolean;
  onClose: () => void;
  storeId: string;
  storeName: string;
}

export function FullBackupModal({
  isOpen,
  onClose,
  storeId,
  storeName,
}: FullBackupModalProps) {
  const { pinActive } = usePermissions();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pinPromptOpen, setPinPromptOpen] = useState(false);

  const startBackupFlow = () => {
    if (!pinActive) {
      setPinPromptOpen(true);
      return;
    }
    executeBackup();
  };

  const executeBackup = async () => {
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      await exportFullStoreBackup(storeId, storeName);
      setSuccess(true);
      setTimeout(() => {
        onClose();
        setSuccess(false);
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : ar.backupFailedError);
    } finally {
      setLoading(false);
    }
  };

  const onPinSuccess = async () => {
    setPinPromptOpen(false);
    await executeBackup();
  };

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title={ar.fullBackupTitle} maxWidth="md">
        <div className="space-y-4" dir="rtl">
          <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-900 border border-slate-800">
            <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-400 shrink-0">
              <Database className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">{ar.fullBackupHeading}</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {ar.fullBackupDescription}
              </p>
            </div>
          </div>

          <div className="text-xs text-slate-300 space-y-1.5 p-3 rounded-xl bg-slate-950/60 border border-slate-800">
            <p className="font-bold text-slate-200">{ar.backupIncludedDataHeading}</p>
            <ul className="list-disc list-inside space-y-1 text-slate-400">
              <li>{ar.backupStoreData}</li>
              <li>{ar.backupCategoriesProducts}</li>
              <li>{ar.backupCustomersDebts}</li>
              <li>{ar.backupInvoicesSnapshots}</li>
              <li>{ar.backupMovementsPayments}</li>
            </ul>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{ar.backupSuccess}</span>
            </div>
          )}

          {loading && <LoadingSpinner message={ar.extractingBackupProgress} />}

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
            <Button variant="outline" size="sm" onClick={onClose} disabled={loading}>
              {ar.cancel}
            </Button>
            <Button
              variant="primary"
              onClick={startBackupFlow}
              disabled={loading}
              icon={<Download className="w-4 h-4" />}
            >
              {ar.fullBackupBtn}
            </Button>
          </div>
        </div>
      </Modal>

      {pinPromptOpen && (
        <PinPromptModal
          isOpen={pinPromptOpen}
          onClose={() => setPinPromptOpen(false)}
          onSuccess={onPinSuccess}
        />
      )}
    </>
  );
}
