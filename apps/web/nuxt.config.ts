// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',

  // Per-route rendering rules — clients override as needed.
  // Default: SSG (nuxt generate). Switch individual routes to SSR in your clone.
  routeRules: {
    '/**': { prerender: true },
  },

  runtimeConfig: {
    public: {
      // Client API base URL — set via NUXT_PUBLIC_API_URL
      apiUrl: process.env.NUXT_PUBLIC_API_URL ?? 'http://localhost:4000',

      // Feature flags — mirror FEATURE_* in apps/api/.env exactly.
      // Set via NUXT_PUBLIC_FEATURE_COMMERCE, NUXT_PUBLIC_FEATURE_ANALYTICS.
      features: {
        commerce:  process.env.NUXT_PUBLIC_FEATURE_COMMERCE  === 'true',
        analytics: process.env.NUXT_PUBLIC_FEATURE_ANALYTICS === 'true',
      },
    },
  },

  imports: {
    // Nuxt scans composables/ one level deep by default. Explicit dirs for each
    // module subdirectory so their composables are auto-imported app-wide.
    dirs: ['composables/modules/commerce', 'composables/modules/analytics'],
  },

  typescript: {
    strict: true,
    typeCheck: false, // run via `nuxt typecheck` separately
  },
})
