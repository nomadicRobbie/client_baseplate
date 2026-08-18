-- Comments on feed posts — same append-only pattern as vessel_fault_steps.
-- No edit/delete on comments by design; posts can be deleted by their author or an admin.
CREATE TABLE IF NOT EXISTS feed_post_comments (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     UUID    NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
  created_by  TEXT    NOT NULL,
  author_name TEXT    NOT NULL DEFAULT '',
  body        TEXT    NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS feed_post_comments_post_idx ON feed_post_comments (post_id, created_at);
