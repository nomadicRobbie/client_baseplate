-- ── Commerce products v2 ──────────────────────────────────────────────────────
-- Expands commerce_products with full product schema and adds a proper
-- commerce_product_variants table. Migrates old sizes/stock_level/postable
-- columns into the new structure, then drops them.

-- ── 1. New scalar columns ────────────────────────────────────────────────────
ALTER TABLE commerce_products
  ADD COLUMN IF NOT EXISTS sku               TEXT,
  ADD COLUMN IF NOT EXISTS slug              TEXT,
  ADD COLUMN IF NOT EXISTS handle            TEXT,
  ADD COLUMN IF NOT EXISTS parent_id         UUID REFERENCES commerce_products(id),
  ADD COLUMN IF NOT EXISTS gtin              TEXT,
  ADD COLUMN IF NOT EXISTS mpn               TEXT,
  ADD COLUMN IF NOT EXISTS status            TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS visibility        TEXT NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS product_type      TEXT NOT NULL DEFAULT 'physical',
  ADD COLUMN IF NOT EXISTS featured          BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_digital        BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS compare_at_price_cents INT,
  ADD COLUMN IF NOT EXISTS cost_price_cents  INT,
  ADD COLUMN IF NOT EXISTS currency          TEXT NOT NULL DEFAULT 'NZD',
  ADD COLUMN IF NOT EXISTS tax_class         TEXT,
  ADD COLUMN IF NOT EXISTS tax_inclusive     BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS stock_quantity    INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stock_status      TEXT NOT NULL DEFAULT 'in_stock',
  ADD COLUMN IF NOT EXISTS track_inventory   BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS allow_backorder   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS low_stock_threshold INT,
  ADD COLUMN IF NOT EXISTS warehouse_location TEXT,
  ADD COLUMN IF NOT EXISTS lead_time_days    INT,
  ADD COLUMN IF NOT EXISTS restock_date      DATE,
  ADD COLUMN IF NOT EXISTS has_variants      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS rating_average    NUMERIC(3,1),
  ADD COLUMN IF NOT EXISTS rating_count      INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sales_channels    TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS available_regions TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS published_at      TIMESTAMPTZ;

-- ── 2. New JSONB blob columns ─────────────────────────────────────────────────
ALTER TABLE commerce_products
  ADD COLUMN IF NOT EXISTS content        JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS media          JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS specifications JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS shipping_info  JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS organisation   JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS seo            JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS social_proof   JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS pricing_meta   JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS digital_product JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS compliance     JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS variant_options JSONB NOT NULL DEFAULT '{}';

-- ── 3. Migrate old data into new columns ─────────────────────────────────────

-- desc_points → content.features; image_url+images → media; postable → shipping_info
UPDATE commerce_products SET
  content = jsonb_build_object(
    'features', desc_points
  ),
  media = jsonb_build_object(
    'primary_image', image_url,
    'gallery', images
  ),
  shipping_info = jsonb_build_object(
    'requires_shipping', postable
  ),
  -- aggregate stock_level JSONB into stock_quantity (sum across sizes)
  stock_quantity = (
    SELECT COALESCE(SUM(value::int), 0)
    FROM jsonb_each_text(stock_level)
  ),
  stock_status = CASE
    WHEN (SELECT COALESCE(SUM(value::int), 0) FROM jsonb_each_text(stock_level)) > 0
    THEN 'in_stock'
    ELSE 'out_of_stock'
  END,
  -- migrate is_new → social_proof badge
  social_proof = CASE
    WHEN is_new THEN '{"badges": ["New"]}'::jsonb
    ELSE '{}'::jsonb
  END,
  -- model_size / model_details → specifications.custom_attributes
  specifications = CASE
    WHEN model_size OR array_length(model_details, 1) > 0
    THEN jsonb_build_object(
      'custom_attributes', jsonb_build_object(
        'model_size', model_size::text,
        'model_details', to_jsonb(model_details)
      )
    )
    ELSE '{}'::jsonb
  END,
  published_at = CASE WHEN active THEN created_at ELSE NULL END;

-- ── 4. Variants table ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS commerce_product_variants (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id              UUID        NOT NULL REFERENCES commerce_products(id) ON DELETE CASCADE,
  sku                     TEXT,
  title                   TEXT,
  option_values           JSONB       NOT NULL DEFAULT '{}',
  price_cents             INT,
  compare_at_price_cents  INT,
  cost_price_cents        INT,
  stock_quantity          INT         NOT NULL DEFAULT 0,
  stock_status            TEXT        NOT NULL DEFAULT 'in_stock',
  track_inventory         BOOLEAN     NOT NULL DEFAULT TRUE,
  allow_backorder         BOOLEAN     NOT NULL DEFAULT FALSE,
  low_stock_threshold     INT,
  warehouse_location      TEXT,
  image_id                TEXT,
  weight_grams            INT,
  is_default              BOOLEAN     NOT NULL DEFAULT FALSE,
  active                  BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS commerce_variants_product_idx ON commerce_product_variants(product_id);
CREATE INDEX IF NOT EXISTS commerce_variants_sku_idx     ON commerce_product_variants(sku) WHERE sku IS NOT NULL;

-- ── 5. Migrate old sizes+stock_level → variant rows ──────────────────────────
-- One variant row per size entry. The first size becomes is_default.
INSERT INTO commerce_product_variants (product_id, title, option_values, stock_quantity, stock_status, is_default)
SELECT
  p.id,
  s.size,
  jsonb_build_object('Size', s.size),
  COALESCE((p.stock_level ->> s.size)::int, 0),
  CASE WHEN COALESCE((p.stock_level ->> s.size)::int, 0) > 0 THEN 'in_stock' ELSE 'out_of_stock' END,
  (s.size = p.sizes[1])
FROM commerce_products p,
     LATERAL UNNEST(p.sizes) AS s(size)
WHERE array_length(p.sizes, 1) > 0
ON CONFLICT DO NOTHING;

-- Mark products that had sizes as has_variants
UPDATE commerce_products SET has_variants = TRUE
WHERE array_length(sizes, 1) > 0;

-- Set variant_options for migrated products
UPDATE commerce_products SET
  variant_options = jsonb_build_object(
    'option_names', '["Size"]'::jsonb,
    'options', jsonb_build_object('Size', to_jsonb(sizes))
  )
WHERE array_length(sizes, 1) > 0;

-- ── 6. New indexes ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS commerce_products_status_idx      ON commerce_products(status);
CREATE INDEX IF NOT EXISTS commerce_products_slug_idx        ON commerce_products(slug) WHERE slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS commerce_products_sku_idx         ON commerce_products(sku) WHERE sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS commerce_products_stock_status_idx ON commerce_products(stock_status);
CREATE INDEX IF NOT EXISTS commerce_products_featured_idx    ON commerce_products(featured) WHERE featured = TRUE;

-- ── 7. Drop old columns (now migrated) ───────────────────────────────────────
ALTER TABLE commerce_products
  DROP COLUMN IF EXISTS desc_points,
  DROP COLUMN IF EXISTS image_url,
  DROP COLUMN IF EXISTS images,
  DROP COLUMN IF EXISTS sizes,
  DROP COLUMN IF EXISTS stock_level,
  DROP COLUMN IF EXISTS postable,
  DROP COLUMN IF EXISTS is_new,
  DROP COLUMN IF EXISTS model_size,
  DROP COLUMN IF EXISTS model_details;
