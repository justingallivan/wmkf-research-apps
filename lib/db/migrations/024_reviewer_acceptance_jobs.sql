-- Migration 024: Reviewer acceptance follow-up jobs
--
-- The external reviewer accept endpoint must return as soon as the durable accept
-- state is committed. This queue records the slower post-accept work (honorarium
-- capture, contact/person sync, confirmation email, quota notice) so Vercel Cron
-- can drain it without making the reviewer wait on Dataverse/BILL/email tails.
--
-- Dataverse `wmkf_appreviewersuggestion` remains the source of truth for whether
-- the reviewer accepted. This table is a retry ledger for side effects only.

CREATE TABLE IF NOT EXISTS reviewer_acceptance_jobs (
  id              BIGSERIAL PRIMARY KEY,
  acceptance_key  TEXT NOT NULL UNIQUE,
  suggestion_id   UUID NOT NULL,
  request_id      UUID,
  reviewer_id     UUID,
  accepted_at     TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL DEFAULT 'accept_pending',
  payload         JSONB NOT NULL,
  steps           JSONB NOT NULL DEFAULT '{}'::jsonb,
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_until    TIMESTAMPTZ,
  lease_token     UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,

  CONSTRAINT reviewer_acceptance_jobs_status_check CHECK (status IN (
    'accept_pending',
    'queued',
    'completed',
    'failed',
    'cancelled'
  )),
  CONSTRAINT reviewer_acceptance_jobs_attempts_nonneg CHECK (attempts >= 0),
  CONSTRAINT reviewer_acceptance_jobs_completed_when_terminal CHECK (
    (status IN ('completed', 'failed', 'cancelled')) = (completed_at IS NOT NULL)
  )
);

-- One logical follow-up job per accepted lifecycle timestamp. Re-accepts of a
-- row that was already accepted reuse the same accepted_at value and therefore
-- the same job; if a terminal failed/cancelled job exists, the service may requeue
-- it instead of minting a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reviewer_acceptance_jobs_suggestion_accepted
  ON reviewer_acceptance_jobs (suggestion_id, accepted_at);

-- Drain query: ready, unlocked non-terminal jobs in FIFO-ish order.
CREATE INDEX IF NOT EXISTS idx_reviewer_acceptance_jobs_ready
  ON reviewer_acceptance_jobs (next_attempt_at, locked_until, created_at)
  WHERE status IN ('accept_pending', 'queued');

CREATE INDEX IF NOT EXISTS idx_reviewer_acceptance_jobs_suggestion
  ON reviewer_acceptance_jobs (suggestion_id);

CREATE INDEX IF NOT EXISTS idx_reviewer_acceptance_jobs_request
  ON reviewer_acceptance_jobs (request_id);

CREATE INDEX IF NOT EXISTS idx_reviewer_acceptance_jobs_status
  ON reviewer_acceptance_jobs (status);

CREATE INDEX IF NOT EXISTS idx_reviewer_acceptance_jobs_created
  ON reviewer_acceptance_jobs (created_at DESC);

COMMENT ON TABLE reviewer_acceptance_jobs IS 'Reviewer acceptance post-commit side-effect queue drained by /api/cron/drain-reviewer-acceptances. Dataverse remains authoritative for accepted state.';
COMMENT ON COLUMN reviewer_acceptance_jobs.payload IS 'Frozen accept-time payload: request/reviewer/suggestion snapshots, submitted contact/address/identity fields, policy acknowledgements, opt-out, and repeat/fresh flag.';
COMMENT ON COLUMN reviewer_acceptance_jobs.steps IS 'Per-side-effect progress markers used to avoid duplicate courtesy sends and aid retry/debug.';
