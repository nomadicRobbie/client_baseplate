-- ── Client payments (the client charges THEIR end users) ────────────────────
-- The "customer" here is an end user (e.g. a member), keyed by blnk_auth user id.
-- All on the CLIENT's own Stripe account. Stripe Checkout is the payment surface.

-- One Stripe customer per end user, on the client's Stripe account.
CREATE TABLE IF NOT EXISTS stripe_customers (
  user_id            UUID        PRIMARY KEY,   -- blnk_auth users.id
  stripe_customer_id TEXT        NOT NULL UNIQUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One-off payments raised via Checkout (mode=payment).
CREATE TABLE IF NOT EXISTS payments (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     UUID        NOT NULL,
  stripe_checkout_session_id  TEXT        NOT NULL UNIQUE,
  stripe_payment_intent_id    TEXT,
  amount_cents                INT         NOT NULL,
  currency                    TEXT        NOT NULL DEFAULT 'nzd',
  description                 TEXT,
  status                      TEXT        NOT NULL DEFAULT 'pending', -- pending|paid|failed|expired
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS payments_user_idx    ON payments(user_id);
CREATE INDEX IF NOT EXISTS payments_session_idx ON payments(stripe_checkout_session_id);

-- Subscriptions (mode=subscription). Synced from webhooks.
CREATE TABLE IF NOT EXISTS subscriptions (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID        NOT NULL,
  stripe_subscription_id  TEXT        NOT NULL UNIQUE,
  stripe_customer_id      TEXT        NOT NULL,
  stripe_price_id         TEXT        NOT NULL,
  status                  TEXT        NOT NULL DEFAULT 'active',
  current_period_start    TIMESTAMPTZ,
  current_period_end      TIMESTAMPTZ,
  cancel_at_period_end    BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS subscriptions_user_idx     ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS subscriptions_stripe_idx   ON subscriptions(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS subscriptions_customer_idx ON subscriptions(stripe_customer_id);
