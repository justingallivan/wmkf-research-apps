-- Meeting Tracker transcription remains disabled until shared schema readiness
-- and access controls are explicitly enabled. Content stays in governed SharePoint.
ALTER TABLE transcription_jobs
  ADD COLUMN IF NOT EXISTS request_id UUID,
  ADD COLUMN IF NOT EXISTS site_visit_activity_id UUID,
  ADD COLUMN IF NOT EXISTS publication_operation_id UUID,
  ADD COLUMN IF NOT EXISTS updated_by_profile_id INTEGER REFERENCES user_profiles(id);

DO $$ BEGIN
  ALTER TABLE transcription_jobs
    ADD CONSTRAINT transcription_jobs_request_visit_shape
    CHECK ((request_id IS NULL) = (site_visit_activity_id IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_transcription_jobs_request_recent
  ON transcription_jobs (request_id, created_at DESC, id DESC)
  WHERE request_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS meeting_transcript_publications (
  operation_id UUID PRIMARY KEY,
  request_id UUID NOT NULL,
  site_visit_activity_id UUID NOT NULL,
  initiator_profile_id INTEGER NOT NULL REFERENCES user_profiles(id),
  published_by_profile_id INTEGER REFERENCES user_profiles(id),
  published_by_system_id UUID,
  input_job_id UUID REFERENCES transcription_jobs(id),
  input_job_version INTEGER,
  source_artifact_id UUID,
  source_revision_id UUID,
  expected_current_artifact_id UUID,
  expected_current_fingerprint CHAR(64),
  frozen_input_sha256 CHAR(64),
  formatter_version TEXT,
  state TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  frozen_speaker_names JSONB,
  speaker_names JSONB,
  candidate_paths JSONB,
  slot_fence_version INTEGER,
  verified_files JSONB,
  resulting_document_id UUID,
  error_code TEXT,
  expires_at TIMESTAMPTZ,
  quarantine_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT meeting_transcript_publications_state_check
    CHECK (state IN ('draft','publishing','published','published_reconcile','retryable','unknown','closed')),
  CONSTRAINT meeting_transcript_publications_lease_shape
    CHECK ((lease_token IS NULL AND lease_expires_at IS NULL)
      OR (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CONSTRAINT meeting_transcript_publications_expected_hash_shape
    CHECK (expected_current_fingerprint IS NULL OR expected_current_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT meeting_transcript_publications_input_hash_shape
    CHECK (frozen_input_sha256 IS NULL OR frozen_input_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT meeting_transcript_publications_names_shape
    CHECK (frozen_speaker_names IS NULL OR
      (jsonb_typeof(frozen_speaker_names) = 'object' AND pg_column_size(frozen_speaker_names) <= 65536)),
  CONSTRAINT meeting_transcript_publications_draft_names_shape
    CHECK (speaker_names IS NULL OR
      (jsonb_typeof(speaker_names) = 'object' AND pg_column_size(speaker_names) <= 65536)),
  CONSTRAINT meeting_transcript_publications_candidates_shape
    CHECK (candidate_paths IS NULL OR
      (jsonb_typeof(candidate_paths) = 'object' AND pg_column_size(candidate_paths) <= 16384)),
  CONSTRAINT meeting_transcript_publications_files_shape
    CHECK (verified_files IS NULL OR
      (jsonb_typeof(verified_files) = 'object' AND pg_column_size(verified_files) <= 32768)),
  CONSTRAINT meeting_transcript_publications_fence_shape
    CHECK (slot_fence_version IS NULL OR slot_fence_version > 0),
  CONSTRAINT meeting_transcript_publications_source_shape
    CHECK ((input_job_id IS NOT NULL) <> (source_artifact_id IS NOT NULL)),
  CONSTRAINT meeting_transcript_publications_expiry_shape
    CHECK (expires_at IS NULL OR state = 'draft')
);

CREATE INDEX IF NOT EXISTS idx_meeting_transcript_publications_request_recent
  ON meeting_transcript_publications (request_id, created_at DESC, operation_id DESC);

CREATE INDEX IF NOT EXISTS idx_meeting_transcript_publications_recovery
  ON meeting_transcript_publications (state, lease_expires_at, updated_at)
  WHERE state IN ('publishing','retryable','unknown','published_reconcile');

CREATE INDEX IF NOT EXISTS idx_meeting_transcript_publications_job_unresolved
  ON meeting_transcript_publications (input_job_id, state)
  WHERE input_job_id IS NOT NULL AND state IN ('publishing','retryable','unknown','published_reconcile');

COMMENT ON TABLE meeting_transcript_publications IS
  'Meeting Tracker transcript publication receipts and label-only correction drafts; transcript bytes remain in governed SharePoint.';
