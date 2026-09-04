import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from './auth-context';
import { useProfile } from './profile-context';
import { availableModules, MAX_PINS, type NavItem } from './nav';
import { getItem, setItem } from './storage';

// Which modules the user has pinned to the mobile tab bar. Device-local (per
// tenant) — mirrors the token store: persists on web, in-memory on native
// until expo-secure-store lands. Two pins max (the "two most used" tabs).

const keyFor = (tenant: string | null) => `blnk_pins:${tenant ?? 'default'}`;

function load(tenant: string | null): string[] {
  try {
    const raw = getItem(keyFor(tenant));
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}

// Pure: resolve the hrefs actually shown on the bar. Keep the user's stored
// picks that are still available (in their order), then fill from the
// remaining modules up to `max`. Exported for the self-check in pins.check.mjs.
export function resolvePinned(availableHrefs: string[], stored: string[], max = MAX_PINS): string[] {
  const picked = stored.filter((h) => availableHrefs.includes(h));
  const fill = availableHrefs.filter((h) => !picked.includes(h));
  return [...picked, ...fill].slice(0, Math.min(max, availableHrefs.length));
}

interface PinsState {
  modules: NavItem[];      // all pinnable modules available to this user
  pinned: NavItem[];       // the (≤2) modules currently on the bar, in order
  isPinned: (href: string) => boolean;
  toggle: (href: string) => void;
}

const PinsContext = createContext<PinsState | null>(null);

export function PinsProvider({ children }: { children: ReactNode }) {
  const { tenantSlug, features, user } = useAuth();
  const { myModules, tenantModules } = useProfile();
  const isAdmin = user?.role === 'admin' || user?.role === 'super';
  const modules = useMemo(() => availableModules(isAdmin, features, myModules, tenantModules), [isAdmin, features, myModules, tenantModules]);

  const [stored, setStored] = useState<string[]>(() => load(tenantSlug));

  const value = useMemo<PinsState>(() => {
    const availableHrefs = modules.map((m) => m.href);
    const effective = resolvePinned(availableHrefs, stored);
    const byHref = new Map<string, NavItem>(modules.map((m) => [m.href, m]));

    const persist = (next: string[]) => {
      setStored(next);
      try { setItem(keyFor(tenantSlug), JSON.stringify(next)); } catch { /* ignore */ }
    };

    const toggle = (href: string) => {
      const next = effective.includes(href)
        ? effective.filter((h) => h !== href)
        : [...effective, href];
      // Adding past the cap drops the oldest pin.
      persist(next.slice(Math.max(0, next.length - MAX_PINS)));
    };

    return {
      modules,
      pinned: effective.map((h) => byHref.get(h)!).filter(Boolean),
      isPinned: (href) => effective.includes(href),
      toggle,
    };
  }, [modules, stored, tenantSlug]);

  return <PinsContext.Provider value={value}>{children}</PinsContext.Provider>;
}

export function usePins(): PinsState {
  const ctx = useContext(PinsContext);
  if (!ctx) throw new Error('usePins must be used within PinsProvider');
  return ctx;
}
