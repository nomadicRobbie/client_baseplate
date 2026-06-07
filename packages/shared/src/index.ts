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

// ── Profile + onboarding (client_api /profile contract) ─────────────────────
export type PreferredContact = 'email' | 'phone' | 'sms' | 'in_app'

export interface ClientOrg {
  org_name: string | null
  logo_url: string | null
  brand_color: string | null
  accent_color: string | null
  support_email: string | null
  timezone: string | null
  locale: string | null
  currency: string | null
}

export interface MyUserProfile {
  contact_email: string | null
  phone: string | null
  preferred_contact: PreferredContact | null
  timezone: string | null
}

export interface OnboardingState {
  needs_org_setup: boolean   // admins only, when org isn't set up
  needs_personal: boolean    // any user, when their profile is incomplete
}

export interface TeamUser {
  id: string
  email: string
  name: string | null
  type: UserType
  role: UserRole
  active: boolean
  last_login_at: string | null
}

export interface ProfileResponse {
  org: ClientOrg | null
  me: {
    userId: string
    email: string
    name: string | null
    role: UserRole
    type: UserType
    profile: MyUserProfile | null
  }
  onboarding: OnboardingState
}

// ── Helpers (pure — safe everywhere) ────────────────────────────────────────
export function hasRole(claims: Pick<BlnkTokenClaims, 'role'>, ...roles: UserRole[]): boolean {
  return roles.includes(claims.role)
}

export function isTokenExpired(claims: Pick<BlnkTokenClaims, 'exp'>, nowSeconds = Date.now() / 1000): boolean {
  return claims.exp <= nowSeconds
}
