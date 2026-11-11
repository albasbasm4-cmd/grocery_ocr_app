import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { UserCheck, UserX, Shield, ShoppingCart, Trash2, Plus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { PinPromptModal } from '../components/PinPromptModal';
import { ar } from '../i18n/ar';

interface StaffRow {
  user_id: string;
  role: string;
  permission: 'read' | 'write';
  can_sell: boolean;
  is_active: boolean;
  email: string | null;
}

export default function StaffManagementPage() {
  const { store, hasActivePinSession } = useAuth();
  const { showToast } = useToast();

  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [permission, setPermission] = useState<'read' | 'write'>('read');
  const [canSell, setCanSell] = useState(true);

  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  // إدارة نافذة PIN للعمليات الحساسة
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<null | (() => Promise<void>)>(null);

  const callFunction = useCallback(
    async (body: Record<string, unknown>) => {
      const { data, error: invokeError } = await supabase.functions.invoke('manage-staff', {
        body: { store_id: store?.id, ...body },
      });
      if (invokeError) throw new Error(invokeError.message);
      if (data?.error) throw new Error(data.error as string);
      return data as { staff?: StaffRow[] };
    },
    [store?.id]
  );

  const load = useCallback(async () => {
    if (!store) return;
    try {
      const data = await callFunction({ action: 'list' });
      setStaff(data.staff ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : ar.genericError);
    }
  }, [callFunction, store]);

  useEffect(() => {
    void load();
  }, [load]);

  const executeWithPin = (actionFn: () => Promise<void>) => {
    if (hasActivePinSession) {
      void actionFn();
    } else {
      setPendingAction(() => actionFn);
      setPinModalOpen(true);
    }
  };

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    if (!email.trim() || !password || password.length < 8) {
      setError(!email.trim() ? ar.emailRequired : ar.weakPassword);
      return;
    }

    executeWithPin(async () => {
      setBusy(true);
      try {
        await callFunction({
          action: 'create',
          email: email.trim(),
          password,
          permission,
          can_sell: canSell,
        });
        setEmail('');
        setPassword('');
        setPermission('read');
        setCanSell(true);
        setNotice(ar.staffCreated);
        showToast(ar.staffCreated, 'success');
        await load();
      } catch (err) {
        const msg = err instanceof Error ? err.message : ar.genericError;
        setError(msg);
        showToast(msg, 'error');
      } finally {
        setBusy(false);
      }
    });
  }

  function handleUpdatePermission(userId: string, newPerm: 'read' | 'write', newCanSell: boolean) {
    executeWithPin(async () => {
      setBusy(true);
      try {
        await callFunction({
          action: 'update_permission',
          user_id: userId,
          permission: newPerm,
          can_sell: newCanSell,
        });
        showToast(ar.saved, 'success');
        await load();
      } catch (err) {
        showToast(err instanceof Error ? err.message : ar.genericError, 'error');
      } finally {
        setBusy(false);
      }
    });
  }

  function handleAction(userId: string, actionName: 'deactivate' | 'remove') {
    executeWithPin(async () => {
      setError('');
      setNotice('');
      setBusy(true);
      try {
        await callFunction({ action: actionName, user_id: userId });
        const msg = actionName === 'deactivate' ? ar.staffDeactivated : ar.staffRemoved;
        setNotice(msg);
        showToast(msg, 'success');
        await load();
      } catch (err) {
        const msg = err instanceof Error ? err.message : ar.genericError;
        setError(msg);
        showToast(msg, 'error');
      } finally {
        setBusy(false);
      }
    });
  }

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-8" dir="rtl">
      <Link to="/settings" className="text-sm text-emerald-300">
        ← {ar.navSettings}
      </Link>
      <h1 className="mt-4 text-2xl font-bold">{ar.staffManagement}</h1>
      <p className="mt-2 text-sm text-slate-400">{ar.securityNote}</p>

      {/* نموذج إضافة موظف جديد */}
      <form onSubmit={submitCreate} className="mt-6 space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-5">
        <h2 className="font-semibold text-white flex items-center gap-2">
          <Plus className="h-5 w-5 text-emerald-400" />
          {ar.addStaff}
        </h2>
        <label className="block text-sm">
          {ar.email}
          <input
            className="field mt-2"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="staff@example.com"
          />
        </label>
        <label className="block text-sm">
          {ar.temporaryPassword}
          <input
            className="field mt-2"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            placeholder="••••••••"
          />
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              {ar.selectPermission}
            </label>
            <select
              value={permission}
              onChange={(e) => setPermission(e.target.value as 'read' | 'write')}
              className="field"
            >
              <option value="read">{ar.permRead}</option>
              <option value="write">{ar.permWrite}</option>
            </select>
          </div>

          <div className="flex items-center gap-2 pt-6">
            <input
              type="checkbox"
              id="new_can_sell"
              checked={canSell}
              onChange={(e) => setCanSell(e.target.checked)}
              className="h-4 w-4 rounded accent-emerald-500"
            />
            <label htmlFor="new_can_sell" className="text-xs font-semibold text-slate-300 cursor-pointer">
              {ar.allowSelling}
            </label>
          </div>
        </div>

        <button className="button-primary" disabled={busy}>
          {busy ? ar.loading : ar.add}
        </button>
      </form>

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-4 rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-300">
          {notice}
        </p>
      )}

      {/* قائمة الموظفين */}
      <section className="mt-8 space-y-3">
        <h2 className="font-semibold text-white">{ar.staffList}</h2>
        {staff.length === 0 ? (
          <p className="text-sm text-slate-500">{ar.noStaff}</p>
        ) : (
          staff.map((member) => (
            <article
              key={member.user_id}
              className="space-y-3 rounded-2xl border border-slate-700 bg-slate-900 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium text-white">{member.email ?? member.user_id}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {member.is_active ? (
                      <span className="inline-flex items-center gap-1 text-emerald-400">
                        <UserCheck className="h-3 w-3" /> {ar.active}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-rose-400">
                        <UserX className="h-3 w-3" /> {ar.inactive}
                      </span>
                    )}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {member.is_active && (
                    <button
                      disabled={busy}
                      className="button-secondary text-xs"
                      onClick={() => handleAction(member.user_id, 'deactivate')}
                    >
                      {ar.deactivate}
                    </button>
                  )}
                  <button
                    disabled={busy}
                    className="button-danger text-xs p-2"
                    title={ar.remove}
                    onClick={() => handleAction(member.user_id, 'remove')}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* عناصر التحكم بالصلاحيات */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-800 text-xs">
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-slate-400 shrink-0" />
                  <span className="text-slate-400">الصلاحية:</span>
                  <select
                    value={member.permission}
                    onChange={(e) =>
                      handleUpdatePermission(
                        member.user_id,
                        e.target.value as 'read' | 'write',
                        member.can_sell
                      )
                    }
                    className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white"
                  >
                    <option value="read">قراءة فقط</option>
                    <option value="write">كتابة وتعديل</option>
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <ShoppingCart className="h-4 w-4 text-slate-400 shrink-0" />
                  <span className="text-slate-400">البيع:</span>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={member.can_sell}
                      onChange={(e) =>
                        handleUpdatePermission(
                          member.user_id,
                          member.permission,
                          e.target.checked
                        )
                      }
                      className="h-3.5 w-3.5 rounded accent-emerald-500"
                    />
                    <span className={member.can_sell ? 'text-emerald-400' : 'text-slate-500'}>
                      {member.can_sell ? 'مسموح' : 'غير مسموح'}
                    </span>
                  </label>
                </div>
              </div>
            </article>
          ))
        )}
      </section>

      <PinPromptModal
        isOpen={pinModalOpen}
        onClose={() => {
          setPinModalOpen(false);
          setPendingAction(null);
        }}
        onSuccess={() => {
          if (pendingAction) {
            void pendingAction();
            setPendingAction(null);
          }
        }}
      />
    </main>
  );
}
