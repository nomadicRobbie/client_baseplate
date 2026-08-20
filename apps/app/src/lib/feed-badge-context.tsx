import { createContext, useCallback, useContext, useState } from 'react';
import { getItem, setItem } from './storage';

const LAST_READ_KEY = 'feed_last_read_at';

interface FeedBadgeCtx {
  hasUnseen: boolean;
  markSeen: () => void;
  noteLatestAt: (iso: string | null) => void;
}

const Ctx = createContext<FeedBadgeCtx>({ hasUnseen: false, markSeen: () => {}, noteLatestAt: () => {} });

export function FeedBadgeProvider({ children }: { children: React.ReactNode }) {
  // Synchronous read on first render — storage.native uses expo-sqlite sync API.
  const [lastReadAt, setLastReadAt] = useState<string | null>(() => getItem(LAST_READ_KEY));
  const [latestAt, setLatestAt] = useState<string | null>(null);

  const markSeen = useCallback(() => {
    const now = new Date().toISOString();
    setLastReadAt(now);
    setItem(LAST_READ_KEY, now);
  }, []);

  const noteLatestAt = useCallback((iso: string | null) => {
    setLatestAt(iso);
  }, []);

  const hasUnseen = !!latestAt && (!lastReadAt || latestAt > lastReadAt);

  return (
    <Ctx.Provider value={{ hasUnseen, markSeen, noteLatestAt }}>
      {children}
    </Ctx.Provider>
  );
}

export const useFeedBadge = () => useContext(Ctx);
