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
  commerce: boolean
  analytics: boolean
  compliance: boolean
  locations: boolean
}

// ── Compliance (food safety records — requires FEATURE_COMPLIANCE) ───────────
export interface ComplianceFieldSpec {
  key: string
  label: string
  type: 'text' | 'number' | 'bool' | 'date' | 'datetime' | 'enum' | 'multiselect'
  unit?: string
  options?: string[]
  required?: boolean
}

export interface ComplianceRecordType {
  jurisdiction: string
  code: string
  label: string
  category: string | null
  tiers: string[]
  frequency: string | null
  mandatory: boolean
  field_schema: ComplianceFieldSpec[]
  critical_limit: unknown
  sort_order: number
  active: boolean
}

export interface ComplianceRecord {
  id: string
  jurisdiction: string
  record_type: string
  site_id: string | null
  entered_by: string
  created_by: string | null
  datetime: string
  result: 'pass' | 'fail' | 'na'
  data: Record<string, unknown>
  corrective_action_id: string | null
  attachment_url: string | null
  schedule_id: string | null
  voided_at: string | null
  created_at: string
  updated_at: string
}

// ── Compliance scheduling (recurring checks that surface in "Today") ─────────
export type ScheduleCadence = 'daily' | 'weekly' | 'monthly' | 'interval'

export interface ComplianceSchedule {
  id: string
  jurisdiction: string
  record_type: string
  label: string                 // operator's name, e.g. "Main chiller"
  site_id: string | null
  cadence: ScheduleCadence
  weekdays: number[]            // weekly: 0=Sun … 6=Sat (one or more days)
  day_of_month: number | null   // monthly: 1–31
  interval_days: number | null  // interval: every N days from anchor_date
  anchor_date: string | null    // interval reference date (YYYY-MM-DD)
  times_per_day: number         // how many completions are required on a due day
  active: boolean
  created_at: string
}

// A schedule that is due on a given date, with how much of it is done.
export interface ScheduleDue {
  schedule: ComplianceSchedule
  done_count: number
  remaining: number
}

// ── Real-time cooling batch (two-stage cooling monitored live) ───────────────
export type CoolingStatus = 'in_progress' | 'done' | 'discarded'
export interface CoolingBatch {
  id: string
  jurisdiction: string
  product: string
  site_id: string | null
  started_by: string
  created_by: string | null
  started_at: string          // 60°C — cooling clock starts
  reached_21_at: string | null // stage 1 complete (must be within 2h of start)
  reached_5_at: string | null  // stage 2 complete (must be within 4h of reaching 21°C)
  status: CoolingStatus
  record_id: string | null    // the finalized `cooling` compliance record
  created_at: string
}

// ── Commerce ─────────────────────────────────────────────────────────────────
export interface ProductStockLevel {
  [size: string]: number | undefined
}

export interface Product {
  id: string
  title: string
  description: string
  desc_points: string[]
  price_cents: number
  image_url: string | null
  images: string[]
  sizes: string[]
  stock_level: ProductStockLevel
  postable: boolean
  is_new: boolean
  model_size: boolean
  model_details: string[]
  active: boolean
  created_at: string
  updated_at: string
}

export type OrderPaymentStatus = 'pending' | 'paid' | 'failed'
export type FulfillmentStatus = 'pending' | 'packed' | 'fulfilled'

export interface ShippingAddress {
  line1: string
  line2?: string
  city: string
  postal_code: string
  country?: string
}

export interface OrderItem {
  product_id: string
  title: string
  price_cents: number
  quantity: number
  selected_size: string | null
}

// CartItem is an OrderItem in progress — same shape, kept separate so the
// client can add cart-only fields (e.g. image_url for display) without
// polluting the order contract.
export interface CartItem {
  product_id: string
  title: string
  price_cents: number
  quantity: number
  selected_size: string | null
  image_url?: string | null
}

export interface Order {
  id: string
  order_ref: string
  email: string
  name: string
  phone: string | null
  shipping_address: ShippingAddress
  items: OrderItem[]
  total_cents: number
  payment_intent_id: string | null
  payment_status: OrderPaymentStatus
  fulfillment_status: FulfillmentStatus
  packed_at: string | null
  packed_by: string | null
  fulfilled_at: string | null
  fulfilled_by: string | null
  created_at: string
  updated_at: string
}

export interface Enquiry {
  id: string
  enquiry_ref: string
  name: string
  email: string
  subject: string
  message: string
  created_at: string
}

// ── Analytics ─────────────────────────────────────────────────────────────────
export type AnalyticsEventType =
  | 'page_view'
  | 'product_view'
  | 'add_to_cart'
  | 'checkout_start'
  | 'order_complete'

export interface AnalyticsEvent {
  event_type: AnalyticsEventType
  session_id: string
  url: string
  referrer?: string
  product_id?: string
  meta?: Record<string, unknown>
}

export interface AnalyticsTopProduct {
  product_id: string
  title: string
  units_sold: number
  revenue_cents: number
}

export interface AnalyticsSummary {
  revenue_cents: number
  order_count: number
  unique_sessions: number
  page_views: number
  conversion_rate: number
  top_products: AnalyticsTopProduct[]
  period_start: string
  period_end: string
}

// ── Web traffic analytics (generic — any client site) ───────────────────────
export interface TimeSeriesPoint {
  date: string        // ISO date (day bucket)
  page_views: number
  visitors: number
}

export interface TopPage {
  url: string
  views: number
  visitors: number
}

export interface TopReferrer {
  referrer: string    // 'direct' when none
  count: number
}

export interface WebTrafficOverview {
  page_views: number
  unique_visitors: number
  sessions: number
  timeseries: TimeSeriesPoint[]
  top_pages: TopPage[]
  top_referrers: TopReferrer[]
  period_start: string
  period_end: string
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

// Notification recipients — source of truth is blnk_api (tenants.email_config).
// Where inbound email replies are forwarded; set by an admin at onboarding.
export interface EmailRecipients {
  notification_email: string | null
  backup_email: string | null
}

export interface OnboardingState {
  needs_org_setup: boolean   // admins only, when org isn't set up
  needs_email_setup: boolean // admins only, until a notification_email is set
  needs_personal: boolean    // any user, when their profile is incomplete
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
  email: EmailRecipients
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

// ── People core (canonical human directory, shared across modules) ──────────
export interface PersonModule {
  module: string   // e.g. 'vessel', 'compliance'
  role: string     // module-defined (vessel: 'admin' | 'manager' | 'user')
}

export interface Person {
  id: string
  user_id: string | null   // blnk_auth user id; null = login-less (no app access)
  name: string
  email: string | null
  phone: string | null
  active: boolean
  modules: PersonModule[]   // per-module membership + role, populated on reads
  created_at: string
  updated_at: string
}

// ── Helpers (pure — safe everywhere) ────────────────────────────────────────
export function hasRole(claims: Pick<BlnkTokenClaims, 'role'>, ...roles: UserRole[]): boolean {
  return roles.includes(claims.role)
}

export function isTokenExpired(claims: Pick<BlnkTokenClaims, 'exp'>, nowSeconds = Date.now() / 1000): boolean {
  return claims.exp <= nowSeconds
}
