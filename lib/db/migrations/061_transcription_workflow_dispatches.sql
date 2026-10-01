-- Durable, job-scoped delivery state for Vercel Workflow starts.
-- Workflow run IDs are operational metadata only; audio/provider data never enters this table.
CREATE TABLE IF NOT EXISTS transcription_workflow_dispatches (
  job_id UUID PRIMARY KEY REFERENCES transcription_jobs(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'dispatching', 'running', 'completed')),
  attempt_no INTEGER NOT NULL DEFAULT 0 CHECK (attempt_no >= 0),
  dispatch_token UUID,
  lease_expires_at TIMESTAMPTZ,
  workflow_run_id TEXT,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error_code TEXT CHECK (last_error_code IS NULL OR last_error_code ~ '^[a-z0-9_]{1,64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT transcription_workflow_dispatch_lease_shape CHECK (
    (state = 'dispatching' AND dispatch_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (state <> 'dispatching' AND dispatch_token IS NULL AND lease_expires_at IS NULL)
  ),
  CONSTRAINT transcription_workflow_dispatch_run_shape CHECK (
    state <> 'running' OR workflow_run_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_transcription_workflow_dispatch_due
  ON transcription_workflow_dispatches (next_attempt_at, created_at, job_id)
  WHERE state IN ('pending', 'dispatching');

COMMENT ON TABLE transcription_workflow_dispatches IS
  'Transactional outbox for job-scoped durable workflow starts; contains no audio, transcript, or provider identifiers.';

-- Preserve already-queued jobs when this migration is applied to an existing
-- installation; the dedicated pilot database was empty at initialization.
INSERT INTO transcription_workflow_dispatches (job_id)
SELECT id FROM transcription_jobs WHERE status = 'queued'
ON CONFLICT (job_id) DO NOTHING;
