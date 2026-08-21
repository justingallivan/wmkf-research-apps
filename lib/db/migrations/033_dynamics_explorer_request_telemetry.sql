-- Dynamics Explorer Phase B: durable one-row-per-request lifecycle telemetry.
--
-- The existing query log remains one row per tool execution and api_usage_log
-- remains one row per model call. Nullable request/round columns correlate
-- those logs without invalidating historical or non-Explorer rows. Feedback
-- correlation is optional and set null when the retained request row expires.

CREATE TABLE IF NOT EXISTS dynamics_explorer_requests (
  request_id UUID PRIMARY KEY,
  user_profile_id INTEGER REFERENCES user_profiles(id) ON DELETE SET NULL,
  session_id VARCHAR(100),
  outcome VARCHAR(24) NOT NULL DEFAULT 'running'
    CONSTRAINT dynamics_explorer_requests_outcome_check
    CHECK (outcome IN (
      'running', 'completed', 'truncated', 'max_rounds',
      'refused', 'error', 'client_disconnected'
    )),
  rounds_used SMALLINT NOT NULL DEFAULT 0
    CONSTRAINT dynamics_explorer_requests_rounds_check CHECK (rounds_used >= 0),
  model VARCHAR(100),
  stop_reason VARCHAR(50),
  error_stage VARCHAR(50),
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP,
  CONSTRAINT dynamics_explorer_requests_terminal_shape CHECK (
    (outcome = 'running' AND completed_at IS NULL)
    OR (outcome <> 'running' AND completed_at IS NOT NULL)
  )
);

ALTER TABLE dynamics_query_log
  ADD COLUMN IF NOT EXISTS request_id UUID,
  ADD COLUMN IF NOT EXISTS request_round SMALLINT;

ALTER TABLE api_usage_log
  ADD COLUMN IF NOT EXISTS request_id UUID,
  ADD COLUMN IF NOT EXISTS request_round SMALLINT;

ALTER TABLE dynamics_feedback
  ADD COLUMN IF NOT EXISTS request_id UUID
    REFERENCES dynamics_explorer_requests(request_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_dynamics_explorer_requests_started
  ON dynamics_explorer_requests(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_dynamics_explorer_requests_outcome_started
  ON dynamics_explorer_requests(outcome, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_dynamics_explorer_requests_user_started
  ON dynamics_explorer_requests(user_profile_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_dynamics_explorer_requests_session
  ON dynamics_explorer_requests(session_id);
CREATE INDEX IF NOT EXISTS idx_dynamics_query_log_request_round
  ON dynamics_query_log(request_id, request_round) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_api_usage_request_round
  ON api_usage_log(request_id, request_round) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dynamics_feedback_request
  ON dynamics_feedback(request_id) WHERE request_id IS NOT NULL;

COMMENT ON TABLE dynamics_explorer_requests IS
  'One lifecycle row per authenticated, body-valid Dynamics Explorer chat request; no prompt or answer content.';
COMMENT ON COLUMN dynamics_explorer_requests.outcome IS
  'Mutable lifecycle state. Old running rows are reported as derived abandoned, not rewritten by maintenance.';
COMMENT ON COLUMN dynamics_query_log.request_round IS
  'One-based Explorer model round that produced this tool execution row.';
COMMENT ON COLUMN api_usage_log.request_round IS
  'One-based Explorer model round for this provider usage row; null for other apps.';
