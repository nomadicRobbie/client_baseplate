import { query } from '../pool';

export interface ClientProfile {
  id: number;
  org_name: string | null;
  logo_url: string | null;
  brand_color: string | null;
  accent_color: string | null;
  custom_colors: Record<string, string>;
  support_email: string | null;
  timezone: string | null;
  locale: string | null;
  currency: string | null;
  updated_by: string | null;
  updated_at: Date;
}

export interface UserProfile {
  user_id: string;
  contact_email: string | null;
  phone: string | null;
  preferred_contact: string | null;
  timezone: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

// ── Org profile (singleton row id=1) ────────────────────────────────────────
export async function getClientProfile(): Promise<ClientProfile | null> {
  const rows = await query<ClientProfile>('SELECT * FROM client_profile WHERE id = 1');
  return rows[0] ?? null;
}

export async function upsertClientProfile(
  data: Partial<Omit<ClientProfile, 'id' | 'updated_at'>>,
  updatedBy: string
): Promise<ClientProfile> {
  const rows = await query<ClientProfile>(
    `INSERT INTO client_profile
       (id, org_name, logo_url, brand_color, accent_color, custom_colors, support_email, timezone, locale, currency, updated_by, updated_at)
     VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
     ON CONFLICT (id) DO UPDATE SET
       org_name      = COALESCE(EXCLUDED.org_name, client_profile.org_name),
       logo_url      = COALESCE(EXCLUDED.logo_url, client_profile.logo_url),
       brand_color   = COALESCE(EXCLUDED.brand_color, client_profile.brand_color),
       accent_color  = COALESCE(EXCLUDED.accent_color, client_profile.accent_color),
       custom_colors = COALESCE(EXCLUDED.custom_colors, client_profile.custom_colors),
       support_email = COALESCE(EXCLUDED.support_email, client_profile.support_email),
       timezone      = COALESCE(EXCLUDED.timezone, client_profile.timezone),
       locale        = COALESCE(EXCLUDED.locale, client_profile.locale),
       currency      = COALESCE(EXCLUDED.currency, client_profile.currency),
       updated_by    = EXCLUDED.updated_by,
       updated_at    = NOW()
     RETURNING *`,
    [
      data.org_name ?? null, data.logo_url ?? null, data.brand_color ?? null,
      data.accent_color ?? null, data.custom_colors ?? '[]', data.support_email ?? null,
      data.timezone ?? null, data.locale ?? null, data.currency ?? null, updatedBy,
    ]
  );
  return rows[0];
}

// ── Per-user profile ────────────────────────────────────────────────────────
export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const rows = await query<UserProfile>('SELECT * FROM user_profile WHERE user_id = $1', [userId]);
  return rows[0] ?? null;
}

export async function upsertUserProfile(
  userId: string,
  data: Partial<Omit<UserProfile, 'user_id' | 'created_at' | 'updated_at' | 'metadata'>>
): Promise<UserProfile> {
  const rows = await query<UserProfile>(
    `INSERT INTO user_profile (user_id, contact_email, phone, preferred_contact, timezone, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       contact_email     = COALESCE(EXCLUDED.contact_email, user_profile.contact_email),
       phone             = COALESCE(EXCLUDED.phone, user_profile.phone),
       preferred_contact = COALESCE(EXCLUDED.preferred_contact, user_profile.preferred_contact),
       timezone          = COALESCE(EXCLUDED.timezone, user_profile.timezone),
       updated_at        = NOW()
     RETURNING *`,
    [userId, data.contact_email ?? null, data.phone ?? null, data.preferred_contact ?? null, data.timezone ?? null]
  );
  return rows[0];
}
