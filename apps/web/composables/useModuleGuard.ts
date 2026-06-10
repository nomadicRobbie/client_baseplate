// Guards called at the top of every module composable.
// Dev: throws with a clear message. Prod: silent — the composable returns safely.

function guard(enabled: boolean, name: string): void {
  if (enabled) return
  const msg = `[blnk] ${name} module is not enabled for this client (NUXT_PUBLIC_FEATURE_${name.toUpperCase()}=false)`
  if (import.meta.dev) throw new Error(msg)
}

export function assertCommerceEnabled(): void {
  const { commerce } = useFeatures()
  guard(commerce, 'commerce')
}

export function assertAnalyticsEnabled(): void {
  const { analytics } = useFeatures()
  guard(analytics, 'analytics')
}
