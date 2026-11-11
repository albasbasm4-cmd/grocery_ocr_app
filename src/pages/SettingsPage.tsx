import { useEffect, useState, useCallback } from 'react';
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
  Copy,
  Share2,
  RefreshCw,
  UserPlus,
  ShieldAlert,
  ArrowRightLeft,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { FullBackupModal } from '../components/settings/FullBackupModal';
import { PinPromptModal } from '../components/PinPromptModal';

interface StoreJoinRequestItem {
  id: string;
  user_id: string;
  requester_email: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired';
  created_at: string;
}

interface MyJoinRequestItem {
  id: string;
  store_id: string;
  store_name: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired';
  created_at: string;
}

interface AuditLogItem {
  id: string;
  actor_email?: string | null;
  action: string;
  target_user_id?: string | null;
  details?: Record<string, unknown> | null;
  created_at: string;
}

export default function SettingsPage() {
  const { store, stores, switchStore, signOut, refreshStore, hasActivePinSession } = useAuth();
  const { isOwner } = usePermissions();
  const { numberFormat, setNumberFormat, formatCurrency } = useSettings();
  const { success, error, showToast } = useToast();
  const navigate = useNavigate();

  const [backupModalOpen, setBackupModalOpen] = useState<boolean>(false);
  const [showLogoutModal, setShowLogoutModal] = useState<boolean>(false);
  const [pendingSalesCount, setPendingSalesCount] = useState<number>(0);
  const [isSyncingBeforeLogout, setIsSyncingBeforeLogout] = useState<boolean>(false);

  // بيانات المتجر
  const [storeName, setStoreName] = useState('');
  const [currencyCode, setCurrencyCode] = useState('');
  const [currencySymbol, setCurrencySymbol] = useState('');
  const [isSavingStore, setIsSavingStore] = useState(false);

  // رمز الانضمام للمالك
  const [joinCode, setJoinCode] = useState<string>(store?.join_code || '');
  const [isRegeneratingCode, setIsRegeneratingCode] = useState(false);

  // طلبات الانضمام للمالك
  const [storeRequests, setStoreRequests] = useState<StoreJoinRequestItem[]>([]);
  const [selectedRequest, setSelectedRequest] = useState<StoreJoinRequestItem | null>(null);
  const [approvePermission, setApprovePermission] = useState<'read' | 'write'>('read');
  const [approveCanSell, setApproveCanSell] = useState(false);
  const [isApproving, setIsApproving] = useState(false);

  // طلبات الانضمام الخاصة بي
  const [myRequests, setMyRequests] = useState<MyJoinRequestItem[]>([]);
  const [inputJoinCode, setInputJoinCode] = useState('');
  const [isSendingJoin, setIsSendingJoin] = useState(false);

  // سجل التدقيق للمالك
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [showAuditLogs, setShowAuditLogs] = useState(false);

  // حماية PIN
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [pinAction, setPinAction] = useState<null | (() => Promise<void>)>(null);

  // مغادرة المتجر للموظف
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);

  useEffect(() => {
    setStoreName(store?.name ?? '');
    setCurrencyCode(store?.currency_code ?? '');
    setCurrencySymbol(store?.currency_symbol ?? '');
    setJoinCode(store?.join_code ?? '');
  }, [store]);

  const loadStoreData = useCallback(async () => {
    if (!store?.id) return;
    if (isOwner) {
      // جلب طلبات الانضمام المعلقة
      const { data: reqs } = await supabase.rpc('get_store_join_requests', { p_store_id: store.id });
      if (reqs && Array.isArray(reqs)) {
        setStoreRequests(reqs as StoreJoinRequestItem[]);
      }

      // جلب رمز الانضمام إذا لم يكن في المتجر
      const { data: st } = await supabase.from('stores').select('join_code').eq('id', store.id).maybeSingle();
      if (st?.join_code) {
        setJoinCode(st.join_code);
      }
    }

    // جلب طلباتي الخاصة
    const { data: myReqs } = await supabase.rpc('get_my_join_requests');
    if (myReqs && Array.isArray(myReqs)) {
      setMyRequests(myReqs as MyJoinRequestItem[]);
    }
  }, [store?.id, isOwner]);

  useEffect(() => {
    void loadStoreData();
  }, [loadStoreData]);

  const loadAuditLogs = async () => {
    if (!store?.id || !isOwner) return;
    const { data } = await supabase.rpc('get_store_audit_log', { p_store_id: store.id, p_limit: 20 });
    if (data && Array.isArray(data)) {
      setAuditLogs(data as AuditLogItem[]);
    }
  };

  const executeWithPin = (actionFn: () => Promise<void>) => {
    if (hasActivePinSession) {
      void actionFn();
    } else {
      setPinAction(() => actionFn);
      setPinModalOpen(true);
    }
  };

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

  const handleCopyJoinCode = async () => {
    if (!joinCode) return;
    await navigator.clipboard.writeText(joinCode);
    showToast(ar.joinCodeCopied, 'success');
  };

  const handleShareJoinCode = async () => {
    if (!joinCode) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: `رمز الانضمام لمتجر ${store?.name}`,
          text: `انضم إلى متجر ${store?.name} باستخدام الرمز: ${joinCode}`,
        });
        return;
      } catch {
        // Fallback to copy
      }
    }
    await handleCopyJoinCode();
  };

  const handleRegenerateCode = () => {
    executeWithPin(async () => {
      if (!store?.id) return;
      setIsRegeneratingCode(true);
      const { data, error: rpcErr } = await supabase.rpc('regenerate_store_join_code', {
        p_store_id: store.id,
      });
      setIsRegeneratingCode(false);
      if (rpcErr || !data) {
        showToast(rpcErr?.message || ar.genericError, 'error');
        return;
      }
      const res = data as { success?: boolean; join_code?: string; error?: string };
      if (!res.success || !res.join_code) {
        showToast(res.error || ar.genericError, 'error');
        return;
      }
      setJoinCode(res.join_code);
      showToast('تمت إعادة توليد رمز الانضمام بنجاح.', 'success');
      await refreshStore();
    });
  };

  const handleApproveRequest = () => {
    if (!selectedRequest) return;
    executeWithPin(async () => {
      setIsApproving(true);
      const { data, error: rpcErr } = await supabase.rpc('approve_join_request', {
        p_request_id: selectedRequest.id,
        p_permission: approvePermission,
        p_can_sell: approveCanSell,
      });
      setIsApproving(false);
      if (rpcErr || !data) {
        showToast(rpcErr?.message || ar.genericError, 'error');
        return;
      }
      const res = data as { success?: boolean; error?: string };
      if (!res.success) {
        showToast(res.error || ar.genericError, 'error');
        return;
      }

      // إشعار المتقدم بالبريد
      void supabase.functions.invoke('notify-join-request', {
        body: { action: 'notify_decision', request_id: selectedRequest.id },
      });

      showToast('تم قبول طلب الانضمام بنجاح.', 'success');
      setSelectedRequest(null);
      await loadStoreData();
    });
  };

  const handleRejectRequest = async (requestId: string, block = false) => {
    const { data, error: rpcErr } = await supabase.rpc('reject_join_request', {
      p_request_id: requestId,
      p_block_requester: block,
    });
    if (rpcErr || !data) {
      showToast(rpcErr?.message || ar.genericError, 'error');
      return;
    }
    const res = data as { success?: boolean; error?: string };
    if (!res.success) {
      showToast(res.error || ar.genericError, 'error');
      return;
    }

    // إشعار المتقدم بالبريد
    void supabase.functions.invoke('notify-join-request', {
      body: { action: 'notify_decision', request_id: requestId },
    });

    showToast('تم رفض طلب الانضمام.', 'info');
    await loadStoreData();
  };

  const handleSendJoinRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = inputJoinCode.trim().toUpperCase();
    if (!clean) return;
    setIsSendingJoin(true);
    const { data, error: rpcErr } = await supabase.rpc('request_join_store', {
      p_join_code: clean,
    });
    setIsSendingJoin(false);
    if (rpcErr || !data) {
      showToast(rpcErr?.message || ar.genericError, 'error');
      return;
    }
    const res = data as { success?: boolean; request_id?: string; error?: string; store_name?: string };
    if (!res.success || !res.request_id) {
      showToast(res.error || ar.genericError, 'error');
      return;
    }

    // إرسال إشعار للمالك
    void supabase.functions.invoke('notify-join-request', {
      body: { action: 'notify_owner', request_id: res.request_id },
    });

    showToast('تم إرسال طلب الانضمام بنجاح وبانتظار موافقة المالك.', 'success');
    setInputJoinCode('');
    await loadStoreData();
  };

  const handleCancelMyRequest = async (reqId: string) => {
    const { error: rpcErr } = await supabase.rpc('cancel_join_request', { p_request_id: reqId });
    if (rpcErr) {
      showToast(rpcErr.message, 'error');
      return;
    }
    showToast(ar.joinRequestCancelled, 'info');
    await loadStoreData();
  };

  const handleLeaveStore = async () => {
    if (!store?.id || isOwner) return;
    setIsLeaving(true);
    const { data, error: rpcErr } = await supabase.rpc('leave_store', { p_store_id: store.id });
    setIsLeaving(false);
    setShowLeaveModal(false);
    if (rpcErr || !data) {
      showToast(rpcErr?.message || ar.genericError, 'error');
      return;
    }
    const res = data as { success?: boolean; error?: string };
    if (!res.success) {
      showToast(res.error || ar.genericError, 'error');
      return;
    }
    showToast(ar.leftStoreSuccess, 'success');
    await refreshStore();
    navigate('/');
  };

  const handleLogout = async () => {
    setShowLogoutModal(false);
    await signOut();
    navigate('/login', { replace: true });
  };

  const displayCurrencySymbol = store?.currency_symbol || ar.defaultCurrencySymbol;

  return (
    <div className="space-y-4" dir="rtl">
      {/* 1. تبديل المتاجر والمتاجر التي أنتمي إليها */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400">
                <Store className="w-5 h-5" />
              </div>
              <div>
                <CardTitle>{ar.switchStore}</CardTitle>
                <p className="text-xs text-slate-400 mt-0.5">
                  المتاجر التي تنتمي إليها بحسابك الحالي
                </p>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {stores.map((s) => (
            <div
              key={s.id}
              className={`p-3 rounded-xl border flex items-center justify-between transition ${
                s.id === store?.id
                  ? 'border-emerald-500 bg-emerald-500/10 text-white font-bold'
                  : 'border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center gap-2">
                <Store className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="text-sm truncate max-w-[180px]">{s.name}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded-md font-bold ${
                    s.role === 'owner'
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-sky-500/20 text-sky-300'
                  }`}
                >
                  {s.role === 'owner' ? ar.owner : ar.staff} ({s.permission === 'write' ? 'كتابة' : 'قراءة'})
                </span>
              </div>

              {s.id !== store?.id ? (
                <Button
                  size="sm"
                  variant="outline"
                  icon={<ArrowRightLeft className="w-3.5 h-3.5" />}
                  onClick={() => void switchStore(s.id)}
                >
                  تبديل
                </Button>
              ) : (
                <span className="text-xs text-emerald-400 flex items-center gap-1 font-semibold">
                  <Check className="w-3.5 h-3.5" /> الحالي
                </span>
              )}
            </div>
          ))}

          {/* زر مغادرة المتجر للموظف */}
          {!isOwner && store && (
            <div className="pt-2">
              <Button
                variant="danger"
                size="sm"
                className="w-full text-xs"
                onClick={() => setShowLeaveModal(true)}
              >
                {ar.leaveStore}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 2. رمز الانضمام للمتجر (للمالك فقط) */}
      {isOwner && (
        <Card className="border-emerald-500/30 bg-emerald-950/20">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400">
                  <UserPlus className="w-5 h-5" />
                </div>
                <div>
                  <CardTitle>{ar.joinCode}</CardTitle>
                  <p className="text-xs text-slate-400 mt-0.5">
                    شاركه مع موظفيك ليتمكنوا من طلب الانضمام لمتجرك
                  </p>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-950 border border-emerald-500/40">
              <span className="text-2xl font-mono font-bold tracking-widest text-emerald-400">
                {joinCode || '------'}
              </span>
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleCopyJoinCode()}
                  icon={<Copy className="w-3.5 h-3.5" />}
                  title="نسخ"
                >
                  نسخ
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleShareJoinCode()}
                  icon={<Share2 className="w-3.5 h-3.5" />}
                  title="مشاركة"
                >
                  مشاركة
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleRegenerateCode}
                  isLoading={isRegeneratingCode}
                  icon={<RefreshCw className="w-3.5 h-3.5" />}
                  title="إعادة التوليد"
                >
                  تغيير
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 3. طلبات الانضمام المعلقة للمتجر (للمالك فقط) */}
      {isOwner && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <CardTitle>{ar.storeJoinRequests}</CardTitle>
                  <p className="text-xs text-slate-400 mt-0.5">الطلبات المرسلة للانضمام إلى هذا المتجر</p>
                </div>
              </div>
              {storeRequests.length > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-xs font-bold">
                  {storeRequests.length}
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {storeRequests.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-2">{ar.noJoinRequests}</p>
            ) : (
              storeRequests.map((req) => (
                <div
                  key={req.id}
                  className="p-3 rounded-xl border border-slate-800 bg-slate-950/60 flex flex-wrap items-center justify-between gap-2"
                >
                  <div>
                    <p className="text-sm font-semibold text-white">{req.requester_email}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {new Date(req.created_at).toLocaleDateString('ar-SA')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => {
                        setSelectedRequest(req);
                        setApprovePermission('read');
                        setApproveCanSell(false);
                      }}
                    >
                      {ar.approve}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => void handleRejectRequest(req.id, false)}
                    >
                      {ar.reject}
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      )}

      {/* 4. الانضمام إلى متجر آخر وطلباتي المعلقة (للجميع) */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-sky-500/10 text-sky-400">
              <UserPlus className="w-5 h-5" />
            </div>
            <div>
              <CardTitle>{ar.joinStore}</CardTitle>
              <p className="text-xs text-slate-400 mt-0.5">{ar.joinStoreDesc}</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <form onSubmit={handleSendJoinRequest} className="flex gap-2">
            <input
              type="text"
              value={inputJoinCode}
              onChange={(e) => setInputJoinCode(e.target.value.toUpperCase())}
              placeholder={ar.joinCodePlaceholder}
              maxLength={10}
              className="field flex-1 font-mono uppercase text-center"
            />
            <Button type="submit" isLoading={isSendingJoin} disabled={!inputJoinCode.trim()}>
              {ar.sendJoinRequest}
            </Button>
          </form>

          {/* طلباتي */}
          {myRequests.length > 0 && (
            <div className="pt-2 border-t border-slate-800 space-y-2">
              <span className="text-xs font-semibold text-slate-400">{ar.myJoinRequests}:</span>
              {myRequests.map((req) => (
                <div
                  key={req.id}
                  className="p-2.5 rounded-xl border border-slate-800 bg-slate-950/40 flex items-center justify-between text-xs"
                >
                  <div>
                    <span className="font-bold text-white">{req.store_name}</span>
                    <span className="mx-1.5 text-slate-600">•</span>
                    <span
                      className={`font-semibold ${
                        req.status === 'pending'
                          ? 'text-amber-400'
                          : req.status === 'approved'
                          ? 'text-emerald-400'
                          : 'text-rose-400'
                      }`}
                    >
                      {req.status === 'pending'
                        ? ar.statusPending
                        : req.status === 'approved'
                        ? ar.statusApproved
                        : ar.statusRejected}
                    </span>
                  </div>
                  {req.status === 'pending' && (
                    <button
                      type="button"
                      onClick={() => void handleCancelMyRequest(req.id)}
                      className="text-rose-400 hover:text-rose-300 text-[11px] underline"
                    >
                      {ar.cancelJoinRequest}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 5. بيانات المتجر والعملة */}
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
                  {store?.currency_code || ar.defaultCurrencyCode} ({store?.currency_symbol || ar.defaultCurrencySymbol})
                </span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* 6. تنسيق الأرقام */}
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
              <span className="text-xs font-sans opacity-80">{"\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669\u0660"}</span>
            </button>
          </div>

          <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800/80 flex items-center justify-between text-xs">
            <span className="text-slate-400">{ar.numberPreview}:</span>
            <span className="font-bold text-white text-sm">
              {formatCurrency(149.75, displayCurrencySymbol)}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* 7. إعدادات المالك والأمان (للمالك فقط) */}
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

            <Button
              variant="outline"
              className="w-full justify-between"
              onClick={() => {
                setShowAuditLogs(!showAuditLogs);
                if (!showAuditLogs) void loadAuditLogs();
              }}
              icon={<ShieldAlert className="w-4 h-4 text-emerald-400" />}
            >
              <span>{ar.auditLog}</span>
            </Button>

            {/* عرض سجل التدقيق */}
            {showAuditLogs && (
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2 text-xs">
                <p className="font-bold text-slate-300">{ar.auditLogDesc}</p>
                {auditLogs.length === 0 ? (
                  <p className="text-slate-500">{ar.noAuditLogs}</p>
                ) : (
                  auditLogs.map((log) => (
                    <div key={log.id} className="p-2 border-b border-slate-800/80 last:border-0">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-bold text-emerald-400">{log.action}</span>
                        <span className="text-slate-500">
                          {new Date(log.created_at).toLocaleString('ar-SA')}
                        </span>
                      </div>
                      <p className="text-slate-400 mt-0.5">
                        {log.actor_email ?? 'مستخدم'}
                      </p>
                    </div>
                  ))
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 8. الذكاء الاصطناعي والتصدير */}
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

      {/* 9. الفواتير والعملاء */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400">
              <Receipt className="w-5 h-5" />
            </div>
            <CardTitle>{ar.invoicesAndAccounts}</CardTitle>
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

      {/* 10. النسخ الاحتياطي (للمالك) */}
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

      {/* 11. معلومات التطبيق */}
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

      {/* 12. تسجيل الخروج */}
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

      {/* نافذة قبول طلب الانضمام وتحديد الصلاحيات */}
      <Modal
        isOpen={Boolean(selectedRequest)}
        onClose={() => setSelectedRequest(null)}
        title={ar.approveJoinTitle}
      >
        {selectedRequest && (
          <div className="space-y-4 text-xs" dir="rtl">
            <p className="text-slate-300">
              المتقدم: <span className="font-bold text-white">{selectedRequest.requester_email}</span>
            </p>

            <div>
              <label className="block font-semibold text-slate-300 mb-1.5">
                {ar.selectPermission}
              </label>
              <select
                value={approvePermission}
                onChange={(e) => setApprovePermission(e.target.value as 'read' | 'write')}
                className="field text-xs"
              >
                <option value="read">{ar.permRead}</option>
                <option value="write">{ar.permWrite}</option>
              </select>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <input
                type="checkbox"
                id="approve_can_sell"
                checked={approveCanSell}
                onChange={(e) => setApproveCanSell(e.target.checked)}
                className="h-4 w-4 rounded accent-emerald-500"
              />
              <label htmlFor="approve_can_sell" className="font-semibold text-slate-300 cursor-pointer">
                {ar.allowSelling} (الافتراضي: غير مسموح)
              </label>
            </div>

            <div className="flex gap-2 pt-3">
              <Button
                className="flex-1"
                isLoading={isApproving}
                onClick={handleApproveRequest}
              >
                تأكيد القبول (يتطلب PIN)
              </Button>
              <Button variant="outline" onClick={() => setSelectedRequest(null)}>
                {ar.cancel}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* نافذة تأكيد مغادرة المتجر للموظف */}
      <Modal
        isOpen={showLeaveModal}
        onClose={() => setShowLeaveModal(false)}
        title={ar.leaveStore}
        description={ar.leaveStoreConfirm}
        footer={
          <>
            <Button variant="outline" onClick={() => setShowLeaveModal(false)}>
              {ar.cancel}
            </Button>
            <Button variant="danger" isLoading={isLeaving} onClick={() => void handleLeaveStore()}>
              {ar.leaveStore}
            </Button>
          </>
        }
      >
        <p className="text-xs text-slate-400 leading-relaxed">
          عند المغادرة ستفقد حق الوصول إلى متجر <span className="text-white font-bold">{store?.name}</span>، وستحتاج إلى تقديم طلب انضمام جديد للعودة.
        </p>
      </Modal>

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
                <span>{ar.unsyncedInvoicesWarning}</span>
              </div>
              <p>{ar.unsyncedInvoicesCountMsg(pendingSalesCount)}</p>
              <p className="text-slate-300">{ar.logoutUnsyncedWarningDesc}</p>
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
                {isSyncingBeforeLogout ? ar.syncingNow : ar.syncBeforeLogoutBtn}
              </Button>
            )}
            <p className="text-xs text-slate-400">{ar.signOutConfirmBody}</p>
          </div>
        ) : (
          <p className="text-sm text-slate-300">{ar.signOutConfirmBody}</p>
        )}
      </Modal>

      {/* نافذة النسخ الاحتياطي الكامل */}
      <FullBackupModal
        isOpen={backupModalOpen}
        onClose={() => setBackupModalOpen(false)}
        storeId={store?.id || ''}
        storeName={store?.name || 'store'}
      />

      {/* نافذة إدخال الـ PIN للعمليات الحساسة */}
      <PinPromptModal
        isOpen={pinModalOpen}
        onClose={() => {
          setPinModalOpen(false);
          setPinAction(null);
        }}
        onSuccess={() => {
          if (pinAction) {
            void pinAction();
            setPinAction(null);
          }
        }}
      />
    </div>
  );
}
