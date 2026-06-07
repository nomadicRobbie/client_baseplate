import { config as loadEnv } from 'dotenv'
import { resolve } from 'node:path'
import type { FeatureFlags } from '@blnk/shared'

// Load .env by absolute path (relative to this file), before any var is read.
// Done here — the module that actually reads env — so it's independent of cwd
// and of cross-module import ordering. __dirname = apps/api/src → ../.env.
loadEnv({ path: resolve(__dirname, '../.env') })

function required(key: string): string {
  const value = process.env[key]
  if (!value) throw new Error(`Missing required environment variable: ${key}`)
  return value
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback
}

function flag(key: string): boolean {
  return process.env[key] === 'true'
}

function list(key: string): string[] {
  return (process.env[key] ?? '').split(',').map(s => s.trim()).filter(Boolean)
}

// blnkApi (email/portal/billing) validated lazily — DB-only scripts and dev runs
// without a key shouldn't fail at import. Required only in production.
let _blnkApi: { url: string; apiKey: string } | null = null

export const config = {
  env: required('NODE_ENV') as 'production' | 'development' | 'test',
  port: parseInt(optional('PORT', '4000'), 10),
  tenantSlug: required('TENANT_SLUG'),

  database: {
    url: required('DATABASE_URL'),
  },

  blnkAuth: {
    url: optional('BLNK_AUTH_URL', 'http://localhost:3100'),
  },

  get blnkApi() {
    if (!_blnkApi) {
      const isProd = process.env.NODE_ENV === 'production'
      _blnkApi = {
        url: optional('BLNK_API_URL', 'http://localhost:8000'),
        apiKey: isProd ? required('BLNK_API_KEY') : optional('BLNK_API_KEY', ''),
      }
    }
    return _blnkApi
  },

  features: {
    stripe: flag('FEATURE_STRIPE'),
    oneOff: flag('FEATURE_ONE_OFF'),
    subscriptions: flag('FEATURE_SUBSCRIPTIONS'),
  } satisfies FeatureFlags,

  allowedOrigins: list('ALLOWED_ORIGINS'),

  associations: {
    appleAppIds: list('APPLE_APP_IDS'),
    androidPackage: optional('ANDROID_PACKAGE', ''),
    androidSha256: list('ANDROID_SHA256'),
  },

  logLevel: optional('LOG_LEVEL', 'info'),
}

export type Config = typeof config
