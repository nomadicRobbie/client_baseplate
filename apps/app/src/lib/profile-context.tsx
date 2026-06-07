import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { ProfileResponse } from '@blnk/shared';
import { getProfile } from './api';
import { getAccessToken } from './session';

interface ProfileState {
  data: ProfileResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const ProfileContext = createContext<ProfileState | null>(null);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<ProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const token = getAccessToken();
    if (!token) { setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      setData(await getProfile(token));
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  return (
    <ProfileContext.Provider value={{ data, loading, error, refresh: load }}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile(): ProfileState {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error('useProfile must be used within ProfileProvider');
  return ctx;
}
