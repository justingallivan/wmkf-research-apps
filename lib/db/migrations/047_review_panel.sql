-- Virtual Review Panel Phase A foundation (docs/plans/VIRTUAL_REVIEW_PANEL_PHASE_A_BUILD_PLAN_2026-09-12.md §5 A.5).
-- Mirrors the Cycle Dossier tables (045/046) where the concept matches:
-- review_panels/review_panel_runs/review_panel_control are the dossier's
-- cycle_dossiers/cycle_dossier_runs/cycle_dossier_control shape, minus the
-- cycle='D26' constraint (the panel is not cycle-scoped). Per-request revision
-- numbers land in this migration from day one (mirrors 046, applied at birth
-- instead of as a follow-up).
--
-- review_panel_entries.winners_json is a JSONB map `{ seatKey: attemptId }`
-- chosen over a separate review_panel_entry_seat_winners join table: the
-- cardinality is fixed and small (one row per configured seat plus the chair,
-- per the seat registry in shared/config/reviewPanelSeats.js), so a map column
-- is the simplest representation of "one winner per seat per entry" and avoids
-- an extra table for a handful of keys.
--
-- review_panel_seat_attempts is the per-seat paid-call ledger. dispatch_token
-- is immutable once set: the only writer that sets it is
-- markAttemptDispatched (lib/services/review-panel-store.js), gated on
-- state='pending'; no other function ever assigns it. state has exactly four
-- writers: markAttemptDispatched (pending->dispatched), the two CAS UPDATEs
-- inside finalizeAttempt (the in-lease completion and the late/unknown-outcome
-- path), and reapExpiredAttempts (dispatched->unknown_outcome on lease
-- expiry). No other code may write this column.
CREATE TABLE IF NOT EXISTS review_panels (
  id UUID PRIMARY KEY, owner_profile_id INTEGER NOT NULL REFERENCES user_profiles(id),
  selection JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE (owner_profile_id)
);
CREATE TABLE IF NOT EXISTS review_panel_runs (
  id UUID PRIMARY KEY, owner_profile_id INTEGER NOT NULL REFERENCES user_profiles(id),
  panel_id UUID NOT NULL REFERENCES review_panels(id), idempotency_key UUID NOT NULL,
  launch_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','paused','cancelled','completed','partial','failed')),
  data JSONB NOT NULL DEFAULT '{}'::jsonb, lease_token UUID, locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_profile_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS review_panel_runs_queue ON review_panel_runs(status, created_at);
CREATE TABLE IF NOT EXISTS review_panel_entries (
  id UUID PRIMARY KEY, run_id UUID NOT NULL REFERENCES review_panel_runs(id),
  request_id UUID NOT NULL, revision BIGINT GENERATED ALWAYS AS IDENTITY,
  request_revision INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed')),
  data JSONB NOT NULL DEFAULT '{}'::jsonb, winners_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by INTEGER NOT NULL REFERENCES user_profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS review_panel_entries_request_revision
  ON review_panel_entries (request_id, request_revision);
CREATE INDEX IF NOT EXISTS review_panel_entries_run ON review_panel_entries(run_id);
COMMENT ON COLUMN review_panel_entries.request_revision IS
  'Revision number within the request (1, 2, …); revision is the table-wide append order (mirrors cycle_dossier_entries).';
CREATE TABLE IF NOT EXISTS review_panel_seat_attempts (
  id UUID PRIMARY KEY, entry_id UUID NOT NULL REFERENCES review_panel_entries(id),
  seat_key TEXT NOT NULL, attempt_no INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','dispatched','completed','failed','unknown_outcome')),
  dispatch_token TEXT, lease_token UUID, dispatched_at TIMESTAMPTZ, dispatch_expires_at TIMESTAMPTZ,
  provider TEXT, model TEXT,
  prompt_snapshot_json JSONB, result_json JSONB, late_result_json JSONB,
  usage_json JSONB, late_usage_json JSONB,
  cost_cents NUMERIC, cost_state TEXT CHECK (cost_state IN ('known','unknown')),
  error_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entry_id, seat_key, attempt_no)
);
CREATE INDEX IF NOT EXISTS review_panel_seat_attempts_entry ON review_panel_seat_attempts(entry_id);
CREATE INDEX IF NOT EXISTS review_panel_seat_attempts_reap
  ON review_panel_seat_attempts(state, dispatch_expires_at) WHERE state = 'dispatched';
CREATE TABLE IF NOT EXISTS review_panel_control (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id = TRUE),
  stop_requested BOOLEAN NOT NULL DEFAULT FALSE,
  reason TEXT,
  updated_by INTEGER REFERENCES user_profiles(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO review_panel_control(id) VALUES (TRUE) ON CONFLICT(id) DO NOTHING;
