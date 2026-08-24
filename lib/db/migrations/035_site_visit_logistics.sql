-- Site Visit recipient-directory and frozen-distribution calendar/link extension.
-- Dataverse owns the Site Visit Activity; Postgres keeps the preferred external
-- roster address and the existing cross-system email recovery ledger.

ALTER TABLE expertise_roster
  ADD COLUMN IF NOT EXISTS preferred_email VARCHAR(320);

ALTER TABLE pre_site_distribution_attempts
  ADD COLUMN IF NOT EXISTS calendar_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS site_visit_id UUID,
  ADD COLUMN IF NOT EXISTS site_visit_etag TEXT,
  ADD COLUMN IF NOT EXISTS site_visit_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS material_links JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS calendar_filename TEXT,
  ADD COLUMN IF NOT EXISTS calendar_content_type TEXT,
  ADD COLUMN IF NOT EXISTS calendar_byte_hash CHAR(64),
  ADD COLUMN IF NOT EXISTS calendar_size BIGINT,
  ADD COLUMN IF NOT EXISTS calendar_attached_at TIMESTAMPTZ;

ALTER TABLE pre_site_distribution_attempts
  DROP CONSTRAINT IF EXISTS pre_site_distribution_hash_shape,
  DROP CONSTRAINT IF EXISTS pre_site_distribution_calendar_shape,
  DROP CONSTRAINT IF EXISTS pre_site_distribution_material_links_shape;

ALTER TABLE pre_site_distribution_attempts
  ADD CONSTRAINT pre_site_distribution_hash_shape CHECK (
    draft_hash ~ '^[0-9a-f]{64}$'
    AND (preview_hash IS NULL OR preview_hash ~ '^[0-9a-f]{64}$')
    AND (source_byte_hash IS NULL OR source_byte_hash ~ '^[0-9a-f]{64}$')
    AND (docx_byte_hash IS NULL OR docx_byte_hash ~ '^[0-9a-f]{64}$')
    AND (pdf_byte_hash IS NULL OR pdf_byte_hash ~ '^[0-9a-f]{64}$')
    AND (calendar_byte_hash IS NULL OR calendar_byte_hash ~ '^[0-9a-f]{64}$')
  ),
  ADD CONSTRAINT pre_site_distribution_material_links_shape CHECK (
    jsonb_typeof(material_links) = 'array'
  ),
  ADD CONSTRAINT pre_site_distribution_calendar_shape CHECK (
    (
      calendar_enabled = false
      AND site_visit_id IS NULL
      AND site_visit_etag IS NULL
      AND site_visit_snapshot IS NULL
      AND calendar_filename IS NULL
      AND calendar_content_type IS NULL
      AND calendar_byte_hash IS NULL
      AND calendar_size IS NULL
      AND calendar_attached_at IS NULL
    )
    OR (
      calendar_enabled = true
      AND site_visit_id IS NOT NULL
      AND site_visit_etag IS NOT NULL
      AND jsonb_typeof(site_visit_snapshot) = 'object'
      AND calendar_filename IS NOT NULL
      AND calendar_content_type IS NOT NULL
      AND calendar_byte_hash IS NOT NULL
      AND calendar_size > 0
      AND (
        state IN ('preparing', 'prepared', 'activity_created')
        OR calendar_attached_at IS NOT NULL
      )
    )
  );

CREATE INDEX IF NOT EXISTS idx_pre_site_distribution_site_visit
  ON pre_site_distribution_attempts (site_visit_id, created_at DESC)
  WHERE site_visit_id IS NOT NULL;

COMMENT ON COLUMN expertise_roster.preferred_email IS
  'Staff-maintained preferred address for Board/Consultant Site Visit correspondence; identity remains expertise_roster.id.';
COMMENT ON COLUMN pre_site_distribution_attempts.site_visit_snapshot IS
  'Content-bounded exact schedule/organizer/attendee snapshot used to rebuild and verify the confirmed calendar attachment.';
COMMENT ON COLUMN pre_site_distribution_attempts.material_links IS
  'Exact server-resolved governed Request Document and stable SharePoint link identities shown in preview and sent body.';
