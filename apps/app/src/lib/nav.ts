import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';
import type { FeatureFlags } from '@blnk/shared';

// Single source of truth for the dashboard's navigable destinations. The
// desktop sidebar shows all visible items; the mobile tab bar shows a curated
// subset (home + account + the user's two pinned modules — see pins-context).

export type IconName = ComponentProps<typeof Ionicons>['name'];
export type FeatureKey = keyof FeatureFlags;

// 'home' = the Library landing. 'module' = a blnk module the user can pin.
// 'account'/'admin' = settings-side screens reached from Account on mobile.
export type NavGroup = 'home' | 'module' | 'account' | 'admin';

export type NavHref =
  | '/dashboard' | '/dashboard/account' | '/dashboard/billing' | '/dashboard/people'
  | '/dashboard/settings' | '/dashboard/analytics' | '/dashboard/locations' | '/dashboard/compliance'
  | '/dashboard/commerce' | '/dashboard/vessel';

export type NavItem = {
  label: string;
  href: NavHref;
  icon: IconName;
  group: NavGroup;
  adminOnly?: boolean;
  feature?: FeatureKey;
};

export const NAV: NavItem[] = [
  { label: 'Library', href: '/dashboard', icon: 'library-outline', group: 'home' },
  { label: 'Store', href: '/dashboard/commerce', icon: 'storefront-outline', group: 'module', adminOnly: true, feature: 'commerce' },
  { label: 'Analytics', href: '/dashboard/analytics', icon: 'bar-chart-outline', group: 'module', adminOnly: true, feature: 'analytics' },
  { label: 'Locations', href: '/dashboard/locations', icon: 'location-outline', group: 'module', adminOnly: true, feature: 'locations' },
  { label: 'Food compliance', href: '/dashboard/compliance', icon: 'clipboard-outline', group: 'module', feature: 'compliance' },
  { label: 'Asset Manager', href: '/dashboard/vessel', icon: 'cube-outline', group: 'module', feature: 'vessel' },
  { label: 'Billing', href: '/dashboard/billing', icon: 'card-outline', group: 'account', adminOnly: true, feature: 'stripe' },
  { label: 'Account', href: '/dashboard/account', icon: 'person-outline', group: 'account' },
  { label: 'People', href: '/dashboard/people', icon: 'people-outline', group: 'admin', adminOnly: true },
  { label: 'Settings', href: '/dashboard/settings', icon: 'settings-outline', group: 'admin', adminOnly: true },
];

// Items this user is allowed to see (role + enabled feature flags + module access).
// `myModules` = the module keys this person is assigned to in People. Admins bypass
// module gating (they run the tenant); members reach a module only if assigned.
export function visibleNav(isAdmin: boolean, features: FeatureFlags | null, myModules?: string[] | null): NavItem[] {
  return NAV.filter((i) => {
    if (i.adminOnly && !isAdmin) return false;
    if (i.feature && !features?.[i.feature]) return false;
    if (!isAdmin && i.group === 'module' && i.feature && !(myModules ?? []).includes(i.feature)) return false;
    return true;
  });
}

// The pinnable modules, in declaration order (used for the mobile bar + Library).
export function availableModules(isAdmin: boolean, features: FeatureFlags | null, myModules?: string[] | null): NavItem[] {
  return visibleNav(isAdmin, features, myModules).filter((i) => i.group === 'module');
}

export const HOME_HREF: NavHref = '/dashboard';
export const ACCOUNT_HREF: NavHref = '/dashboard/account';
export const MAX_PINS = 2;
