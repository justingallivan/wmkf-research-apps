-- Operational receipts only. Dataverse remains the owner of cycle settings and document references.
-- 084 is intentionally not reused: the superseded branch may have applied its different schema.
CREATE TABLE IF NOT EXISTS board_writeup_runs (
  program_id UUID NOT NULL,
  cycle_code TEXT NOT NULL CHECK (cycle_code ~ '^[JD][0-9]{2}$'),
  revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
  state JSONB NOT NULL CHECK (jsonb_typeof(state) = 'object' AND state->>'version' = '1'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (program_id, cycle_code),
  CHECK (octet_length(state::text) <= 2000000)
);
COMMENT ON TABLE board_writeup_runs IS 'Research Board writeup cycle lock, request-keyed release/archive receipts, approval history, configuration audit and email activity receipts. Retained for historical access; no automatic deletion.';
