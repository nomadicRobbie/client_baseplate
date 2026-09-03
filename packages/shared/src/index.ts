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
  asset: boolean
  schedule: boolean
  roster: boolean
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

// ── Food Control Plans (named plan entities that own schedules) ───────────────
export interface FoodControlPlan {
  id: string
  name: string
  tier: string          // FCP | NP1 | NP2 | NP3
  active: boolean
  image_url: string | null
  asset_image_url?: string | null  // populated by listPlans when an asset owns this plan
  created_by: string | null
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
  unit_id: string               // auto-generated 6-char ID, pre-filled on check completion
  site_id: string | null
  plan_id: string | null        // owning food control plan (null = unscoped / pre-migration)
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

export type ProductStatus = 'active' | 'draft' | 'archived'
export type ProductVisibility = 'public' | 'private' | 'password'
export type ProductStockStatus = 'in_stock' | 'low_stock' | 'out_of_stock' | 'backorder' | 'discontinued'
export type ProductType = 'physical' | 'digital' | 'service'

export interface ProductContent {
  subtitle?: string | null
  short_description?: string | null
  description_html?: string | null
  features?: string[]
  care_instructions?: string | null
  warranty?: string | null
  included_in_box?: string[]
}

export interface ProductMedia {
  primary_image?: string | null
  gallery?: string[]
  alt_text?: string | null
  video_url?: string | null
  model_3d_url?: string | null
  size_chart_url?: string | null
}

export interface ProductSpecifications {
  brand?: string | null
  manufacturer?: string | null
  model?: string | null
  material?: string | null
  colour?: string | null
  size?: string | null
  weight_grams?: number | null
  dimensions_cm?: { length: number; width: number; height: number } | null
  country_of_origin?: string | null
  custom_attributes?: Record<string, string>
}

export interface ProductShippingInfo {
  requires_shipping?: boolean
  shipping_weight_grams?: number | null
  shipping_class?: string | null
  package_dimensions_cm?: { length: number; width: number; height: number } | null
  free_shipping?: boolean
  hs_tariff_code?: string | null
  hazardous?: boolean
  ships_from?: string | null
  delivery_estimate?: string | null
}

export interface ProductOrganisation {
  category?: string | null
  collections?: string[]
  tags?: string[]
  related_product_ids?: string[]
  cross_sell_ids?: string[]
  upsell_ids?: string[]
}

export interface ProductSeo {
  meta_title?: string | null
  meta_description?: string | null
  canonical_url?: string | null
  og_image?: string | null
  keywords?: string[]
  structured_data_type?: string | null
}

export interface ProductSocialProof {
  review_ids?: string[]
  questions_count?: number
  badges?: string[]
}

export interface ProductPricingMeta {
  sale_start?: string | null
  sale_end?: string | null
  min_quantity?: number | null
  max_quantity?: number | null
  unit_price_measure?: string | null
}

export interface ProductDigital {
  download_url?: string | null
  file_size_mb?: number | null
  download_limit?: number | null
  expiry_days?: number | null
  licence_key_required?: boolean
}

export interface ProductCompliance {
  age_restricted?: boolean
  min_age?: number | null
  certifications?: string[]
  safety_warnings?: string | null
  returnable?: boolean
  return_window_days?: number | null
}

export interface ProductVariantOptions {
  option_names?: string[]
  options?: Record<string, string[]>
}

export interface Product {
  id: string
  // identity
  sku: string | null
  slug: string | null
  handle: string | null
  parent_id: string | null
  gtin: string | null
  mpn: string | null
  // core
  title: string
  description: string           // plain-text fallback / legacy compat
  status: ProductStatus
  visibility: ProductVisibility
  product_type: ProductType
  featured: boolean
  is_digital: boolean
  // pricing
  price_cents: number
  compare_at_price_cents: number | null
  cost_price_cents: number | null
  currency: string
  tax_class: string | null
  tax_inclusive: boolean
  // inventory
  stock_quantity: number
  stock_status: ProductStockStatus
  track_inventory: boolean
  allow_backorder: boolean
  low_stock_threshold: number | null
  warehouse_location: string | null
  lead_time_days: number | null
  restock_date: string | null
  // variants
  has_variants: boolean
  variant_options: ProductVariantOptions
  // social proof scalars (indexed for sort)
  rating_average: number | null
  rating_count: number
  // channels
  sales_channels: string[]
  available_regions: string[]
  // JSONB blobs
  content: ProductContent
  media: ProductMedia
  specifications: ProductSpecifications
  shipping_info: ProductShippingInfo
  organisation: ProductOrganisation
  seo: ProductSeo
  social_proof: ProductSocialProof
  pricing_meta: ProductPricingMeta
  digital_product: ProductDigital
  compliance: ProductCompliance
  // timestamps
  active: boolean
  published_at: string | null
  created_at: string
  updated_at: string
}

export interface ProductVariant {
  id: string
  product_id: string
  sku: string | null
  title: string | null
  option_values: Record<string, string>   // {"Size": "M", "Colour": "Black"}
  price_cents: number | null              // null = inherit from parent
  compare_at_price_cents: number | null
  cost_price_cents: number | null
  stock_quantity: number
  stock_status: ProductStockStatus
  track_inventory: boolean
  allow_backorder: boolean
  low_stock_threshold: number | null
  warehouse_location: string | null
  image_id: string | null
  weight_grams: number | null
  is_default: boolean
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
  variant_id: string | null
  title: string
  price_cents: number
  quantity: number
  selected_size: string | null   // ponytail: kept for legacy order records
}

// CartItem is an OrderItem in progress — same shape, kept separate so the
// client can add cart-only fields (e.g. image_url for display) without
// polluting the order contract.
export interface CartItem {
  product_id: string
  variant_id: string | null
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
  custom_colors: Record<string, string>
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
  avatar_url: string | null
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
  module: string   // e.g. 'asset', 'compliance'
  role: string     // module-defined (asset: 'admin' | 'manager' | 'user')
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

// ── Asset management (requires FEATURE_ASSET) ────────────────────────────────
export interface AssetFieldDef {
  key: string; label: string; type: 'text' | 'number' | 'date' | 'select'
  required?: boolean; placeholder?: string; unit?: string; options?: string[]
}
export interface AssetType { id: string; name: string; image_url: string | null; roles: string[]; fields: AssetFieldDef[] }

export interface Asset {
  id: string; asset_type_id: string | null; parent_asset_id: string | null; name: string
  mnz_number: string | null; mmsi: string | null; call_sign: string | null
  fuel_capacity: string | null; refuel_threshold: string | null
  location: string | null; condition: string | null; supplier: string | null
  date_purchased: string | null; image_url: string | null; notes: string | null; status: string
  particulars: Record<string, string | null>
  food_control_plan_id: string | null
}

export interface AssetFaultStep { id: string; note: string; kind: 'step' | 'close'; created_by: string | null; created_at: string }
export interface AssetFault {
  id: string; asset_id: string; component_id: string | null; name: string; description: string | null
  image_urls: string[]; urgency: string | null; status: string
  reported_by: string | null; reported_date: string; assigned_to: string | null
  resolution_notes: string | null; signed_by: string | null; signed_at: string | null
  steps: AssetFaultStep[]
}

export type FormFieldType = 'boolean' | 'checkbox' | 'text' | 'number' | 'date' | 'photo';
export interface FormField {
  id: string; type: FormFieldType; label: string; required: boolean;
}
export interface FormSchema { fields: FormField[] }
export type FormResponseData = Record<string, string | number | boolean | null>;

export interface AssetMaintenanceLog {
  id: string; schedule_id: string | null; fault_id: string | null; asset_id: string
  task_name: string | null; completed_date: string | null; resolves_fault: boolean; status: string
  form_data: FormResponseData | null; attachments: string[]
}

export type AssetScheduleAlert = { value: number; unit: 'hours' | 'days' | 'weeks' };
export interface AssetMaintenanceSchedule {
  id: string; asset_id: string; component_id: string | null; task_name: string
  interval_type: string | null; interval_value: string | null; initial_due_date: string | null
  weekdays: number[] | null; recurrence_end_date: string | null
  alert_days: number | null; alert_hours: string | null; alerts: AssetScheduleAlert[]; active: boolean
  task_notes: string | null; document_urls: string[]; form_schema: FormSchema | null
}

export interface AssetComponent {
  id: string; asset_id: string; parent_component_id: string | null; name: string
  category: string | null; quantity: string | null; serial_number: string | null
  model: string | null; manufacturer: string | null; install_date: string | null
  critical_component: boolean; notes: string | null; status: string
}

export interface AssetAssignment {
  id: string; person_id: string; asset_id: string; role: string | null; created_at: string
}

// A row in the "Coming up" feed — an upcoming/overdue service derived from a
// maintenance schedule's next-due date.
export interface AssetUpcomingItem {
  kind: 'maintenance'
  id: string            // schedule id
  asset_id: string
  title: string         // task name
  subtitle: string | null
  due_date: string | null   // ISO date of next due
  level: 'ok' | 'due' | 'over'
}

// ── News Feed ────────────────────────────────────────────────────────────────
export interface FeedPostComment {
  id: string
  post_id: string
  created_by: string
  author_name: string
  body: string
  created_at: string
}

export interface FeedPost {
  id: string
  created_by: string      // blnk user_id
  author_name: string
  author_image_url: string | null
  body: string
  modules: string[]       // [] = all staff; otherwise module keys the post is scoped to
  mentions: string[]      // person_ids tagged in the post
  image_urls: string[]    // reserved for future photo support
  comment_count: number
  latest_comment: { author_name: string; body: string; created_at: string } | null
  created_at: string
  expires_at: string | null
}

export interface FeedFaultData {
  id: string; asset_id: string; asset_name: string
  fault_name: string; urgency: string | null; status: string
  step_count: number
  latest_step: { note: string; created_at: string } | null
}

export interface FeedMaintenanceData {
  id: string; asset_id: string; asset_name: string
  task_name: string; due_date: string | null; level: 'ok' | 'due' | 'over'
}

export interface FeedComplianceData {
  schedule_id: string
  label: string
  record_type: string
  jurisdiction: string
  done_count: number
  remaining: number
  times_per_day: number
  due_date: string   // YYYY-MM-DD
}

export interface FeedServiceData {
  service_id: string
  name: string
  starts_at: string
  timezone: string
  facility_id: string | null
  facility_name: string | null
  status: string
  capacity: number
  assigned_count: number
  unfilled_roles: Array<{ role: string; count: number }>
  // No asset means crew cannot be worked out at all — it blocks everything
  // downstream, so the feed calls it out ahead of an unfilled-roles count.
  has_asset: boolean
}

export type FeedItemKind = 'fault' | 'maintenance' | 'post' | 'compliance' | 'service'

export interface FeedItem {
  kind: FeedItemKind
  module: string | null   // source module ('asset', 'compliance', etc.); null for org-wide posts
  created_at: string
  data: FeedFaultData | FeedMaintenanceData | FeedPost | FeedComplianceData | FeedServiceData
}

// ── Schedule (requires FEATURE_SCHEDULE) ─────────────────────────────────────
export type ServiceStatus = 'draft' | 'planned' | 'confirmed' | 'completed' | 'cancelled'
export type ServiceSubjectType = 'person' | 'asset'
export type ServiceEventType =
  | 'created' | 'rescheduled' | 'capacity_changed' | 'assigned'
  | 'unassigned' | 'cancelled' | 'completed' | 'note_added'

export interface RequiredRole { role: string; count: number }
export interface RequiredAssetType { asset_type_id: string; count: number }
export interface RecurrencePattern {
  days: number[];          // 0=Sun..6=Sat, time: 'HH:MM'
  time: string;
  startDate?: string;      // YYYY-MM-DD — generation range start
  endDate?: string | null; // YYYY-MM-DD — null = indefinite
}

export interface ServiceTemplate {
  id: string
  name: string
  duration_minutes: number
  default_capacity: number
  facility_id: string | null
  facility_name: string | null
  timezone: string
  required_roles: RequiredRole[]
  required_asset_types: RequiredAssetType[]
  recurrence: RecurrencePattern | null
  default_asset_id: string | null
  active: boolean
  created_at: string
  created_by: string | null
  updated_at: string
}

export interface ScheduledService {
  id: string
  template_id: string | null
  name: string
  starts_at: string
  ends_at: string
  timezone: string
  facility_id: string | null
  facility_name: string | null
  capacity: number
  required_roles: RequiredRole[]
  status: ServiceStatus
  cancellation_reason: string | null
  external_ref: string | null
  notes: string
  version: number
  created_at: string
  created_by: string | null
  updated_at: string
  updated_by: string | null
}

export interface ServiceAssignment {
  id: string
  service_id: string
  subject_type: ServiceSubjectType
  subject_id: string
  role: string | null
  assigned_at: string
  assigned_by: string | null
  removed_at: string | null
  removed_by: string | null
  roster_id: string | null
  confirmed_at: string | null
  declined_at: string | null
}

export interface ServiceEvent {
  id: string
  service_id: string
  event_type: ServiceEventType
  payload: Record<string, unknown>
  actor_id: string | null
  occurred_at: string
}

export interface ManifestPerson {
  assignment_id: string
  person_id: string
  name: string
  role: string | null
}

export interface ManifestAsset {
  assignment_id: string
  asset_id: string
  name: string
  role: string | null
}

export interface ServiceManifest {
  service: ScheduledService
  crew: ManifestPerson[]
  assets: ManifestAsset[]
}

export interface AvailabilitySlot {
  service_id: string
  starts_at: string
  capacity: number
  assigned_count: number
  remaining: number
}

// ── Roster (requires FEATURE_ROSTER) ─────────────────────────────────────────
// Crew declare only the days they CANNOT work — no row means available.
// 'planned' is leave booked ahead; 'sick' is called in against a live roster.
export type UnavailabilityKind = 'planned' | 'sick'

export interface PersonUnavailability {
  id: string
  person_id: string
  person_name: string      // joined from people — the admin view lists by name
  date: string             // YYYY-MM-DD
  kind: UnavailabilityKind
  reason: string | null
  created_at: string
  created_by: string | null
}

// Two states only: a published roster stays editable, so there is no third
// status implying it is locked.
export type RosterStatus = 'draft' | 'published'

export interface RosterRules {
  min_rest_hours: number
  max_consecutive_days: number
  max_daily_hours: number
  updated_at: string
  updated_by: string | null
}

export interface Roster {
  id: string
  week_start: string       // YYYY-MM-DD, always a Monday
  status: RosterStatus
  generated_at: string
  published_at: string | null
  deleted_at: string | null
  created_at: string
  created_by: string | null
}

export interface RosterShift {
  id: string
  roster_id: string
  service_id: string
  person_id: string
  person_name: string      // joined
  asset_id: string | null  // the asset this person crews — why they were picked
  asset_name: string | null
  role: string | null
  rule_override: boolean
  confirmed_at: string | null
  declined_at: string | null
  created_at: string
}

// One service in a roster week, with whoever is on it. `required` is the crew
// count the service asks for; `shortfall` is how many of those went unfilled.
export interface RosterServiceRow {
  service_id: string
  name: string
  starts_at: string
  ends_at: string
  timezone: string
  facility_id: string | null
  facility_name: string | null
  status: ServiceStatus
  has_asset: boolean
  required: number
  shortfall: number
  gap_reason: string | null
  shifts: RosterShift[]
}

export interface RosterDetail {
  roster: Roster
  services: RosterServiceRow[]
}

// A shift where someone declined but hasn't been removed — needs cover.
export interface OpenShift {
  assignment_id: string
  service_id: string
  service_name: string
  starts_at: string
  ends_at: string
  timezone: string
  facility_id: string | null
  facility_name: string | null
  declined_person_name: string
  role: string | null
}

// A person the generator could put on a service, and the asset that qualifies them.
export interface EligibleCrew {
  person_id: string
  name: string
  asset_id: string
  asset_name: string
  role: string | null
  blocked_reason: string | null  // null = eligible; set when returned via skipRules override
}

// ── Helpers (pure — safe everywhere) ────────────────────────────────────────
export function hasRole(claims: Pick<BlnkTokenClaims, 'role'>, ...roles: UserRole[]): boolean {
  return roles.includes(claims.role)
}

export function isTokenExpired(claims: Pick<BlnkTokenClaims, 'exp'>, nowSeconds = Date.now() / 1000): boolean {
  return claims.exp <= nowSeconds
}
