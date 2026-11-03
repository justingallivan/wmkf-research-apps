-- Operational Factory ledger only. Apply through ledger:apply to managed ledgers
-- as a separately authorized release step; this file performs no Dataverse writes.
CREATE TABLE IF NOT EXISTS test_request_readiness_finalizations (
  run_id UUID NOT NULL REFERENCES test_request_runs(run_id),
  attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt > 0),
  PRIMARY KEY (run_id, attempt),
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','dispatched','applied','complete','needs_attention','abandoned')),
  etag_before TEXT NOT NULL CHECK (etag_before ~ '^W/"[0-9]{1,20}"$'),
  ready_before BOOLEAN NULL CHECK (ready_before IS DISTINCT FROM TRUE),
  ready_after BOOLEAN NULL,
  dispatched_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  effects JSONB NULL CHECK (test_request_receipt_ok(effects)),
  error TEXT NULL CHECK (length(error) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT test_request_readiness_dispatch_coherence CHECK (
    (status = 'planned' AND dispatched_at IS NULL) OR
    (status = 'abandoned') OR
    (status NOT IN ('planned','abandoned') AND dispatched_at IS NOT NULL)),
  CONSTRAINT test_request_readiness_complete_coherence CHECK (
    (status = 'complete' AND ready_after IS TRUE AND completed_at IS NOT NULL) OR
    (status <> 'complete' AND completed_at IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS test_request_readiness_one_open
  ON test_request_readiness_finalizations(run_id)
  WHERE status IN ('planned','dispatched','applied');
