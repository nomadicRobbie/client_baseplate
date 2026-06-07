import { query } from '../pool';

export interface StripeCustomer { user_id: string; stripe_customer_id: string; created_at: Date }

export interface Payment {
  id: string; user_id: string; stripe_checkout_session_id: string;
  stripe_payment_intent_id: string | null; amount_cents: number; currency: string;
  description: string | null; status: string; created_at: Date; updated_at: Date;
}

export interface Subscription {
  id: string; user_id: string; stripe_subscription_id: string; stripe_customer_id: string;
  stripe_price_id: string; status: string; current_period_start: Date | null;
  current_period_end: Date | null; cancel_at_period_end: boolean; created_at: Date; updated_at: Date;
}

// ── Stripe customers (end user → stripe customer) ───────────────────────────
export async function findStripeCustomer(userId: string): Promise<StripeCustomer | null> {
  const rows = await query<StripeCustomer>('SELECT * FROM stripe_customers WHERE user_id = $1', [userId]);
  return rows[0] ?? null;
}
export async function findStripeCustomerByStripeId(stripeCustomerId: string): Promise<StripeCustomer | null> {
  const rows = await query<StripeCustomer>('SELECT * FROM stripe_customers WHERE stripe_customer_id = $1', [stripeCustomerId]);
  return rows[0] ?? null;
}
export async function createStripeCustomer(userId: string, stripeCustomerId: string): Promise<StripeCustomer> {
  const rows = await query<StripeCustomer>(
    'INSERT INTO stripe_customers (user_id, stripe_customer_id) VALUES ($1, $2) RETURNING *',
    [userId, stripeCustomerId]
  );
  return rows[0];
}

// ── One-off payments ────────────────────────────────────────────────────────
export async function createPayment(data: {
  userId: string; sessionId: string; amountCents: number; currency: string; description?: string;
}): Promise<Payment> {
  const rows = await query<Payment>(
    `INSERT INTO payments (user_id, stripe_checkout_session_id, amount_cents, currency, description)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [data.userId, data.sessionId, data.amountCents, data.currency, data.description ?? null]
  );
  return rows[0];
}
export async function listPayments(userId: string): Promise<Payment[]> {
  return query<Payment>('SELECT * FROM payments WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
}
export async function markPaymentBySession(sessionId: string, status: string, paymentIntentId: string | null): Promise<void> {
  await query(
    `UPDATE payments SET status = $1, stripe_payment_intent_id = COALESCE($2, stripe_payment_intent_id), updated_at = NOW()
     WHERE stripe_checkout_session_id = $3`,
    [status, paymentIntentId, sessionId]
  );
}

// ── Subscriptions ───────────────────────────────────────────────────────────
export async function upsertSubscription(data: {
  userId: string; stripeSubscriptionId: string; stripeCustomerId: string; stripePriceId: string;
  status: string; currentPeriodStart: Date | null; currentPeriodEnd: Date | null; cancelAtPeriodEnd: boolean;
}): Promise<Subscription> {
  const rows = await query<Subscription>(
    `INSERT INTO subscriptions
       (user_id, stripe_subscription_id, stripe_customer_id, stripe_price_id, status,
        current_period_start, current_period_end, cancel_at_period_end)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (stripe_subscription_id) DO UPDATE SET
       stripe_price_id      = EXCLUDED.stripe_price_id,
       status               = EXCLUDED.status,
       current_period_start = EXCLUDED.current_period_start,
       current_period_end   = EXCLUDED.current_period_end,
       cancel_at_period_end = EXCLUDED.cancel_at_period_end,
       updated_at           = NOW()
     RETURNING *`,
    [data.userId, data.stripeSubscriptionId, data.stripeCustomerId, data.stripePriceId, data.status,
     data.currentPeriodStart, data.currentPeriodEnd, data.cancelAtPeriodEnd]
  );
  return rows[0];
}
export async function listSubscriptions(userId: string): Promise<Subscription[]> {
  return query<Subscription>('SELECT * FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
}
export async function findSubscriptionByStripeId(id: string): Promise<Subscription | null> {
  const rows = await query<Subscription>('SELECT * FROM subscriptions WHERE stripe_subscription_id = $1', [id]);
  return rows[0] ?? null;
}
export async function updateSubscriptionStatus(data: {
  stripeSubscriptionId: string; status: string; currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null; cancelAtPeriodEnd: boolean;
}): Promise<void> {
  await query(
    `UPDATE subscriptions SET status = $1, current_period_start = $2, current_period_end = $3,
       cancel_at_period_end = $4, updated_at = NOW() WHERE stripe_subscription_id = $5`,
    [data.status, data.currentPeriodStart, data.currentPeriodEnd, data.cancelAtPeriodEnd, data.stripeSubscriptionId]
  );
}
