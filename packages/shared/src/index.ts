// @blnk/shared — isomorphic types + contracts shared by apps/api and apps/app.
// MUST run in Node, React Native, and the browser. No environment-specific imports.

// ── Auth ────────────────────────────────────────────────────────────────────
// Claims carried by a blnk_auth-issued access token. apps/api verifies these via
// JWKS; apps/app reads them to drive UI (role-based screens, etc.).
export type UserType = 'end_user' | 'blnk_client'
export type UserRole = 'member' | 'admin' | 'super'

export interface BlnkTokenClaims {
  sub: string          // user id
  tid: string          // tenant id
  tslug: string        // tenant slug
  type: UserType
  role: UserRole
  passkey: boolean     // was this session authenticated with a passkey
  iss: 'blnk-auth'
  iat: number
  exp: number
}

// The authenticated user as apps/api exposes it to handlers and the frontend.
export interface BlnkUser {
  userId: string
  tenantId: string
  tenantSlug: string
  type: UserType
  role: UserRole
  passkey: boolean
}

// ── Standard error envelope (matches blnk_api / blnk_auth) ──────────────────
export interface ErrorResponse {
  error: {
    code: string
    message: string
    status: number
    request_id?: string
  }
}

// ── Token pair returned by the auth flows (proxied from blnk_auth) ──────────
export interface TokenPair {
  access_token: string
  refresh_token: string
  expires_in: number
}

// ── Feature flags — which hot-swap modules this client has enabled ──────────
export interface FeatureFlags {
  stripe: boolean
  oneOff: boolean
  subscriptions: boolean
}

// ── Helpers (pure — safe everywhere) ────────────────────────────────────────
export function hasRole(claims: Pick<BlnkTokenClaims, 'role'>, ...roles: UserRole[]): boolean {
  return roles.includes(claims.role)
}

export function isTokenExpired(claims: Pick<BlnkTokenClaims, 'exp'>, nowSeconds = Date.now() / 1000): boolean {
  return claims.exp <= nowSeconds
}
