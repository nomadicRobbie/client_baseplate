-- Store {url, name} objects instead of bare URL strings so original filenames survive.
-- Existing rows: derive name from the last path segment (uuid.ext — best we have).

UPDATE asset_maintenance_schedules
SET document_urls = (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'url',  elem,
    'name', regexp_replace(elem, '^.*/', '')
  )), '[]'::jsonb)
  FROM jsonb_array_elements_text(document_urls) AS elem
)
WHERE jsonb_array_length(document_urls) > 0;

UPDATE asset_maintenance_logs
SET attachments = (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'url',  elem,
    'name', regexp_replace(elem, '^.*/', '')
  )), '[]'::jsonb)
  FROM jsonb_array_elements_text(attachments) AS elem
)
WHERE attachments IS NOT NULL AND jsonb_array_length(attachments) > 0;
