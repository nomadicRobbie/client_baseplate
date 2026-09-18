-- Banner styling (color/font tokens) and page targeting for the website CMS.
-- style JSONB holds typed sub-schemas per content type (see docs/website-cms.md).
-- page_targets TEXT[] is used by banners only: ['*'] = all pages, or explicit paths.
ALTER TABLE website_content
  ADD COLUMN IF NOT EXISTS style        JSONB,
  ADD COLUMN IF NOT EXISTS page_targets TEXT[];
