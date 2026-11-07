import { useState } from 'react';
import { Download, FileSpreadsheet, FileText, CheckCircle2, AlertCircle } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { useAuth } from '../../contexts/AuthContext';
import { ar } from '../../i18n/ar';
import { exportProductsFile } from '../../services/importExportService';
import { Category } from '../../types';

interface ExportProductsModalProps {
  isOpen: boolean;
  onClose: () => void;
  storeId: string;
  storeName: string;
  initialCategoryId?: string | null;
  categories: Category[];
}

export function ExportProductsModal({
  isOpen,
  onClose,
  storeId,
  storeName,
  initialCategoryId,
  categories,
}: ExportProductsModalProps) {
  const { role } = useAuth();
  const isOwner = role === 'owner';

  const [scope, setScope] = useState<'all' | 'category'>(
    initialCategoryId ? 'category' : 'all'
  );
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>(
    initialCategoryId || ''
  );
  const [format, setFormat] = useState<'xlsx' | 'csv'>('xlsx');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleExport = async () => {
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const catId = scope === 'category' ? selectedCategoryId || null : null;
      await exportProductsFile(storeId, storeName, catId, format, isOwner);
      setSuccess(true);
      setTimeout(() => {
        onClose();
        setSuccess(false);
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل تصدير المنتجات.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={ar.exportModalTitle} maxWidth="md">
      <div className="space-y-4" dir="rtl">
        {/* اختيار نطاق التصدير */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-300">{ar.exportScope}</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setScope('all')}
              className={`p-3 rounded-xl border text-right transition ${
                scope === 'all'
                  ? 'border-emerald-500 bg-emerald-950/20 text-white'
                  : 'border-slate-800 bg-slate-900/60 text-slate-400'
              }`}
            >
              <p className="text-xs font-bold">{ar.allStoreProducts}</p>
            </button>

            <button
              type="button"
              onClick={() => setScope('category')}
              className={`p-3 rounded-xl border text-right transition ${
                scope === 'category'
                  ? 'border-emerald-500 bg-emerald-950/20 text-white'
                  : 'border-slate-800 bg-slate-900/60 text-slate-400'
              }`}
            >
              <p className="text-xs font-bold">{ar.categoryProducts}</p>
            </button>
          </div>

          {scope === 'category' && (
            <div className="pt-2">
              <label className="block text-xs font-bold text-slate-300 mb-1">
                اختر التصنيف:
              </label>
              <select
                className="field text-xs py-2"
                value={selectedCategoryId}
                onChange={(e) => setSelectedCategoryId(e.target.value)}
              >
                <option value="">-- كافة التصنيفات --</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* اختيار الصيغة */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-300">{ar.exportFormat}</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setFormat('xlsx')}
              className={`flex items-center gap-2.5 p-3 rounded-xl border text-right transition ${
                format === 'xlsx'
                  ? 'border-emerald-500 bg-emerald-950/20 text-white'
                  : 'border-slate-800 bg-slate-900/60 text-slate-400'
              }`}
            >
              <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 shrink-0">
                <FileSpreadsheet className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-bold">{ar.formatExcel}</p>
                <p className="text-[10px] text-slate-500">جداول بيانات Excel</p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setFormat('csv')}
              className={`flex items-center gap-2.5 p-3 rounded-xl border text-right transition ${
                format === 'csv'
                  ? 'border-emerald-500 bg-emerald-950/20 text-white'
                  : 'border-slate-800 bg-slate-900/60 text-slate-400'
              }`}
            >
              <div className="p-2 rounded-lg bg-sky-500/10 text-sky-400 shrink-0">
                <FileText className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-bold">{ar.formatCsv}</p>
                <p className="text-[10px] text-slate-500">ترميز عربي UTF-8</p>
              </div>
            </button>
          </div>
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
            <span>{ar.fileExportSuccess}</span>
          </div>
        )}

        {loading && <LoadingSpinner message={ar.exportingWait} />}

        <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
          <Button variant="outline" size="sm" onClick={onClose} disabled={loading}>
            {ar.cancel}
          </Button>
          <Button
            variant="primary"
            onClick={handleExport}
            disabled={loading}
            icon={<Download className="w-4 h-4" />}
          >
            {ar.startExportBtn}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
