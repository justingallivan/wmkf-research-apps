CREATE TABLE IF NOT EXISTS staff_deliberations_preparations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL,
  program_id UUID NOT NULL,
  cycle_code TEXT NOT NULL CHECK (cycle_code ~ '^[JD][0-9]{2}$'),
  site_visit_id UUID NOT NULL,
  scheduled_end TIMESTAMPTZ NOT NULL,
  event_modified_on TIMESTAMPTZ,
  event_state_code INTEGER NOT NULL,
  event_status_code INTEGER NOT NULL,
  correction_epoch TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','running','prepared','blocked')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  document_id UUID,
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_error_code TEXT,
  last_error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  prepared_at TIMESTAMPTZ,
  UNIQUE (request_id, site_visit_id, scheduled_end, correction_epoch),
  CHECK ((lease_token IS NULL AND lease_expires_at IS NULL)
      OR (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK (state <> 'prepared' OR (document_id IS NOT NULL AND prepared_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_staff_deliberations_preparations_due
  ON staff_deliberations_preparations (next_attempt_at, scheduled_end)
  WHERE state IN ('pending','running');

CREATE INDEX IF NOT EXISTS idx_staff_deliberations_preparations_request
  ON staff_deliberations_preparations (request_id, updated_at DESC);
