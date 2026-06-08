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

// The client's blnk platform subscription (blnk bills the client). Surfaced to
// admins only. Assembled by blnk_api from blnk's own Stripe account.
export interface BlnkBillingStatus {
  status: string                 // active | trialing | past_due | incomplete | canceled | none
  plan_name: string | null
  current_period_end: string | null
  next_invoice_cents: number | null
  currency: string | null
  card_last4: string | null
  cancel_at_period_end: boolean
}

export interface Plan {
  price_id: string
  product_name: string
  unit_amount: number     // cents
  currency: string
  interval: string        // month | year | week | day
}

export interface ClientSubscription {
  id: string
  stripe_subscription_id: string
  stripe_price_id: string
  status: string
  current_period_end: string | null
  cancel_at_period_end: boolean
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
