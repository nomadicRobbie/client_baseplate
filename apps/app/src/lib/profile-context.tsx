import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { ProfileResponse } from '@blnk/shared';
import { getProfile, getMyPerson, getBlnkBilling } from './api';
import { getAccessToken } from './session';

interface ProfileState {
  data: ProfileResponse | null;
  myModules: string[];        // module keys this user is assigned to in People
  tenantModules: string[] | null; // Stripe-entitled module keys (null = not fetched / fail open)
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const ProfileContext = createContext<ProfileState | null>(null);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<ProfileResponse | null>(null);
  const [myModules, setMyModules] = useState<string[]>([]);
  const [tenantModules, setTenantModules] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const token = getAccessToken();
    if (!token) { setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const [profile, person, billing] = await Promise.all([
        getProfile(token),
        getMyPerson(token),
        getBlnkBilling(token).catch(() => null), // fail open — nav shows all if billing unreachable
      ]);
      setData(profile);
      setMyModules(person.person?.modules.map((m) => m.module) ?? []);
      setTenantModules(billing ? billing.modules : null);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  return (
    <ProfileContext.Provider value={{ data, myModules, tenantModules, loading, error, refresh: load }}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile(): ProfileState {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error('useProfile must be used within ProfileProvider');
  return ctx;
}
