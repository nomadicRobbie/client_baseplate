-- ── Commerce module ──────────────────────────────────────────────────────────
-- Registered only when FEATURE_COMMERCE=true. Single-tenant per clone — no
-- tenant_id column needed. stock_level is JSONB keyed by size string so new
-- sizes can be added without a schema change.

CREATE TABLE IF NOT EXISTS commerce_products (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title         TEXT        NOT NULL,
  description   TEXT        NOT NULL DEFAULT '',
  desc_points   TEXT[]      NOT NULL DEFAULT '{}',
  price_cents   INT         NOT NULL CHECK (price_cents >= 0),
  image_url     TEXT,
  images        TEXT[]      NOT NULL DEFAULT '{}',
  sizes         TEXT[]      NOT NULL DEFAULT '{}',
  stock_level   JSONB       NOT NULL DEFAULT '{}',
  postable      BOOLEAN     NOT NULL DEFAULT TRUE,
  is_new        BOOLEAN     NOT NULL DEFAULT FALSE,
  model_size    BOOLEAN     NOT NULL DEFAULT FALSE,
  model_details TEXT[]      NOT NULL DEFAULT '{}',
  active        BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS commerce_orders (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_ref          TEXT        NOT NULL UNIQUE,
  email              TEXT        NOT NULL,
  name               TEXT        NOT NULL,
  phone              TEXT,
  shipping_address   JSONB       NOT NULL DEFAULT '{}',
  items              JSONB       NOT NULL DEFAULT '[]',
  total_cents        INT         NOT NULL CHECK (total_cents >= 0),
  payment_intent_id  TEXT,
  payment_status     TEXT        NOT NULL DEFAULT 'pending',  -- pending|paid|failed
  fulfillment_status TEXT        NOT NULL DEFAULT 'pending',  -- pending|packed|fulfilled
  packed_at          TIMESTAMPTZ,
  packed_by          TEXT,   -- blnk_auth user id
  fulfilled_at       TIMESTAMPTZ,
  fulfilled_by       TEXT,   -- blnk_auth user id
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS commerce_orders_email_idx          ON commerce_orders(email);
CREATE INDEX IF NOT EXISTS commerce_orders_payment_intent_idx ON commerce_orders(payment_intent_id) WHERE payment_intent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS commerce_orders_fulfillment_idx    ON commerce_orders(fulfillment_status);
CREATE INDEX IF NOT EXISTS commerce_orders_created_idx        ON commerce_orders(created_at DESC);

CREATE TABLE IF NOT EXISTS commerce_enquiries (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  enquiry_ref  TEXT        NOT NULL UNIQUE,
  name         TEXT        NOT NULL,
  email        TEXT        NOT NULL,
  subject      TEXT        NOT NULL DEFAULT '',
  message      TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS commerce_enquiries_email_idx   ON commerce_enquiries(email);
CREATE INDEX IF NOT EXISTS commerce_enquiries_created_idx ON commerce_enquiries(created_at DESC);
