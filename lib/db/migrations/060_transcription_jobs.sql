-- Durable owner-bound state for the non-sensitive AssemblyAI transcription
-- pilot. Audio and derived content remain in private Blob storage.
CREATE TABLE IF NOT EXISTS transcription_jobs (
  id UUID PRIMARY KEY,
  owner_profile_id INTEGER NOT NULL REFERENCES user_profiles(id),
  idempotency_key UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  non_sensitive_acknowledged_at TIMESTAMPTZ,
  original_filename TEXT,
  declared_content_type TEXT,
  declared_bytes BIGINT CHECK (declared_bytes IS NULL OR declared_bytes BETWEEN 1 AND 52428800),
  verified_content_type TEXT,
  verified_bytes BIGINT CHECK (verified_bytes IS NULL OR verified_bytes BETWEEN 1 AND 52428800),
  audio_duration_ms BIGINT CHECK (audio_duration_ms IS NULL OR audio_duration_ms BETWEEN 1 AND 14400000),
  audio_sha256 CHAR(64),
  audio_etag TEXT,
  audio_pathname TEXT,
  input_cleanup_pathname TEXT,
  provider_region TEXT DEFAULT 'us',
  requested_model TEXT,
  returned_model TEXT,
  options_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  provider_upload_ref_ciphertext TEXT,
  provider_transcript_id TEXT UNIQUE,
  attempt_correlation_id UUID UNIQUE,
  callback_candidate_transcript_id TEXT,
  conflicting_transcript_id TEXT,
  provider_id_conflict BOOLEAN NOT NULL DEFAULT FALSE,
  submission_intent_at TIMESTAMPTZ,
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'uploading',
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sanitized_error_code TEXT,
  output_pathname TEXT,
  output_cleanup_pathname TEXT,
  output_sha256 CHAR(64),
  diagnostic_pathname TEXT,
  diagnostic_cleanup_pathname TEXT,
  diagnostic_sha256 CHAR(64),
  ready_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  receipt_expires_at TIMESTAMPTZ NOT NULL,
  word_accuracy_score SMALLINT CHECK (word_accuracy_score IS NULL OR word_accuracy_score BETWEEN 1 AND 5),
  speaker_accuracy_score SMALLINT CHECK (speaker_accuracy_score IS NULL OR speaker_accuracy_score BETWEEN 1 AND 5),
  correction_notes TEXT CHECK (correction_notes IS NULL OR char_length(correction_notes) <= 4000),
  content_purged_at TIMESTAMPTZ,
  reference_purged_at TIMESTAMPTZ,
  abandonment_acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  abandoned_at TIMESTAMPTZ,
  cleanup_requested_at TIMESTAMPTZ,
  provider_cleanup_completed_at TIMESTAMPTZ,
  local_cleanup_completed_at TIMESTAMPTZ,
  audio_deleted_at TIMESTAMPTZ,
  CONSTRAINT transcription_jobs_state_check CHECK (
    status IN ('uploading', 'queued', 'submitting', 'processing', 'saving',
               'ready', 'failed', 'submission_uncertain', 'expired')
  ),
  CONSTRAINT transcription_jobs_owner_idempotency_unique UNIQUE (owner_profile_id, idempotency_key),
  CONSTRAINT transcription_jobs_lease_shape CHECK (
    (lease_token IS NULL AND lease_expires_at IS NULL)
    OR (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
  ),
  CONSTRAINT transcription_jobs_attempt_shape CHECK (
    attempt_correlation_id IS NULL OR submission_intent_at IS NOT NULL
  ),
  CONSTRAINT transcription_jobs_submitting_shape CHECK (
    status <> 'submitting'
    OR lease_token IS NOT NULL
  ),
  CONSTRAINT transcription_jobs_conflict_shape CHECK (
    (provider_id_conflict = FALSE AND conflicting_transcript_id IS NULL)
    OR (provider_id_conflict = TRUE AND conflicting_transcript_id IS NOT NULL)
  ),
  CONSTRAINT transcription_jobs_uncertain_shape CHECK (
    status <> 'submission_uncertain'
    OR (submission_intent_at IS NOT NULL
        AND attempt_correlation_id IS NOT NULL
        AND (provider_upload_ref_ciphertext IS NOT NULL OR reference_purged_at IS NOT NULL))
  ),
  CONSTRAINT transcription_jobs_ready_shape CHECK (
    (status = 'ready'
      AND output_pathname IS NOT NULL
      AND output_sha256 IS NOT NULL
      AND output_sha256 ~ '^[0-9a-f]{64}$'
      AND ready_at IS NOT NULL
      AND content_purged_at IS NULL)
    OR status <> 'ready'
  ),
  CONSTRAINT transcription_jobs_purged_content_shape CHECK (
    content_purged_at IS NULL
    OR (audio_pathname IS NULL AND output_pathname IS NULL
        AND diagnostic_pathname IS NULL AND correction_notes IS NULL
        AND original_filename IS NULL AND audio_sha256 IS NULL AND audio_etag IS NULL)
  ),
  CONSTRAINT transcription_jobs_digest_shape CHECK (
    (audio_sha256 IS NULL OR audio_sha256 ~ '^[0-9a-f]{64}$')
    AND (output_sha256 IS NULL OR output_sha256 ~ '^[0-9a-f]{64}$')
    AND (diagnostic_sha256 IS NULL OR diagnostic_sha256 ~ '^[0-9a-f]{64}$')
  ),
  CONSTRAINT transcription_jobs_region_check CHECK (provider_region IN ('us', 'eu')),
  CONSTRAINT transcription_jobs_abandonment_shape CHECK (
    (abandonment_acknowledged = FALSE AND abandoned_at IS NULL)
    OR (abandonment_acknowledged = TRUE AND abandoned_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_transcription_jobs_global_active_slot
  ON transcription_jobs ((TRUE))
  WHERE status IN ('submitting', 'processing', 'saving', 'submission_uncertain');

CREATE INDEX IF NOT EXISTS idx_transcription_jobs_owner_recent
  ON transcription_jobs (owner_profile_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_transcription_jobs_worker_due
  ON transcription_jobs (status, next_attempt_at, lease_expires_at, created_at)
  WHERE status IN ('queued', 'submitting', 'processing', 'saving', 'submission_uncertain');

CREATE INDEX IF NOT EXISTS idx_transcription_jobs_cleanup_due
  ON transcription_jobs (cleanup_requested_at, lease_expires_at, updated_at)
  WHERE cleanup_requested_at IS NOT NULL
    AND local_cleanup_completed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_transcription_jobs_expiry_due
  ON transcription_jobs (expires_at, receipt_expires_at);

COMMENT ON TABLE transcription_jobs IS
  'Owner-bound temporary AssemblyAI transcription pilot ledger. Audio/transcript content remains in private Blob storage.';
