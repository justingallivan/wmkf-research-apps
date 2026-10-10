-- Stage 4 slice 2: presentation_video_splits (docs/plans/STAGE4_BUILD_PLAN_2026-10-10.md, Slices 2-5).
-- Holds the frozen input, worker lease, Sandbox cleanup ledger, output upload ledger, approval claim and
-- retained lineage for one presentation-video cut. Applied once, so it carries every column slices 3-5 need.
-- Inert until the slice 2 start route (flag PRESENTATION_VIDEO_SPLIT_ACCESS, off by default) writes a row.
-- Content-free: no names, attendance, emails or URLs. The upload session URL is stored only as ciphertext.
CREATE TABLE IF NOT EXISTS presentation_video_splits (
  id UUID PRIMARY KEY,
  request_id UUID NOT NULL,
  site_visit_activity_id UUID NOT NULL,
  actor_profile_id INTEGER NOT NULL REFERENCES user_profiles(id),
  source_copy_id UUID NOT NULL REFERENCES zoom_video_copies(id),
  transcript_revision_id UUID NOT NULL,
  presentation_end_ms BIGINT NOT NULL CHECK (presentation_end_ms >= 0),
  source_document_id UUID NOT NULL,
  source_drive_id TEXT NOT NULL,
  source_item_id TEXT NOT NULL,
  source_version_id TEXT,
  source_etag TEXT NOT NULL,
  source_size BIGINT NOT NULL CHECK (source_size > 0),
  source_quickxor_hash TEXT CHECK (source_quickxor_hash IS NULL OR char_length(source_quickxor_hash) <= 100),
  mapping_version SMALLINT NOT NULL DEFAULT 1,
  lineage JSONB NOT NULL CHECK (jsonb_typeof(lineage) = 'object' AND pg_column_size(lineage) <= 16384),
  state TEXT NOT NULL CHECK (state IN ('queued','cutting','uploading','review','registering','approved','failed','cancelled','superseded')),
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ,
  cut_attempts SMALLINT NOT NULL DEFAULT 0 CHECK (cut_attempts BETWEEN 0 AND 5),
  cancel_requested_at TIMESTAMPTZ,
  sandbox_name TEXT CHECK (sandbox_name IS NULL OR char_length(sandbox_name) BETWEEN 1 AND 100),
  sandbox_command_id TEXT CHECK (sandbox_command_id IS NULL OR char_length(sandbox_command_id) <= 200),
  sandbox_created_at TIMESTAMPTZ,
  sandbox_cleaned_at TIMESTAMPTZ,
  cleanup_attempts INTEGER NOT NULL DEFAULT 0 CHECK (cleanup_attempts >= 0),
  next_cleanup_at TIMESTAMPTZ,
  sandbox_active_cpu_ms BIGINT CHECK (sandbox_active_cpu_ms IS NULL OR sandbox_active_cpu_ms >= 0),
  sandbox_provisioned_ms BIGINT CHECK (sandbox_provisioned_ms IS NULL OR sandbox_provisioned_ms >= 0),
  sandbox_vcpus SMALLINT CHECK (sandbox_vcpus IS NULL OR sandbox_vcpus BETWEEN 1 AND 8),
  cleanup_receipt JSONB CHECK (cleanup_receipt IS NULL OR (jsonb_typeof(cleanup_receipt) = 'object' AND pg_column_size(cleanup_receipt) <= 8192)),
  upload_url_ciphertext TEXT,
  upload_session_expires_at TIMESTAMPTZ,
  output_drive_id TEXT,
  output_item_id TEXT,
  output_version_id TEXT,
  output_etag TEXT,
  output_size BIGINT CHECK (output_size IS NULL OR output_size > 0),
  output_quickxor_hash TEXT CHECK (output_quickxor_hash IS NULL OR char_length(output_quickxor_hash) <= 100),
  verification_receipt JSONB CHECK (verification_receipt IS NULL OR (jsonb_typeof(verification_receipt) = 'object' AND pg_column_size(verification_receipt) <= 16384)),
  request_document_id UUID,
  superseded_document_id UUID,
  approval_claim_token UUID,
  approval_claimed_at TIMESTAMPTZ,
  approval_actor_profile_id INTEGER REFERENCES user_profiles(id),
  approval_registration_attempted BOOLEAN NOT NULL DEFAULT FALSE,
  approved_by_profile_id INTEGER REFERENCES user_profiles(id),
  approved_at TIMESTAMPTZ,
  failure_code TEXT CHECK (failure_code IS NULL OR failure_code ~ '^[a-z0-9_]{1,80}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT presentation_video_splits_lease_shape CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL)),
  CONSTRAINT presentation_video_splits_failed_shape CHECK (
    (state <> 'failed' OR failure_code IS NOT NULL) AND (failure_code IS NULL OR state IN ('failed','superseded'))),
  CONSTRAINT presentation_video_splits_terminal_unleased CHECK (
    state NOT IN ('review','registering','approved','failed','cancelled','superseded') OR lease_token IS NULL),
  CONSTRAINT presentation_video_splits_approval_claim_shape CHECK (approval_claim_token IS NULL OR approval_claimed_at IS NOT NULL),
  CONSTRAINT presentation_video_splits_output_shape CHECK (
    state NOT IN ('review','registering','approved')
    OR (output_item_id IS NOT NULL AND output_etag IS NOT NULL AND output_size IS NOT NULL)),
  CONSTRAINT presentation_video_splits_approved_shape CHECK (
    state <> 'approved' OR (request_document_id IS NOT NULL AND approved_by_profile_id IS NOT NULL AND approved_at IS NOT NULL)),
  CONSTRAINT presentation_video_splits_cleaned_shape CHECK (sandbox_cleaned_at IS NULL OR sandbox_name IS NOT NULL),
  CONSTRAINT presentation_video_splits_output_item_shape CHECK ((output_drive_id IS NULL) = (output_item_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_presentation_video_splits_processing
  ON presentation_video_splits (request_id) WHERE state IN ('queued','cutting','uploading');
CREATE UNIQUE INDEX IF NOT EXISTS idx_presentation_video_splits_awaiting
  ON presentation_video_splits (request_id) WHERE state IN ('review','registering');
CREATE INDEX IF NOT EXISTS idx_presentation_video_splits_work
  ON presentation_video_splits (state, next_attempt_at, lease_expires_at) WHERE state IN ('queued','cutting','uploading');
CREATE INDEX IF NOT EXISTS idx_presentation_video_splits_cleanup
  ON presentation_video_splits (next_cleanup_at) WHERE sandbox_name IS NOT NULL AND sandbox_cleaned_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_presentation_video_splits_request_recent
  ON presentation_video_splits (request_id, created_at DESC);
COMMENT ON TABLE presentation_video_splits IS 'Stage 4 presentation-video cut: one row per cut of the copied Zoom MP4 at the confirmed presentation end. Identifiers, lifecycle state and content-free receipts only, no names, attendance, emails or URLs.';
COMMENT ON COLUMN presentation_video_splits.lineage IS 'Content-free preimage of the source binding: provenance projection, transcript revision, boundary, source identity. Never names, attendance, emails or URLs.';
COMMENT ON COLUMN presentation_video_splits.state IS 'Worker owns queued..review, the staff approve route owns review -> registering -> approved. superseded: replaced by a newer cut or a stale source.';
COMMENT ON COLUMN presentation_video_splits.sandbox_name IS 'Written before the Sandbox is created, so cleanup is tracked by sandbox_cleaned_at independent of state.';
COMMENT ON COLUMN presentation_video_splits.upload_url_ciphertext IS 'Encrypted Graph upload session URL, never returned by a snapshot.';
COMMENT ON COLUMN presentation_video_splits.approval_claim_token IS 'Fence for the staff approve claim, never returned by a snapshot.';
COMMENT ON COLUMN presentation_video_splits.cleanup_receipt IS 'Content-free Sandbox cleanup receipt.';
COMMENT ON COLUMN presentation_video_splits.verification_receipt IS 'Content-free cut verification receipt (durations, counts, sizes).';
