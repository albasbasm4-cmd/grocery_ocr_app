import { ar } from '../i18n/ar';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { isOnline } from '../lib/offlineGuard';

export type StoreRole = 'owner' | 'staff';
export type StorePermission = 'read' | 'write';

export interface StoreInfo {
  id: string;
  name: string;
  currency_code: string;
  currency_symbol: string;
  join_code?: string;
  role: StoreRole;
  permission: StorePermission;
  can_sell: boolean;
  is_active: boolean;
}

export interface AuthContextValue {
  user: User | null;
  session: Session | null;
  store: StoreInfo | null;
  activeStore: StoreInfo | null;
  currentStore: StoreInfo | null;
  stores: StoreInfo[];
  role: StoreRole | null;
  permission: StorePermission;
  canSell: boolean;
  isOwner: boolean;
  isStaff: boolean;
  hasActivePinSession: boolean;
  pinExpiresAt: string | null;
  loading: boolean;
  refreshStore: () => Promise<void>;
  switchStore: (storeId: string) => Promise<void>;
  setPinExpiresAt: (value: string | null) => void;
  signOut: () => Promise<void>;
  verifyPin: (pin: string) => Promise<{ success: boolean; error?: string }>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const CURRENT_STORE_KEY = 'grocery_current_store_id';

interface StoreMemberRow {
  role: string;
  permission: string | null;
  can_sell: boolean | null;
  is_active: boolean;
  stores: {
    id: string;
    name: string;
    currency_code?: string | null;
    currency_symbol?: string | null;
    join_code?: string | null;
  } | {
    id: string;
    name: string;
    currency_code?: string | null;
    currency_symbol?: string | null;
    join_code?: string | null;
  }[] | null;
}

async function loadMemberships(userId: string): Promise<StoreInfo[]> {
  const { data, error } = await supabase
    .from('store_members')
    .select('role, permission, can_sell, is_active, stores(id, name, currency_code, currency_symbol, join_code)')
    .eq('user_id', userId)
    .eq('is_active', true);

  if (error || !data || !Array.isArray(data)) return [];

  const list: StoreInfo[] = [];
  for (const item of (data as unknown as StoreMemberRow[])) {
    const s = Array.isArray(item.stores) ? item.stores[0] : item.stores;
    if (s && typeof s === 'object' && 'id' in s && s.id) {
      list.push({
        id: s.id,
        name: s.name,
        currency_code: s.currency_code || 'SAR',
        currency_symbol: s.currency_symbol || 'ر.س',
        join_code: s.join_code || undefined,
        role: (item.role === 'owner' ? 'owner' : 'staff'),
        permission: (item.permission === 'write' ? 'write' : 'read'),
        can_sell: item.can_sell ?? true,
        is_active: Boolean(item.is_active),
      });
    }
  }
  return list;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [stores, setStores] = useState<StoreInfo[]>([]);
  const [currentStoreId, setCurrentStoreId] = useState<string | null>(() => localStorage.getItem(CURRENT_STORE_KEY));
  const [pinExpiresAt, setPinExpiresAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const activeStore: StoreInfo | null = useMemo(() => {
    if (stores.length === 0) return null;
    if (currentStoreId) {
      const match = stores.find((s) => s.id === currentStoreId);
      if (match) return match;
    }
    return stores[0] ?? null;
  }, [stores, currentStoreId]);

  const refreshStore = useCallback(async () => {
    if (!session?.user.id) {
      setStores([]);
      return;
    }
    const list = await loadMemberships(session.user.id);
    setStores(list);
  }, [session?.user.id]);

  useEffect(() => {
    let mounted = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (mounted) setSession(data.session);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (mounted) {
        setSession(nextSession);
        if (!nextSession) {
          setStores([]);
          setPinExpiresAt(null);
          localStorage.removeItem(CURRENT_STORE_KEY);
        }
      }
    });
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    if (!session?.user.id) {
      setStores([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    void loadMemberships(session.user.id).then((list) => {
      if (!mounted) return;
      setStores(list);
      setLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, [session?.user.id]);

  useEffect(() => {
    if (activeStore?.id && activeStore.id !== currentStoreId) {
      setCurrentStoreId(activeStore.id);
      localStorage.setItem(CURRENT_STORE_KEY, activeStore.id);
    }
  }, [activeStore?.id, currentStoreId]);

  const switchStore = useCallback(
    async (storeId: string) => {
      if (storeId === currentStoreId) return;
      setCurrentStoreId(storeId);
      localStorage.setItem(CURRENT_STORE_KEY, storeId);
      setPinExpiresAt(null);
      // مسح كاش TanStack Query بالكامل عند تبديل المتجر لضمان عدم خلط بيانات متجرين أبداً
      queryClient.clear();
    },
    [currentStoreId, queryClient]
  );

  const signOut = useCallback(async () => {
    localStorage.removeItem(CURRENT_STORE_KEY);
    await supabase.auth.signOut();
    setSession(null);
    setStores([]);
    setPinExpiresAt(null);
    queryClient.clear();
  }, [queryClient]);

  const verifyPin = useCallback(
    async (pin: string): Promise<{ success: boolean; error?: string }> => {
      if (!isOnline()) return { success: false, error: ar.pinRequiresOnline };
      if (!activeStore) return { success: false, error: ar.storeNotFound };
      const { data, error } = await supabase.rpc('verify_admin_pin', {
        p_store_id: activeStore.id,
        p_pin: pin,
      });
      if (error || !data) return { success: false, error: error?.message || ar.invalidPin };
      const res = data as { success?: boolean; error?: string; expires_at?: string };
      if (!res.success) return { success: false, error: res.error || ar.invalidPin };
      setPinExpiresAt(res.expires_at || new Date(Date.now() + 10 * 60 * 1000).toISOString());
      return { success: true };
    },
    [activeStore]
  );

  const role: StoreRole | null = activeStore?.role ?? null;
  const permission: StorePermission = activeStore?.permission ?? 'read';
  const canSell: boolean = activeStore?.can_sell ?? true;
  const isOwner = role === 'owner';
  const isStaff = role === 'staff';
  const hasActivePinSession = isOwner && Boolean(pinExpiresAt && new Date(pinExpiresAt).getTime() > Date.now());

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      session,
      store: activeStore,
      activeStore,
      currentStore: activeStore,
      stores,
      role,
      permission,
      canSell,
      isOwner,
      isStaff,
      hasActivePinSession,
      pinExpiresAt,
      loading,
      refreshStore,
      switchStore,
      setPinExpiresAt,
      signOut,
      verifyPin,
    }),
    [
      session,
      activeStore,
      stores,
      role,
      permission,
      canSell,
      isOwner,
      isStaff,
      hasActivePinSession,
      pinExpiresAt,
      loading,
      refreshStore,
      switchStore,
      signOut,
      verifyPin,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
