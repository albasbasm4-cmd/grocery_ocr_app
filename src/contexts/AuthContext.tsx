import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { isOnline } from '../lib/offlineGuard';

export type StoreRole = 'owner' | 'staff';
export interface StoreInfo { id: string; name: string; currency_code: string; currency_symbol: string }
interface AuthContextValue {
  user: User | null;
  session: Session | null;
  store: StoreInfo | null;
  role: StoreRole | null;
  pinExpiresAt: string | null;
  loading: boolean;
  refreshStore: () => Promise<void>;
  setPinExpiresAt: (value: string | null) => void;
  signOut: () => Promise<void>;
  verifyPin: (pin: string) => Promise<{ success: boolean; error?: string }>;
}
const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function loadMembership(userId: string): Promise<{ store: StoreInfo | null; role: StoreRole | null }> {
  const { data, error } = await supabase.from('store_members')
    .select('role, stores(id,name,currency_code,currency_symbol)')
    .eq('user_id', userId).limit(1).maybeSingle();
  if (error || !data) return { store: null, role: null };
  const store = Array.isArray(data.stores) ? data.stores[0] : data.stores;
  if (!store || typeof store !== 'object' || !('id' in store)) return { store: null, role: null };
  return { store: store as StoreInfo, role: data.role as StoreRole };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [store, setStore] = useState<StoreInfo | null>(null);
  const [role, setRole] = useState<StoreRole | null>(null);
  const [pinExpiresAt, setPinExpiresAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshStore = useCallback(async () => {
    if (!session?.user.id) { setStore(null); setRole(null); return; }
    const membership = await loadMembership(session.user.id);
    setStore(membership.store);
    setRole(membership.role);
  }, [session?.user.id]);

  useEffect(() => {
    let mounted = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (mounted) setSession(data.session);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (mounted) { setSession(nextSession); if (!nextSession) { setStore(null); setRole(null); setPinExpiresAt(null); } }
    });
    return () => { mounted = false; listener.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    if (!session) { setStore(null); setRole(null); setLoading(false); return; }
    void loadMembership(session.user.id).then(async (membership) => {
      if (!active) return;
      setStore(membership.store); setRole(membership.role);
      if (membership.store && membership.role === 'owner') {
        const { data: pinSession } = await supabase.from('admin_sessions').select('expires_at')
          .eq('store_id', membership.store.id).eq('user_id', session.user.id)
          .gt('expires_at', new Date().toISOString()).order('expires_at', { ascending: false }).limit(1).maybeSingle();
        if (active) setPinExpiresAt(pinSession?.expires_at ?? null);
      } else if (active) setPinExpiresAt(null);
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [session]);

  const value = useMemo<AuthContextValue>(() => ({
    user: session?.user ?? null, session, store, role, pinExpiresAt, loading,
    refreshStore,
    setPinExpiresAt: (expires: string | null) => setPinExpiresAt(expires),
    verifyPin: async (pin: string) => {
      if (!isOnline()) {
        return {
          success: false,
          error: 'التحقق من رمز PIN يتطلب اتصالاً فعالاً بالإنترنت لحماية أمان المتجر.',
        };
      }
      if (!store) return { success: false, error: 'المتجر غير موجود.' };
      const { data, error } = await supabase.rpc('verify_admin_pin', { p_store_id: store.id, p_pin: pin });
      if (error) return { success: false, error: error.message };
      const result = data as { ok?: boolean; code?: string; message?: string; expires_at?: string } | null;
      if (!result?.ok || !result.expires_at) return { success: false, error: result?.message || result?.code || 'رمز PIN غير صحيح.' };
      setPinExpiresAt(result.expires_at);
      return { success: true };
    },
    signOut: async () => {
      await supabase.auth.signOut();
      setPinExpiresAt(null);
    },
  }), [session, store, role, pinExpiresAt, loading, refreshStore]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
