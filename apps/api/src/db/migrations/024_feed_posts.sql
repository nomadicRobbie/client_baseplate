-- Feed posts: user-created messages with module-scoped visibility.
-- modules = '{}' means visible to all staff (org-wide).
-- image_urls is reserved for future photo support — no schema change needed then.
CREATE TABLE IF NOT EXISTS feed_posts (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by  TEXT    NOT NULL,                -- blnk user_id
  author_name TEXT    NOT NULL DEFAULT '',     -- snapshot at post time (avoids join on reads)
  body        TEXT    NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  modules     TEXT[]  NOT NULL DEFAULT '{}',   -- chosen scope; {} = all staff
  image_urls  TEXT[]  NOT NULL DEFAULT '{}',   -- reserved
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS feed_posts_created_idx ON feed_posts (created_at DESC) WHERE deleted_at IS NULL;
