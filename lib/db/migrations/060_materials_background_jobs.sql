-- Durable private staging -> applicant materials background processing.
-- Existing synchronous upload scopes retain their current statuses and behavior.
ALTER TABLE portal_upload_staging
  ADD COLUMN IF NOT EXISTS background_job_id UUID;

CREATE INDEX IF NOT EXISTS idx_portal_upload_staging_background_job
  ON portal_upload_staging (background_job_id)
  WHERE background_job_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS materials_upload_jobs (
  id UUID PRIMARY KEY,
  staging_id UUID NOT NULL UNIQUE REFERENCES portal_upload_staging(id),
  collection_id UUID NOT NULL,
  request_id UUID NOT NULL,
  slot TEXT NOT NULL CHECK (slot IN ('presentation_pdf', 'presentation_source', 'participant_bios', 'other')),
  actor_binding TEXT NOT NULL,
  token_digest CHAR(64) NOT NULL CHECK (token_digest ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'needs_attention', 'cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_token UUID,
  locked_until TIMESTAMPTZ,
  deadline_at TIMESTAMPTZ NOT NULL,
  scan_checkpoint JSONB,
  error_code TEXT,
  result_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  CONSTRAINT materials_upload_jobs_lease_shape CHECK (
    (status = 'processing' AND lease_token IS NOT NULL AND locked_until IS NOT NULL)
    OR (status <> 'processing' AND lease_token IS NULL AND locked_until IS NULL)
  ),
  CONSTRAINT materials_upload_jobs_terminal_shape CHECK (
    (status IN ('completed', 'failed', 'needs_attention', 'cancelled') AND completed_at IS NOT NULL)
    OR (status IN ('queued', 'processing') AND completed_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_materials_upload_jobs_ready
  ON materials_upload_jobs (next_attempt_at, created_at)
  WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_materials_upload_jobs_collection
  ON materials_upload_jobs (collection_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_materials_upload_jobs_request
  ON materials_upload_jobs (request_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_materials_upload_jobs_active_slot
  ON materials_upload_jobs (request_id, slot)
  WHERE slot <> 'other' AND status IN ('queued', 'processing', 'needs_attention');

COMMENT ON TABLE materials_upload_jobs IS
  'Durable applicant materials scan/SharePoint/Request Document job ledger; staging marker retains ownership until terminal retention.';
COMMENT ON COLUMN portal_upload_staging.background_job_id IS
  'Exact materials_upload_jobs owner; public staging claims and cleanup must refuse a non-null marker.';
COMMENT ON COLUMN materials_upload_jobs.scan_checkpoint IS
  'A clean malware verdict bound to the actual SHA-256 and scan policy version; never client supplied.';
