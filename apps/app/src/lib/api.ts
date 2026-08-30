import { router } from 'expo-router';
import type { TokenPair, ProfileResponse, TeamUser, Person, ClientSubscription, WebTrafficOverview, ComplianceRecordType, ComplianceRecord, ComplianceSchedule, ScheduleDue, CoolingBatch, FoodControlPlan, Product, ProductVariant, Asset, AssetType, AssetFieldDef, AssetFault, AssetFaultStep, AssetMaintenanceLog, AssetMaintenanceSchedule, AssetUpcomingItem, AssetScheduleAlert, AssetComponent, AssetAssignment, FeedItem, FeedPost, FeedPostComment, FormSchema, FormResponseData, ServiceTemplate, ScheduledService, ServiceAssignment, ServiceManifest, AvailabilitySlot } from '@blnk/shared';
import { getAccessToken, getRefreshToken, setTokens, clearSession } from './session';

// The frontend talks ONLY to client_api. client_api proxies auth to blnk_auth
// and verifies tokens — the app never sees blnk_auth directly.

// ponytail: Hermes's built-in fetch doesn't understand RN's {uri,name,type} FormData
// trick. XHR still goes through the old RN networking stack that handles it natively.
function nativeMultipartUpload(url: string, token: string, form: FormData): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.onload = () => resolve(new Response(xhr.responseText, { status: xhr.status }));
    xhr.onerror = () => reject(new TypeError('Network request failed'));
    xhr.send(form);
  });
}

function compressWebImage(blob: Blob): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const maxW = 1200;
      const scale = img.width > maxW ? maxW / img.width : 1;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('Compression failed')), 'image/jpeg', 0.7);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')); };
    img.src = url;
  });
}

async function uploadImageMultipart(
  endpoint: string,
  token: string,
  fileOrUri: Blob | string,
  filename: string,
): Promise<Response> {
  const doUpload = async (tok: string) => {
    const form = new FormData();
    if (typeof document === 'undefined') {
      form.append('file', { uri: fileOrUri as string, name: filename, type: 'image/jpeg' } as unknown as Blob);
      return nativeMultipartUpload(endpoint, tok, form);
    }
    // fileOrUri may be a File/Blob (first pick) or a blob: URL string (retry path)
    const blob = typeof fileOrUri === 'string'
      ? await fetch(fileOrUri).then(r => r.blob())
      : fileOrUri as Blob;
    const compressed = await compressWebImage(blob);
    form.append('file', compressed, filename);
    return fetch(endpoint, { method: 'POST', headers: { authorization: `Bearer ${tok}` }, body: form });
  };
  let res = await doUpload(token);
  if (res.status === 401) {
    if (await trySilentRefresh()) {
      res = await doUpload(getAccessToken() ?? token);
    } else {
      throw new Error('Your session expired — please sign in again.');
    }
  }
  return res;
}

export const API = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';
export const TENANT = process.env.EXPO_PUBLIC_TENANT_SLUG ?? 'ting-test';

interface ReqOpts {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string;
  _retried?: boolean; // internal: guards the single silent-refresh retry
}

// Access tokens live 15 min; refresh tokens 7 days. When an authenticated call
// 401s we silently exchange the refresh token for a new pair and retry once.
// Direct fetch (not req) so it can't recurse. Shared promise collapses
// concurrent 401s (e.g. parallel page-load calls) into one refresh request.
let _refreshPromise: Promise<boolean> | null = null;
async function trySilentRefresh(): Promise<boolean> {
  if (_refreshPromise) return _refreshPromise;
  _refreshPromise = (async () => {
    const rt = getRefreshToken();
    if (!rt) return false;
    try {
      const res = await fetch(`${API}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refresh_token: rt }),
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { access_token: string; refresh_token: string };
      setTokens(data.access_token, data.refresh_token);
      return true;
    } catch {
      return false;
    }
  })().finally(() => { _refreshPromise = null; });
  return _refreshPromise;
}

function redirectToLogin(): void {
  clearSession();
  router.replace('/login');
}

async function req<T = unknown>(path: string, { method, body, token, _retried }: ReqOpts): Promise<T> {
  const headers: Record<string, string> = {};
  // Only set JSON content-type when there's a body — Fastify rejects an empty
  // JSON body (passkey register/begin sends none).
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers['authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // Session expired mid-use: refresh once and retry; if that fails, the session
  // is truly over (refresh expired/revoked) → send them to login, not an error.
  // Only for authenticated calls — login/OTP 401s must surface to the caller.
  if (res.status === 401 && token && !_retried) {
    if (await trySilentRefresh()) {
      return req<T>(path, { method, body, token: getAccessToken() ?? undefined, _retried: true });
    }
    redirectToLogin();
    // Session is gone — navigate to login; throw so callers don't process stale
    // response data, but use a friendly message in case any catch shows a toast.
    throw new Error('Your session expired — please sign in again.');
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json as { error?: { message?: string } })?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json as T;
}

// blnk_auth validates `format: email` strictly — a stray leading/trailing space
// (mobile keyboards + autofill add one) fails as `body/email must match format
// "email"`. Normalize at the boundary so every auth call sends a clean address.
const normEmail = (email: string) => email.trim();

// ── OTP ─────────────────────────────────────────────────────────────────────
export const otpSend = (email: string) =>
  req('/auth/otp/send', { method: 'POST', body: { tenant_slug: TENANT, email: normEmail(email) } });

export const otpVerify = (email: string, code: string) =>
  req<TokenPair>('/auth/otp/verify', { method: 'POST', body: { tenant_slug: TENANT, email: normEmail(email), code } });

// ── Passkey (ceremonies proxied to blnk_auth) ───────────────────────────────
export const passkeyLoginBegin = (email: string) =>
  req('/auth/passkey/login/begin', { method: 'POST', body: { tenant_slug: TENANT, email: normEmail(email) } });

export const passkeyLoginComplete = (email: string, response: unknown) =>
  req<TokenPair>('/auth/passkey/login/complete', { method: 'POST', body: { tenant_slug: TENANT, email: normEmail(email), response } });

export const passkeyRegisterBegin = (token: string) =>
  req('/auth/passkey/register/begin', { method: 'POST', token }); // no body

export const passkeyRegisterComplete = (token: string, response: unknown) =>
  req('/auth/passkey/register/complete', { method: 'POST', body: { response }, token });

// ── Session ──────────────────────────────────────────────────────────────────
export const me = (token: string) => req('/me', { method: 'GET', token });

// ── Profile + onboarding ─────────────────────────────────────────────────────
export const getProfile = (token: string) => req<ProfileResponse>('/profile', { method: 'GET', token });

export const updateMyProfile = (token: string, data: {
  name?: string; contact_email?: string; phone?: string;
  preferred_contact?: string; timezone?: string;
}) => req('/profile/me', { method: 'PUT', body: data, token });

export const updateOrg = (token: string, data: {
  org_name?: string; logo_url?: string; brand_color?: string; accent_color?: string;
  custom_colors?: Record<string, string>;
  support_email?: string; timezone?: string; locale?: string; currency?: string;
  // Forwarded by client_api to blnk_api (inbound forwarding recipients).
  notification_email?: string; backup_email?: string | null;
}) => req('/profile/org', { method: 'PUT', body: data, token });

export const uploadUserAvatar = async (
  token: string,
  uri: string,
  asset?: { mimeType?: string; file?: File; fileName?: string | null },
): Promise<string> => {
  const filename = asset?.fileName ?? uri.split('/').pop() ?? 'avatar.jpg';
  const fileOrUri: Blob | string = typeof document === 'undefined'
    ? uri
    : (asset?.file ?? await fetch(uri).then(r => r.blob()));
  const res = await uploadImageMultipart(`${API}/profile/me/avatar`, token, fileOrUri, filename);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: { message?: string } })?.error?.message ?? `HTTP ${res.status}`);
  return (json as { avatar_url: string }).avatar_url;
};

// ── Team management ──────────────────────────────────────────────────────────
export const listTeam = (token: string) =>
  req<{ users: TeamUser[] }>('/team', { method: 'GET', token });

export const addTeamUser = (token: string, data: { email: string; role: 'admin' | 'member' }) =>
  req<{ user: TeamUser }>('/team', { method: 'POST', body: data, token });

export const setTeamUserActive = (token: string, id: string, active: boolean) =>
  req<{ user: TeamUser }>(`/team/${id}/active`, { method: 'PATCH', body: { active }, token });

// ── People (canonical human directory — always on) ───────────────────────────
export const listPeople = (token: string, opts?: { module?: string; active?: boolean }) => {
  const q = new URLSearchParams();
  if (opts?.module) q.set('module', opts.module);
  if (opts?.active !== undefined) q.set('active', String(opts.active));
  const qs = q.toString();
  return req<{ people: Person[] }>(`/people${qs ? `?${qs}` : ''}`, { method: 'GET', token });
};

export const createPerson = (token: string, data: { name: string; email?: string | null; phone?: string | null; user_id?: string | null }) =>
  req<{ person: Person }>('/people', { method: 'POST', body: data, token });

export const updatePerson = (token: string, id: string, patch: { name?: string; email?: string | null; phone?: string | null; user_id?: string | null; active?: boolean }) =>
  req<{ person: Person }>(`/people/${id}`, { method: 'PATCH', body: patch, token });

// The signed-in user's own person row (null if they have none) — drives module gating.
export const getMyPerson = (token: string) =>
  req<{ person: Person | null }>('/people/me', { method: 'GET', token });

export const setPersonModule = (token: string, id: string, module: string, role: string) =>
  req<{ person: Person }>(`/people/${id}/modules/${module}`, { method: 'PUT', body: { role }, token });

export const removePersonModule = (token: string, id: string, module: string) =>
  req<void>(`/people/${id}/modules/${module}`, { method: 'DELETE', token });

// ── Asset management (requires FEATURE_ASSET) ────────────────────────────────
export const listAssetTypes = (token: string) =>
  req<{ asset_types: AssetType[] }>('/asset/asset-types', { method: 'GET', token });
export const createAssetType = (token: string, body: { name: string; roles?: string[]; fields?: AssetFieldDef[] }) =>
  req<{ asset_type: AssetType }>('/asset/asset-types', { method: 'POST', body, token });
export const deleteAssetType = (token: string, id: string) =>
  req<void>(`/asset/asset-types/${id}`, { method: 'DELETE', token });

export const listAssets = (token: string) =>
  req<{ assets: Asset[] }>('/asset/assets', { method: 'GET', token });
export const createAsset = (token: string, body: { asset_type_id: string; name: string; location?: string; condition?: string; notes?: string; particulars?: Record<string, string> }) =>
  req<{ asset: Asset }>('/asset/assets', { method: 'POST', body, token });
export const updateAsset = (token: string, id: string, patch: { name?: string; particulars?: Record<string, string>; location?: string; condition?: string; notes?: string; image_url?: string | null; food_control_plan_id?: string | null }) =>
  req<{ asset: Asset }>(`/asset/assets/${id}`, { method: 'PATCH', body: patch, token });
export const uploadAssetImage = async (token: string, uri: string): Promise<string> => {
  const filename = uri.split('/').pop() ?? 'image.jpg';
  const buildForm = async () => {
    const form = new FormData();
    if (typeof document === 'undefined') {
      form.append('file', { uri, name: filename, type: 'image/jpeg' } as unknown as Blob);
    } else {
      const blob = await fetch(uri).then((r) => r.blob());
      form.append('file', blob, filename);
    }
    return form;
  };
  const doUpload = async (tok: string) => {
    const form = await buildForm();
    if (typeof document === 'undefined') return nativeMultipartUpload(`${API}/asset/documents/upload`, tok, form);
    return fetch(`${API}/asset/documents/upload`, { method: 'POST', headers: { authorization: `Bearer ${tok}` }, body: form });
  };
  let res = await doUpload(token);
  if (res.status === 401) {
    if (await trySilentRefresh()) {
      res = await doUpload(getAccessToken() ?? token);
    } else {
      redirectToLogin();
      throw new Error('Your session expired — please sign in again.');
    }
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: { message?: string } })?.error?.message ?? `HTTP ${res.status}`);
  return (json as { url: string }).url;
};
export const deleteAsset = (token: string, id: string) =>
  req<void>(`/asset/assets/${id}`, { method: 'DELETE', token });

export const listAssetFaults = (token: string, opts?: { asset_id?: string; status?: string }) => {
  const q = new URLSearchParams();
  if (opts?.asset_id) q.set('asset_id', opts.asset_id);
  if (opts?.status) q.set('status', opts.status);
  const qs = q.toString();
  return req<{ faults: AssetFault[] }>(`/asset/faults${qs ? `?${qs}` : ''}`, { method: 'GET', token });
};
export const createAssetFault = (token: string, body: { asset_id: string; name: string; description?: string; urgency?: string; component_id?: string | null; idempotency_key?: string }) =>
  req<{ fault: AssetFault }>('/asset/faults', { method: 'POST', body, token });
export const updateAssetFault = (token: string, id: string, patch: { urgency?: string; assigned_to?: string | null }) =>
  req<{ fault: AssetFault }>(`/asset/faults/${id}`, { method: 'PATCH', body: patch, token });

// Add a progress step to a fault (stays open).
export const addAssetFaultStep = (token: string, id: string, body: { note: string; idempotency_key?: string }) =>
  req<{ step: AssetFaultStep }>(`/asset/faults/${id}/steps`, { method: 'POST', body, token });
// Close a fault with a resolution note (no maintenance record required).
export const closeAssetFault = (token: string, id: string, body: { resolution_notes: string; idempotency_key?: string }) =>
  req<{ fault: AssetFault }>(`/asset/faults/${id}/close`, { method: 'POST', body, token });

// Complete maintenance — resolving a fault closes it (server sets fault status).
export const createAssetMaintenanceLog = (token: string, body: { asset_id: string; schedule_id?: string; fault_id?: string; task_name?: string; notes?: string; resolves_fault?: boolean; completed_date?: string; form_data?: FormResponseData; attachments?: string[]; idempotency_key?: string }) =>
  req<{ log: AssetMaintenanceLog; fault_closed: boolean }>('/asset/maintenance-logs', { method: 'POST', body, token });

// Coming-up feed — due/overdue services derived from maintenance schedules.
export const getAssetUpcoming = (token: string, assetId?: string) =>
  req<{ items: AssetUpcomingItem[] }>(`/asset/upcoming${assetId ? `?asset_id=${assetId}` : ''}`, { method: 'GET', token });

export const listAssetSchedules = (token: string, assetId?: string) =>
  req<{ schedules: AssetMaintenanceSchedule[] }>(`/asset/maintenance-schedules${assetId ? `?asset_id=${assetId}` : ''}`, { method: 'GET', token });
export const createAssetSchedule = (token: string, body: { asset_id: string; task_name: string; interval_type?: string; interval_value?: number; initial_due_date?: string; weekdays?: number[]; recurrence_end_date?: string | null; alert_days?: number; alerts?: AssetScheduleAlert[]; task_notes?: string; document_urls?: string[]; form_schema?: FormSchema }) =>
  req<{ schedule: AssetMaintenanceSchedule }>('/asset/maintenance-schedules', { method: 'POST', body, token });
export const updateAssetSchedule = (token: string, id: string, body: { task_notes?: string | null; document_urls?: string[]; form_schema?: FormSchema | null; active?: boolean }) =>
  req<{ schedule: AssetMaintenanceSchedule }>(`/asset/maintenance-schedules/${id}`, { method: 'PATCH', body, token });

export const uploadAssetDocument = async (token: string, file: File): Promise<{ url: string }> => {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API}/asset/documents/upload`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: { message?: string } })?.error?.message ?? `HTTP ${res.status}`);
  return json as { url: string };
};

export const listAssetComponents = (token: string, assetId: string) =>
  req<{ components: AssetComponent[] }>(`/asset/components?asset_id=${assetId}`, { method: 'GET', token });
export const createAssetComponent = (token: string, body: { asset_id: string; name: string; category?: string; critical_component?: boolean; notes?: string }) =>
  req<{ component: AssetComponent }>('/asset/components', { method: 'POST', body, token });

export const listAssetAssignments = (token: string, assetId: string) =>
  req<{ assignments: AssetAssignment[] }>(`/asset/assignments?asset_id=${assetId}`, { method: 'GET', token });
export const upsertAssetAssignment = (token: string, body: { person_id: string; asset_id: string; role?: string | null }) =>
  req<{ assignment: AssetAssignment }>('/asset/assignments', { method: 'PUT', body, token });
export const deleteAssetAssignment = (token: string, id: string) =>
  req<void>(`/asset/assignments/${id}`, { method: 'DELETE', token });

// ── Payments (client charges end users via Stripe Checkout) ──────────────────
export const subscribeCheckout = (token: string, data: { price_id: string; success_url: string; cancel_url: string }) =>
  req<{ url: string }>('/payments/subscriptions/checkout', { method: 'POST', body: data, token });

export const listMySubscriptions = (token: string) =>
  req<{ subscriptions: ClientSubscription[] }>('/payments/subscriptions', { method: 'GET', token });

export const cancelSubscription = (token: string, id: string) =>
  req(`/payments/subscriptions/${id}/cancel`, { method: 'PATCH', token });

export const oneOffCheckout = (token: string, data: { amount_cents: number; description: string; success_url: string; cancel_url: string }) =>
  req<{ url: string }>('/payments/one-off/checkout', { method: 'POST', body: data, token });

// ── Analytics (web traffic — requires FEATURE_ANALYTICS) ─────────────────────
export const getAnalyticsOverview = (token: string, range?: { from?: string; to?: string }) => {
  const qs = new URLSearchParams();
  if (range?.from) qs.set('from', range.from);
  if (range?.to) qs.set('to', range.to);
  const q = qs.toString();
  return req<{ overview: WebTrafficOverview }>(`/analytics/overview${q ? `?${q}` : ''}`, { method: 'GET', token });
};

// ── Locations ────────────────────────────────────────────────────────────────
export interface LocationEntry {
  id: string;
  location: string;
  starts_at: string;
  note: string | null;
  created_at: string;
}

export const getLocations = (token: string) =>
  req<{ locations: LocationEntry[] }>('/locations', { method: 'GET', token });

export const createLocation = (token: string, data: { location: string; starts_at: string; note?: string }) =>
  req<{ location: LocationEntry }>('/locations', { method: 'POST', body: data, token });

export const deleteLocation = (token: string, id: string) =>
  req<void>(`/locations/${id}`, { method: 'DELETE', token });

// ── Compliance (food safety records — requires FEATURE_COMPLIANCE) ───────────
export const getRecordTypes = (token: string, tier?: string) =>
  req<{ record_types: ComplianceRecordType[] }>(
    `/compliance/record-types${tier ? `?tier=${tier}` : ''}`, { method: 'GET', token });

export const getComplianceRecords = (token: string, filters?: { type?: string; result?: string; from?: string; to?: string }) => {
  const qs = new URLSearchParams();
  if (filters?.type) qs.set('type', filters.type);
  if (filters?.result) qs.set('result', filters.result);
  if (filters?.from) qs.set('from', filters.from);
  if (filters?.to) qs.set('to', filters.to);
  const q = qs.toString();
  return req<{ records: ComplianceRecord[] }>(`/compliance/records${q ? `?${q}` : ''}`, { method: 'GET', token });
};

export const createComplianceRecord = (token: string, body: {
  record_type: string; entered_by: string; data: Record<string, unknown>; site_id?: string | null; schedule_id?: string | null;
}) => req<{ record: ComplianceRecord; corrective_action: ComplianceRecord | null }>(
  '/compliance/records', { method: 'POST', body, token });

export const updateComplianceRecord = (token: string, id: string, body: {
  entered_by?: string; data?: Record<string, unknown>;
}) => req<{ record: ComplianceRecord }>(`/compliance/records/${id}`, { method: 'PATCH', body, token });

// ── Compliance schedules (recurring checks) ──────────────────────────────────
export type NewSchedule = {
  record_type: string; label: string; site_id?: string | null; cadence: string;
  weekdays?: number[]; day_of_month?: number | null; interval_days?: number | null;
  anchor_date?: string | null; times_per_day?: number; plan_id?: string | null;
};

export const getSchedulesDue = (token: string, on: string) => {
  // Pass local-day boundaries as UTC so the server counts records correctly regardless of server timezone.
  const from = new Date(on + 'T00:00:00').toISOString();
  const end = new Date(on + 'T00:00:00'); end.setDate(end.getDate() + 1);
  return req<{ due: ScheduleDue[] }>(`/compliance/schedules/due?on=${on}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(end.toISOString())}`, { method: 'GET', token });
};

export const listSchedules = (token: string) =>
  req<{ schedules: ComplianceSchedule[] }>('/compliance/schedules', { method: 'GET', token });

export const createSchedule = (token: string, body: NewSchedule) =>
  req<{ schedule: ComplianceSchedule }>('/compliance/schedules', { method: 'POST', body, token });

export const updateSchedule = (token: string, id: string, body: Partial<NewSchedule> & { active?: boolean }) =>
  req<{ schedule: ComplianceSchedule }>(`/compliance/schedules/${id}`, { method: 'PATCH', body, token });

export const deleteSchedule = (token: string, id: string) =>
  req<void>(`/compliance/schedules/${id}`, { method: 'DELETE', token });

// ── Cooling batches (real-time) ──────────────────────────────────────────────
export const startCooling = (token: string, body: { product: string; started_by: string; site_id?: string | null }) =>
  req<{ batch: CoolingBatch }>('/compliance/cooling', { method: 'POST', body, token });

export const getActiveCooling = (token: string) =>
  req<{ batches: CoolingBatch[] }>('/compliance/cooling/active', { method: 'GET', token });

export const reachCoolingStage = (token: string, id: string, stage: 'stage1' | 'stage2') =>
  req<{ batch: CoolingBatch; record?: ComplianceRecord; corrective_action?: ComplianceRecord | null }>(
    `/compliance/cooling/${id}/reach`, { method: 'POST', body: { stage }, token });

export const discardCooling = (token: string, id: string, body: { reason?: string; entered_by?: string }) =>
  req<{ batch: CoolingBatch; corrective_action: ComplianceRecord }>(
    `/compliance/cooling/${id}/discard`, { method: 'POST', body, token });

// ── Food Control Plans ───────────────────────────────────────────────────────
export const listPlans = (token: string) =>
  req<{ plans: FoodControlPlan[] }>('/compliance/plans', { method: 'GET', token });

export const createPlan = (token: string, body: { name: string; tier?: string }) =>
  req<{ plan: FoodControlPlan }>('/compliance/plans', { method: 'POST', body, token });

export const updatePlan = (token: string, id: string, body: { name?: string; tier?: string; active?: boolean; image_url?: string | null }) =>
  req<{ plan: FoodControlPlan }>(`/compliance/plans/${id}`, { method: 'PATCH', body, token });

export const uploadPlanImage = async (token: string, planId: string, uri: string): Promise<string> => {
  const filename = uri.split('/').pop() ?? 'image.jpg';
  const buildForm = async () => {
    const form = new FormData();
    if (typeof document === 'undefined') {
      form.append('file', { uri, name: filename, type: 'image/jpeg' } as unknown as Blob);
    } else {
      const blob = await fetch(uri).then((r) => r.blob());
      form.append('file', blob, filename);
    }
    return form;
  };
  const doUpload = async (tok: string) => {
    const form = await buildForm();
    if (typeof document === 'undefined') return nativeMultipartUpload(`${API}/compliance/plans/${planId}/image`, tok, form);
    return fetch(`${API}/compliance/plans/${planId}/image`, { method: 'POST', headers: { authorization: `Bearer ${tok}` }, body: form });
  };
  let res = await doUpload(token);
  if (res.status === 401) {
    if (await trySilentRefresh()) {
      res = await doUpload(getAccessToken() ?? token);
    } else {
      redirectToLogin();
      throw new Error('Your session expired — please sign in again.');
    }
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: { message?: string } })?.error?.message ?? `HTTP ${res.status}`);
  return (json as { url: string }).url;
};

export const duplicatePlan = (token: string, id: string, name: string) =>
  req<{ plan: FoodControlPlan }>(`/compliance/plans/${id}/duplicate`, { method: 'POST', body: { name }, token });

export const assignPersonToPlan = (token: string, planId: string, personId: string) =>
  req<void>(`/compliance/plans/${planId}/members/${personId}`, { method: 'PUT', token });

export const removePersonFromPlan = (token: string, planId: string, personId: string) =>
  req<void>(`/compliance/plans/${planId}/members/${personId}`, { method: 'DELETE', token });

// ── Commerce admin (store) ────────────────────────────────────────────────────
export const listAdminProducts = (token: string) =>
  req<{ products: Product[] }>('/commerce/admin/products', { method: 'GET', token });

export const createProduct = (token: string, data: Omit<Product, 'id' | 'created_at' | 'updated_at'>) =>
  req<{ product: Product }>('/commerce/admin/products', { method: 'POST', body: data, token });

export const updateProduct = (token: string, id: string, data: Partial<Product>) =>
  req<{ product: Product }>(`/commerce/admin/products/${id}`, { method: 'PATCH', body: data, token });

export const getAdminProduct = (token: string, id: string) =>
  req<{ product: Product }>(`/commerce/admin/products/${id}`, { method: 'GET', token });

export const listProductVariants = (token: string, productId: string) =>
  req<{ variants: ProductVariant[] }>(`/commerce/admin/products/${productId}/variants`, { method: 'GET', token });

export const createVariant = (token: string, productId: string, data: Omit<ProductVariant, 'id' | 'product_id' | 'created_at' | 'updated_at'>) =>
  req<{ variant: ProductVariant }>(`/commerce/admin/products/${productId}/variants`, { method: 'POST', body: data, token });

export const updateVariant = (token: string, productId: string, variantId: string, data: Partial<ProductVariant>) =>
  req<{ variant: ProductVariant }>(`/commerce/admin/products/${productId}/variants/${variantId}`, { method: 'PATCH', body: data, token });

export const deleteVariant = (token: string, productId: string, variantId: string) =>
  req<void>(`/commerce/admin/products/${productId}/variants/${variantId}`, { method: 'DELETE', token });

export const uploadProductImage = async (token: string, fileOrUri: Blob | string): Promise<{ url: string }> => {
  const filename = typeof fileOrUri === 'string' ? (fileOrUri.split('/').pop() ?? 'product.jpg') : 'product.jpg';
  const res = await uploadImageMultipart(`${API}/commerce/admin/upload`, token, fileOrUri, filename);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: { message?: string } })?.error?.message ?? `HTTP ${res.status}`);
  return json as { url: string };
};

// ── News Feed ─────────────────────────────────────────────────────────────────
export const getFeed = (token: string) =>
  req<{ items: FeedItem[]; my_modules: string[]; available_modules: string[] }>('/feed', { method: 'GET', token });

export const createFeedPost = (token: string, body: string, modules: string[], mentions: string[] = [], expiresHours?: number) =>
  req<{ post: FeedPost }>('/feed/posts', { method: 'POST', body: { body, modules, mentions, ...(expiresHours ? { expires_hours: expiresHours } : {}) }, token });

export const deleteFeedPost = (token: string, id: string) =>
  req<void>(`/feed/posts/${id}`, { method: 'DELETE', token });

export const listPostComments = (token: string, postId: string) =>
  req<{ comments: FeedPostComment[] }>(`/feed/posts/${postId}/comments`, { method: 'GET', token });

export const createPostComment = (token: string, postId: string, body: string) =>
  req<{ comment: FeedPostComment }>(`/feed/posts/${postId}/comments`, { method: 'POST', body: { body }, token });

export const registerPushToken = (token: string, pushToken: string | null) =>
  req<void>('/profile/push-token', { method: 'PATCH', body: { token: pushToken }, token });

// ── Schedule ──────────────────────────────────────────────────────────────────
export const listServiceTemplates = (token: string, active?: boolean) =>
  req<{ templates: ServiceTemplate[] }>(`/service-templates${active !== undefined ? `?active=${active}` : ''}`, { method: 'GET', token });

export const createServiceTemplate = (token: string, body: Omit<ServiceTemplate, 'id' | 'created_at' | 'updated_at' | 'created_by'>) =>
  req<{ template: ServiceTemplate }>('/service-templates', { method: 'POST', body, token });

export const updateServiceTemplate = (token: string, id: string, body: Partial<Omit<ServiceTemplate, 'id' | 'created_at' | 'updated_at' | 'created_by'>>) =>
  req<{ template: ServiceTemplate }>(`/service-templates/${id}`, { method: 'PATCH', body, token });

export const generateServiceInstances = (token: string, templateId: string, from: string, to: string) =>
  req<{ created: number; skipped: number }>(`/service-templates/${templateId}/generate`, { method: 'POST', body: { from, to }, token });

export const listServices = (token: string, from: string, to: string, opts?: { status?: string[]; template_id?: string }) => {
  const params = new URLSearchParams({ from, to });
  if (opts?.status?.length) opts.status.forEach(s => params.append('status', s));
  if (opts?.template_id) params.set('template_id', opts.template_id);
  return req<{ services: ScheduledService[] }>(`/services?${params}`, { method: 'GET', token });
};

export const getService = (token: string, id: string) =>
  req<{ service: ScheduledService; assignments: ServiceAssignment[] }>(`/services/${id}`, { method: 'GET', token });

export const createService = (token: string, body: { id: string; name: string; starts_at: string; ends_at: string; timezone: string; template_id?: string | null; location_label?: string | null; capacity?: number; required_roles?: unknown[]; status?: string; notes?: string }) =>
  req<{ service: ScheduledService }>('/services', { method: 'POST', body, token });

export const updateService = (token: string, id: string, body: Record<string, unknown> & { version: number }) =>
  req<{ service: ScheduledService }>(`/services/${id}`, { method: 'PATCH', body, token });

export const cancelService = (token: string, id: string, reason: string) =>
  req<{ service: ScheduledService }>(`/services/${id}/cancel`, { method: 'POST', body: { reason }, token });

export const addServiceAssignment = (token: string, serviceId: string, body: { subject_type: 'person' | 'asset'; subject_id: string; role?: string | null }) =>
  req<{ assignment: ServiceAssignment }>(`/services/${serviceId}/assignments`, { method: 'POST', body, token });

export const removeServiceAssignment = (token: string, serviceId: string, assignmentId: string) =>
  req<void>(`/services/${serviceId}/assignments/${assignmentId}`, { method: 'DELETE', token });

export const getServiceManifest = (token: string, serviceId: string) =>
  req<{ manifest: ServiceManifest }>(`/services/${serviceId}/manifest`, { method: 'GET', token });

export const getAvailability = (token: string, from: string, to: string) =>
  req<{ slots: AvailabilitySlot[] }>(`/availability?from=${from}&to=${to}`, { method: 'GET', token });
