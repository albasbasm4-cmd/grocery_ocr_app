import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getOutboxStats, processOutbox, syncLocalData } from '../services/offlineSyncService';
import { usePermissions } from '../hooks/usePermissions';
import { useSettings } from '../contexts/SettingsContext';
import { useToast } from '../contexts/ToastContext';
import { ar } from '../i18n/ar';
import { supabase } from '../lib/supabase';
import {
  Store,
  Binary,
  KeyRound,
  Users,
  Receipt,
  Download,
  LogOut,
  Smartphone,
  Shield,
  Check,
  Bot,
  FileCode2,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { FullBackupModal } from '../components/settings/FullBackupModal';

export default function SettingsPage() {
  const { store, signOut, refreshStore } = useAuth();
  const { isOwner } = usePermissions();
  const { numberFormat, setNumberFormat, formatCurrency } = useSettings();
  const { success, error } = useToast();
  const navigate = useNavigate();

  const [backupModalOpen, setBackupModalOpen] = useState<boolean>(false);
  const [showLogoutModal, setShowLogoutModal] = useState<boolean>(false);
  const [pendingSalesCount, setPendingSalesCount] = useState<number>(0);
  const [isSyncingBeforeLogout, setIsSyncingBeforeLogout] = useState<boolean>(false);
  const [storeName, setStoreName] = useState('');
  const [currencyCode, setCurrencyCode] = useState('');
  const [currencySymbol, setCurrencySymbol] = useState('');
  const [isSavingStore, setIsSavingStore] = useState(false);

  useEffect(() => {
    setStoreName(store?.name ?? '');
    setCurrencyCode(store?.currency_code ?? '');
    setCurrencySymbol(store?.currency_symbol ?? '');
  }, [store]);

  const handleSaveStore = async () => {
    if (!store?.id || !isOwner) return;
    setIsSavingStore(true);
    const { error: updateError } = await supabase.from('stores').update({
      name: storeName.trim(),
      currency_code: currencyCode.trim().toUpperCase(),
      currency_symbol: currencySymbol.trim(),
    }).eq('id', store.id);
    setIsSavingStore(false);
    if (updateError) {
      error(ar.storeSaveFailed);
      return;
    }
    await refreshStore();
    success(ar.storeSaved);
  };

  const handleLogout = async () => {
    setShowLogoutModal(false);
    await signOut();
    navigate('/login', { replace: true });
  };

  const displayCurrencySymbol = store?.currency_symbol || 'ر.س';

  return (
    <div className="space-y-4" dir="rtl">
      {/* 1. بيانات المتجر والعملة */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400">
              <Store className="w-5 h-5" />
            </div>
            <CardTitle>{ar.storeInfo}</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {isOwner ? (
            <>
              <label className="block text-xs font-semibold text-slate-300">
                {ar.storeNameLabel}
                <input
                  className="field mt-1"
                  value={storeName}
                  onChange={(event) => setStoreName(event.target.value)}
                  maxLength={100}
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-xs font-semibold text-slate-300">
                  {ar.currencyCodeLabel}
                  <input
                    className="field mt-1 text-left"
                    dir="ltr"
                    value={currencyCode}
                    onChange={(event) => setCurrencyCode(event.target.value.toUpperCase())}
                    maxLength={3}
                  />
                </label>
                <label className="block text-xs font-semibold text-slate-300">
                  {ar.currencyLabel}
                  <input
                    className="field mt-1"
                    value={currencySymbol}
                    onChange={(event) => setCurrencySymbol(event.target.value)}
                    maxLength={10}
                  />
                </label>
              </div>
              <Button
                className="w-full"
                onClick={() => void handleSaveStore()}
                isLoading={isSavingStore}
              >
                {ar.save}
              </Button>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-sm">
                <span className="text-slate-400">{ar.storeNameLabel}</span>
                <span className="font-bold text-white">{store?.name || '—'}</span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-sm">
                <span className="text-slate-400">{ar.currencyLabel}</span>
                <span className="font-bold text-emerald-400">
                  {store?.currency_code || 'SAR'} ({store?.currency_symbol || 'ر.س'})
                </span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* 2. تنسيق أرقام الواجهة (لاتينية vs هندية) */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-sky-500/10 text-sky-400">
              <Binary className="w-5 h-5" />
            </div>
            <div>
              <CardTitle>{ar.numberFormatTitle}</CardTitle>
              <p className="text-xs text-slate-400 mt-0.5">{ar.numberFormatDesc}</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setNumberFormat('latin')}
              className={`p-3 rounded-xl border text-center transition flex flex-col items-center gap-1.5 ${
                numberFormat === 'latin'
                  ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300 font-bold'
                  : 'border-slate-800 bg-slate-950/40 text-slate-400 hover:text-slate-200'
              }`}
            >
              <div className="flex items-center gap-1">
                {numberFormat === 'latin' && <Check className="w-4 h-4 text-emerald-400" />}
                <span className="text-sm">{ar.latinNumbers}</span>
              </div>
              <span className="text-xs font-mono opacity-80">1234567890</span>
            </button>

            <button
              type="button"
              onClick={() => setNumberFormat('arabic')}
              className={`p-3 rounded-xl border text-center transition flex flex-col items-center gap-1.5 ${
                numberFormat === 'arabic'
                  ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300 font-bold'
                  : 'border-slate-800 bg-slate-950/40 text-slate-400 hover:text-slate-200'
              }`}
            >
              <div className="flex items-center gap-1">
                {numberFormat === 'arabic' && <Check className="w-4 h-4 text-emerald-400" />}
                <span className="text-sm">{ar.arabicNumbers}</span>
              </div>
              <span className="text-xs font-sans opacity-80">١٢٣٤٥٦٧٨٩٠</span>
            </button>
          </div>

          {/* معاينة حية للتنسيق المختار */}
          <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800/80 flex items-center justify-between text-xs">
            <span className="text-slate-400">{ar.numberPreview}:</span>
            <span className="font-bold text-white text-sm">
              {formatCurrency(149.75, displayCurrencySymbol)}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* أدوات الذكاء الاصطناعي والتصدير البرمجي */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400">
              <Bot className="w-5 h-5" />
            </div>
            <CardTitle>{ar.aiChatTitle}</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button
            variant="outline"
            className="w-full justify-between"
            onClick={() => navigate('/ai-chat')}
            icon={<Bot className="w-4 h-4 text-emerald-400" />}
          >
            <span>{ar.aiChatTitle}</span>
          </Button>
          {isOwner && (
            <Button
              variant="outline"
              className="w-full justify-between"
              onClick={() => navigate('/java-export')}
              icon={<FileCode2 className="w-4 h-4 text-indigo-400" />}
            >
              <span>{ar.javaExportTitle}</span>
            </Button>
          )}
        </CardContent>
      </Card>

      {/* إدارة المبيعات والفواتير والعملاء */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400">
              <Receipt className="w-5 h-5" />
            </div>
            <CardTitle>الفواتير والحسابات</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button
            variant="outline"
            className="w-full justify-between"
            onClick={() => navigate('/sales')}
            icon={<Receipt className="w-4 h-4 text-emerald-400" />}
          >
            <span>{ar.invoicesTitle}</span>
          </Button>

          <Button
            variant="outline"
            className="w-full justify-between"
            onClick={() => navigate('/customers')}
            icon={<Users className="w-4 h-4 text-amber-400" />}
          >
            <span>{ar.customersTitle}</span>
          </Button>
        </CardContent>
      </Card>

      {/* 3. إعدادات المالك والأمان (للمالك فقط) */}
      {isOwner && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400">
                <Shield className="w-5 h-5" />
              </div>
              <CardTitle>{ar.securitySettings}</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button
              variant="outline"
              className="w-full justify-between"
              onClick={() => navigate('/change-pin')}
              icon={<KeyRound className="w-4 h-4 text-amber-400" />}
            >
              <span>{ar.changePin}</span>
            </Button>

            <Button
              variant="outline"
              className="w-full justify-between"
              onClick={() => navigate('/staff')}
              icon={<Users className="w-4 h-4 text-sky-400" />}
            >
              <span>{ar.staffManagement}</span>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* 4. النسخ الاحتياطي وتصدير البيانات */}
      {isOwner && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400">
                <Download className="w-5 h-5" />
              </div>
              <div>
                <CardTitle>{ar.dataManagement}</CardTitle>
                <p className="text-xs text-slate-400 mt-0.5">{ar.exportBackupDesc}</p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => setBackupModalOpen(true)}
              icon={<Download className="w-4 h-4 text-indigo-400" />}
            >
              {ar.exportBackup}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* 5. معلومات التطبيق ونظام أندرويد */}
      <Card className="bg-slate-950/40 border-slate-800/80">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-emerald-500/10 text-emerald-400">
            <Smartphone className="w-6 h-6" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-white">
              {ar.appName} (v{ar.version})
            </h4>
            <p className="text-xs text-slate-400 mt-0.5">{ar.androidAppInfo}</p>
          </div>
        </div>
      </Card>

      {/* 6. زر تسجيل الخروج */}
      <Button
        variant="danger"
        className="w-full"
        onClick={async () => {
          if (store?.id) {
            const stats = await getOutboxStats(store.id);
            setPendingSalesCount(stats.pendingCount + stats.needsReviewCount + stats.syncingCount);
          }
          setShowLogoutModal(true);
        }}
        icon={<LogOut className="w-4 h-4" />}
      >
        {ar.signOut}
      </Button>

      {/* نافذة تأكيد تسجيل الخروج */}
      <Modal
        isOpen={showLogoutModal}
        onClose={() => setShowLogoutModal(false)}
        title={ar.signOutConfirmTitle}
        description={ar.signOutConfirmDesc}
        footer={
          <>
            <Button variant="outline" onClick={() => setShowLogoutModal(false)}>
              {ar.cancel}
            </Button>
            <Button variant="danger" onClick={() => void handleLogout()}>
              {ar.signOut}
            </Button>
          </>
        }
      >
        {pendingSalesCount > 0 ? (
          <div className="space-y-3">
            <div className="p-3 bg-amber-500/15 border border-amber-500/30 rounded-xl text-amber-200 text-xs leading-relaxed space-y-1.5">
              <div className="font-bold flex items-center gap-1.5 text-amber-300 text-sm">
                <span>⚠️ تحذير: فواتير غير مُزامنة!</span>
              </div>
              <p>
                توجد <span className="font-extrabold underline">{pendingSalesCount}</span> عملية بيع محفوظة محلياً ولم تتم مزامنتها مع الخادم بعد.
              </p>
              <p className="text-slate-300">
                تسجيل الخروج الآن لن يحذف هذه البيانات من جهازك، لكن لن تظهر في تقارير الخادم حتى تتم المزامنة. يفضل المزامنة أولاً قبل الخروج.
              </p>
            </div>
            {navigator.onLine && (
              <Button
                variant="outline"
                size="sm"
                disabled={isSyncingBeforeLogout}
                className="w-full text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10 text-xs"
                onClick={async () => {
                  if (!store?.id) return;
                  setIsSyncingBeforeLogout(true);
                  try {
                    await syncLocalData(store.id);
                    await processOutbox(store.id);
                    const stats = await getOutboxStats(store.id);
                    setPendingSalesCount(stats.pendingCount + stats.needsReviewCount + stats.syncingCount);
                  } finally {
                    setIsSyncingBeforeLogout(false);
                  }
                }}
              >
                {isSyncingBeforeLogout ? 'جارٍ المزامنة...' : '🔄 مزامنة الفواتير الآن قبل الخروج'}
              </Button>
            )}
            <p className="text-xs text-slate-400">
              {ar.signOutConfirmBody}
            </p>
          </div>
        ) : (
          <p className="text-sm text-slate-300">
            {ar.signOutConfirmBody}
          </p>
        )}
      </Modal>

      {/* نافذة النسخ الاحتياطي الكامل */}
      <FullBackupModal
        isOpen={backupModalOpen}
        onClose={() => setBackupModalOpen(false)}
        storeId={store?.id || ''}
        storeName={store?.name || 'store'}
      />
    </div>
  );
}
