// Returns the feature flags exposed by the runtime config. Both modules and
// pages use this to guard against calling disabled functionality.
export function useFeatures() {
  const config = useRuntimeConfig()
  return config.public.features as { commerce: boolean; analytics: boolean }
}
