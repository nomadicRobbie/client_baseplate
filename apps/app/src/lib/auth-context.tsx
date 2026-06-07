import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { BlnkUser, FeatureFlags } from '@blnk/shared';
import { me } from './api';
import { getAccessToken, clearSession } from './session';

interface MeResponse {
  user: BlnkUser;
  tenant_slug: string;
  features: FeatureFlags;
}

interface AuthState {
  user: BlnkUser | null;
  tenantSlug: string | null;
  features: FeatureFlags | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<BlnkUser | null>(null);
  const [tenantSlug, setTenantSlug] = useState<string | null>(null);
  const [features, setFeatures] = useState<FeatureFlags | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const token = getAccessToken();
    if (!token) { setUser(null); setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const data = await me(token) as MeResponse;
      setUser(data.user);
      setTenantSlug(data.tenant_slug);
      setFeatures(data.features);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      clearSession();
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const signOut = () => { clearSession(); setUser(null); setTenantSlug(null); setFeatures(null); };

  return (
    <AuthContext.Provider value={{ user, tenantSlug, features, loading, error, refresh: load, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
