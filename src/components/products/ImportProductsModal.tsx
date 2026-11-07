import { useState, useRef, useEffect } from 'react';
import {
  Upload,
  Download,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  FileSpreadsheet,
  ArrowRight,
  ArrowLeft,
  RefreshCw,
  FolderPlus,
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { Card } from '../ui/Card';
import { PinPromptModal } from '../PinPromptModal';
import { usePermissions } from '../../hooks/usePermissions';
import { ar } from '../../i18n/ar';
import {
  ColumnMapping,
  ValidationSummary,
  BulkUpsertResult,
  BatchProgress,
  downloadTemplate,
  parseImportFile,
  autoMapHeaders,
  validateImportRows,
  createMissingCategories,
  importInBatches,
  downloadRejectionsReport,
} from '../../services/importExportService';
import { fetchCategories } from '../../services/categoriesService';

interface ImportProductsModalProps {
  isOpen: boolean;
  onClose: () => void;
  storeId: string;
  onSuccess: () => void;
}

type Step = 'file' | 'mapping' | 'validation' | 'progress' | 'results';

export function ImportProductsModal({
  isOpen,
  onClose,
  storeId,
  onSuccess,
}: ImportProductsModalProps) {
  const { pinActive } = usePermissions();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('file');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({
    name: -1,
    category: -1,
    barcode: -1,
    sku: -1,
    unit: -1,
    price: -1,
    cost_price: -1,
    stock_quantity: -1,
    min_stock: -1,
    expiry_date: -1,
  });

  const [existingCategories, setExistingCategories] = useState<string[]>([]);
  const [validation, setValidation] = useState<ValidationSummary | null>(null);
  const [autoCreateCategories, setAutoCreateCategories] = useState(true);
  const [duplicateMode, setDuplicateMode] = useState<'skip' | 'update'>('skip');

  const [progress, setProgress] = useState<BatchProgress>({
    currentBatch: 0,
    totalBatches: 0,
    processedRows: 0,
    totalRows: 0,
    percent: 0,
  });

  const [importResult, setImportResult] = useState<BulkUpsertResult | null>(null);
  const [pinPromptOpen, setPinPromptOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<null | (() => Promise<void>)>(null);

  // إعادة ضبط الحالة عند فتح النافذة
  useEffect(() => {
    if (isOpen) {
      setStep('file');
      setSelectedFile(null);
      setParsing(false);
      setParseError(null);
      setRawHeaders([]);
      setRawRows([]);
      setValidation(null);
      setImportResult(null);
      loadCategories();
    }
  }, [isOpen, storeId]);

  const loadCategories = async () => {
    try {
      const cats = await fetchCategories(storeId);
      setExistingCategories(cats.map((c) => c.name));
    } catch (e) {
      console.warn('Failed to load categories for import validation:', e);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setParseError(null);
    setParsing(true);

    try {
      const parsed = await parseImportFile(file);
      setRawHeaders(parsed.headers);
      setRawRows(parsed.rows);
      const initialMapping = autoMapHeaders(parsed.headers);
      setMapping(initialMapping);
      setStep('mapping');
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'فشل قراءة الملف.');
    } finally {
      setParsing(false);
    }
  };

  const runValidation = () => {
    const summary = validateImportRows(rawRows, mapping, existingCategories);
    setValidation(summary);
    setStep('validation');
  };

  const handleStartImport = async () => {
    if (!validation || validation.validRows.length === 0) return;

    // التحقق من جلسة PIN للمالك
    if (!pinActive) {
      setPendingAction(() => executeImport);
      setPinPromptOpen(true);
      return;
    }

    await executeImport();
  };

  const executeImport = async () => {
    if (!validation) return;

    setStep('progress');
    try {
      // 1. إنشاء التصنيفات المفقودة إن طلب المستخدم ذلك
      let rowsToImport = [...validation.validRows];
      if (autoCreateCategories && validation.newCategoriesToCreate.length > 0) {
        const catMap = await createMissingCategories(
          storeId,
          validation.newCategoriesToCreate
        );
        rowsToImport = rowsToImport.map((r) => {
          const catName = r.data.category_name;
          return {
            ...r,
            data: {
              ...r.data,
              category_id: catName ? catMap.get(catName) : undefined,
            },
          };
        });
      }

      // 2. التنفيذ على دفعات
      const res = await importInBatches(storeId, rowsToImport, duplicateMode, (p) => {
        setProgress(p);
      });

      setImportResult(res);
      setStep('results');
      onSuccess();
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'فشل الاستيراد.');
      setStep('validation');
    }
  };

  const onPinSuccess = async () => {
    setPinPromptOpen(false);
    if (pendingAction) {
      const act = pendingAction;
      setPendingAction(null);
      await act();
    }
  };

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title={ar.importModalTitle} maxWidth="lg">
        <div className="space-y-4" dir="rtl">
          {/* شريط خطوات المعالج */}
          <div className="flex items-center justify-between border-b border-slate-800 pb-3 text-xs font-bold text-slate-400">
            <span className={step === 'file' ? 'text-emerald-400' : ''}>{ar.selectFileStep}</span>
            <span>&larr;</span>
            <span className={step === 'mapping' ? 'text-emerald-400' : ''}>{ar.mappingStep}</span>
            <span>&larr;</span>
            <span className={step === 'validation' ? 'text-emerald-400' : ''}>{ar.validationStep}</span>
            <span>&larr;</span>
            <span className={step === 'results' ? 'text-emerald-400' : ''}>{ar.resultsStep}</span>
          </div>

          {/* الخطوة 1: اختيار الملف */}
          {step === 'file' && (
            <div className="space-y-4 py-2">
              <div
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-700 bg-slate-900/60 p-8 text-center transition hover:border-emerald-500/60 hover:bg-slate-900 cursor-pointer"
              >
                <div className="p-4 rounded-2xl bg-emerald-500/10 text-emerald-400 mb-3">
                  <Upload className="w-8 h-8" />
                </div>
                <h3 className="text-base font-bold text-white mb-1">
                  {ar.dragOrClickFile}
                </h3>
                <p className="text-xs text-slate-400 max-w-sm">
                  {ar.supportedFormats}
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx, .xls, .csv"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </div>

              {parsing && <LoadingSpinner message="جاري قراءة وتحليل محتويات الملف..." />}

              {parseError && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{parseError}</span>
                </div>
              )}

              {/* زر تحميل القالب */}
              <Card className="bg-slate-900/40 p-4 border-slate-800">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-sky-500/10 text-sky-400 shrink-0">
                      <FileSpreadsheet className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-white">{ar.templateDownloadHint}</p>
                      <p className="text-xs text-slate-400">يحتوي على كافة الأعمدة بالترتيب وأمثلة عملية للبقالة</p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={downloadTemplate}
                    icon={<Download className="w-4 h-4" />}
                  >
                    {ar.downloadTemplateBtn}
                  </Button>
                </div>
              </Card>
            </div>
          )}

          {/* الخطوة 2: معاينة وربط الأعمدة */}
          {step === 'mapping' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white">
                    {ar.fileParsedSuccess.replace('{rows}', String(rawRows.length))}
                  </h3>
                  <p className="text-xs text-slate-400">
                    {selectedFile ? `الملف: ${selectedFile.name} | ` : ''}
                    {ar.mapColumnsPrompt}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setStep('file')}
                  icon={<ArrowRight className="w-4 h-4" />}
                >
                  تغيير الملف
                </Button>
              </div>

              {/* معاينة أول 5 صفوف */}
              <div className="rounded-xl border border-slate-800 overflow-hidden">
                <div className="bg-slate-900 px-3 py-2 text-xs font-bold text-slate-400 border-b border-slate-800">
                  {ar.previewFirstRows}
                </div>
                <div className="overflow-x-auto max-h-48">
                  <table className="w-full text-xs text-right whitespace-nowrap">
                    <thead className="bg-slate-950/80 text-slate-400">
                      <tr>
                        <th className="p-2 border-b border-slate-800">#</th>
                        {rawHeaders.map((h, i) => (
                          <th key={i} className="p-2 border-b border-slate-800 font-bold text-slate-300">
                            {h || `عمود ${i + 1}`}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 text-slate-300">
                      {rawRows.slice(0, 5).map((row, rowIdx) => (
                        <tr key={rowIdx} className="hover:bg-slate-900/40">
                          <td className="p-2 text-slate-500">{rowIdx + 1}</td>
                          {rawHeaders.map((_, colIdx) => (
                            <td key={colIdx} className="p-2 max-w-[150px] truncate">
                              {row[colIdx] ?? ''}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* شبكة تحديد ربط الأعمدة */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                {[
                  { key: 'name', label: ar.colName, required: true },
                  { key: 'category', label: ar.colCategory },
                  { key: 'barcode', label: ar.colBarcode },
                  { key: 'sku', label: ar.colSku },
                  { key: 'unit', label: ar.colUnit },
                  { key: 'price', label: ar.colPrice, required: true },
                  { key: 'cost_price', label: ar.colCost },
                  { key: 'stock_quantity', label: ar.colStock },
                  { key: 'min_stock', label: ar.colMinStock },
                  { key: 'expiry_date', label: ar.colExpiry },
                ].map(({ key, label, required }) => (
                  <div key={key} className="space-y-1">
                    <label className="text-xs font-bold text-slate-300 flex items-center gap-1">
                      <span>{label}</span>
                      {required && <span className="text-rose-400">*</span>}
                    </label>
                    <select
                      className="field text-xs py-1.5"
                      value={mapping[key as keyof ColumnMapping]}
                      onChange={(e) =>
                        setMapping({
                          ...mapping,
                          [key]: parseInt(e.target.value, 10),
                        })
                      }
                    >
                      <option value="-1">{ar.unmapped}</option>
                      {rawHeaders.map((header, hIdx) => (
                        <option key={hIdx} value={hIdx}>
                          {header || `عمود ${hIdx + 1}`}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <Button
                  variant="primary"
                  onClick={runValidation}
                  disabled={mapping.name === -1 || mapping.price === -1}
                  icon={<ArrowLeft className="w-4 h-4" />}
                >
                  التالي: فحص البيانات
                </Button>
              </div>
            </div>
          )}

          {/* الخطوة 3: التحقق والتأكيد */}
          {step === 'validation' && validation && (
            <div className="space-y-4">
              {/* ملخص التحقق */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <Card className="p-3 bg-slate-900 text-center">
                  <p className="text-xs text-slate-400">إجمالي الصفوف</p>
                  <p className="text-lg font-black text-white">{validation.totalRows}</p>
                </Card>
                <Card className="p-3 bg-emerald-950/20 border-emerald-500/30 text-center">
                  <p className="text-xs text-emerald-400">صفوف صالحة</p>
                  <p className="text-lg font-black text-emerald-300">{validation.validRows.length}</p>
                </Card>
                <Card className={`p-3 text-center ${validation.invalidRows.length > 0 ? 'bg-rose-950/20 border-rose-500/30' : 'bg-slate-900'}`}>
                  <p className="text-xs text-slate-400">صفوف بها أخطاء</p>
                  <p className={`text-lg font-black ${validation.invalidRows.length > 0 ? 'text-rose-400' : 'text-slate-400'}`}>
                    {validation.invalidRows.length}
                  </p>
                </Card>
              </div>

              {/* تنبيه الباركودات المكررة في الملف */}
              {validation.duplicateBarcodesInFile.length > 0 && (
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs space-y-1">
                  <div className="flex items-center gap-2 font-bold">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{ar.duplicateBarcodesDetected.replace('{count}', String(validation.duplicateBarcodesInFile.length))}</span>
                  </div>
                  <p className="text-[11px] text-amber-200/80">
                    تم رصد باركودات مكررة لنفس الصنف داخل الملف: ({validation.duplicateBarcodesInFile.slice(0, 5).join('، ')})
                  </p>
                </div>
              )}

              {/* التصنيفات الجديدة غير المسجلة */}
              {validation.newCategoriesToCreate.length > 0 && (
                <Card className="p-3 border-sky-500/30 bg-sky-950/20 space-y-2">
                  <div className="flex items-center gap-2 text-sky-400 font-bold text-xs">
                    <FolderPlus className="w-4 h-4 shrink-0" />
                    <span>{ar.newCategoriesDetected.replace('{count}', String(validation.newCategoriesToCreate.length))}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {validation.newCategoriesToCreate.map((c, i) => (
                      <span key={i} className="px-2 py-0.5 rounded-lg bg-sky-500/20 text-sky-300 text-xs font-medium">
                        {c}
                      </span>
                    ))}
                  </div>
                  <label className="flex items-center gap-2 pt-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoCreateCategories}
                      onChange={(e) => setAutoCreateCategories(e.target.checked)}
                      className="rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-emerald-500"
                    />
                    <span className="text-xs text-slate-200 font-bold">
                      {ar.confirmCreateCategories}
                    </span>
                  </label>
                </Card>
              )}

              {/* خيار سلوك تكرار الباركود في المتجر */}
              <div className="space-y-2 pt-1">
                <label className="text-xs font-bold text-slate-300">
                  {ar.duplicateResolutionTitle}
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition ${duplicateMode === 'skip' ? 'border-emerald-500 bg-emerald-950/20 text-white' : 'border-slate-800 bg-slate-900/60 text-slate-400'}`}>
                    <input
                      type="radio"
                      name="dupMode"
                      value="skip"
                      checked={duplicateMode === 'skip'}
                      onChange={() => setDuplicateMode('skip')}
                      className="mt-0.5 text-emerald-500"
                    />
                    <div className="text-right">
                      <p className="text-xs font-bold leading-tight">{ar.skipExisting}</p>
                    </div>
                  </label>

                  <label className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition ${duplicateMode === 'update' ? 'border-emerald-500 bg-emerald-950/20 text-white' : 'border-slate-800 bg-slate-900/60 text-slate-400'}`}>
                    <input
                      type="radio"
                      name="dupMode"
                      value="update"
                      checked={duplicateMode === 'update'}
                      onChange={() => setDuplicateMode('update')}
                      className="mt-0.5 text-emerald-500"
                    />
                    <div className="text-right">
                      <p className="text-xs font-bold leading-tight">{ar.updateExisting}</p>
                    </div>
                  </label>
                </div>
              </div>

              {parseError && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
                  {parseError}
                </div>
              )}

              <div className="flex justify-between items-center pt-2 border-t border-slate-800">
                <Button variant="outline" size="sm" onClick={() => setStep('mapping')}>
                  رجوع لتعديل الأعمدة
                </Button>
                <Button
                  variant="primary"
                  onClick={handleStartImport}
                  disabled={validation.validRows.length === 0}
                  icon={<CheckCircle2 className="w-4 h-4" />}
                >
                  {ar.startImportBtn} ({validation.validRows.length} صف)
                </Button>
              </div>
            </div>
          )}

          {/* الخطوة 4: شريط التقدم والمعالجة */}
          {step === 'progress' && (
            <div className="py-8 space-y-4 text-center">
              <div className="inline-flex p-4 rounded-full bg-emerald-500/10 text-emerald-400 animate-pulse">
                <RefreshCw className="w-8 h-8 animate-spin" />
              </div>
              <h3 className="text-base font-bold text-white">{ar.importingProgress}</h3>
              <p className="text-xs text-slate-400">
                {ar.batchProgressText
                  .replace('{current}', String(progress.currentBatch))
                  .replace('{total}', String(progress.totalBatches))
                  .replace('{processed}', String(progress.processedRows))
                  .replace('{all}', String(progress.totalRows))}
              </p>

              {/* شريط التقدم */}
              <div className="w-full bg-slate-800 rounded-full h-3 overflow-hidden">
                <div
                  className="bg-emerald-500 h-full transition-all duration-300"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
              <p className="text-xs font-bold text-emerald-400">{progress.percent}%</p>
            </div>
          )}

          {/* الخطوة 5: تقرير النتائج */}
          {step === 'results' && importResult && (
            <div className="space-y-4 py-2">
              <div className="text-center space-y-1">
                <div className="inline-flex p-3 rounded-full bg-emerald-500/10 text-emerald-400 mb-2">
                  <CheckCircle2 className="w-8 h-8" />
                </div>
                <h3 className="text-lg font-bold text-white">{ar.importCompletedTitle}</h3>
              </div>

              {/* بطاقات النتائج الإحصائية */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <Card className="p-3 text-center bg-slate-900">
                  <p className="text-xs text-slate-400">{ar.newProductsAdded}</p>
                  <p className="text-xl font-black text-emerald-400">{importResult.inserted_count}</p>
                </Card>

                <Card className="p-3 text-center bg-slate-900">
                  <p className="text-xs text-slate-400">{ar.productsUpdated}</p>
                  <p className="text-xl font-black text-sky-400">{importResult.updated_count}</p>
                </Card>

                <Card className="p-3 text-center bg-slate-900">
                  <p className="text-xs text-slate-400">{ar.productsSkipped}</p>
                  <p className="text-xl font-black text-amber-400">{importResult.skipped_count}</p>
                </Card>

                <Card className="p-3 text-center bg-slate-900">
                  <p className="text-xs text-slate-400">{ar.productsRejected}</p>
                  <p className="text-xl font-black text-rose-400">{importResult.rejected_count}</p>
                </Card>
              </div>

              {/* زر تنزيل تقرير الصفوف المرفوضة إن وجدت */}
              {importResult.rejections && importResult.rejections.length > 0 && (
                <div className="p-3 rounded-xl bg-rose-950/20 border border-rose-500/30 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-rose-300 text-xs">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>توجد {importResult.rejections.length} صفوف مرفوضة أو لم يتم استيرادها.</span>
                  </div>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => downloadRejectionsReport(importResult.rejections)}
                    icon={<Download className="w-4 h-4" />}
                  >
                    {ar.downloadRejectionsBtn}
                  </Button>
                </div>
              )}

              <div className="pt-3 border-t border-slate-800 flex justify-end">
                <Button variant="primary" onClick={onClose}>
                  إغلاق ومتابعة المنتجات
                </Button>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* نافذة التحقق من رمز PIN للمالك */}
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
