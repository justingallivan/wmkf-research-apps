-- Migration 028: Review synthesis generation ledger and automatic queue
--
-- The synthesis memo remains on akoya_request in Dataverse. This table records
-- which exact review/lifecycle fingerprint produced it, provides durable
-- automatic-generation deduplication, and exposes queued/running/failed state
-- to the Workbench. It deliberately stores no review text.

CREATE TABLE IF NOT EXISTS review_synthesis_jobs (
  id                    BIGSERIAL PRIMARY KEY,
  generation_key        UUID NOT NULL UNIQUE,
  dedupe_key             TEXT NOT NULL UNIQUE,
  request_id             UUID NOT NULL,
  input_hash             TEXT NOT NULL,
  mode                   TEXT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'queued',
  acting_user_system_id  UUID,
  run_id                 TEXT,
  attempts               INTEGER NOT NULL DEFAULT 0,
  last_error             TEXT,
  next_attempt_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_until           TIMESTAMPTZ,
  lease_token            UUID,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at             TIMESTAMPTZ,
  completed_at           TIMESTAMPTZ,

  CONSTRAINT review_synthesis_jobs_mode_check
    CHECK (mode IN ('automatic', 'manual')),
  CONSTRAINT review_synthesis_jobs_status_check
    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  CONSTRAINT review_synthesis_jobs_hash_check
    CHECK (input_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT review_synthesis_jobs_attempts_nonneg
    CHECK (attempts >= 0),
  CONSTRAINT review_synthesis_jobs_completed_when_terminal CHECK (
    (status IN ('completed', 'failed', 'cancelled')) = (completed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_review_synthesis_jobs_ready
  ON review_synthesis_jobs (next_attempt_at, locked_until, created_at)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS idx_review_synthesis_jobs_request_latest
  ON review_synthesis_jobs (request_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_review_synthesis_jobs_request_hash_completed
  ON review_synthesis_jobs (request_id, input_hash, completed_at DESC)
  WHERE status = 'completed';

CREATE INDEX IF NOT EXISTS idx_review_synthesis_jobs_status
  ON review_synthesis_jobs (status);

COMMENT ON TABLE review_synthesis_jobs IS
  'Review-synthesis queue/currentness ledger. Dataverse akoya_request.wmkf_reviewsynthesisjson remains the synthesis content source of truth.';
COMMENT ON COLUMN review_synthesis_jobs.input_hash IS
  'SHA-256 of the exact submitted-review digest plus participating reviewer lifecycle classifications; no review content is stored.';
COMMENT ON COLUMN review_synthesis_jobs.dedupe_key IS
  'Automatic jobs use automatic:<requestId>:<inputHash>; manual runs use a unique generation-scoped key.';
