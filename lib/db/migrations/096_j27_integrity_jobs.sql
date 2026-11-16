-- Isolated background screens requested by a saved J27 Semi-finalist Yes.
CREATE TABLE IF NOT EXISTS j27_integrity_jobs (
  target_host TEXT NOT NULL,
  request_id UUID NOT NULL,
  actor_profile_id INTEGER NOT NULL REFERENCES user_profiles(id),
  expected_version TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'completed', 'failed', 'skipped')),
  available_at TIMESTAMPTZ NOT NULL,
  confirmed_at TIMESTAMPTZ,
  lease_token UUID,
  lease_until TIMESTAMPTZ,
  screening_id INTEGER REFERENCES integrity_screenings(id),
  flagged BOOLEAN NOT NULL DEFAULT false,
  failure_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (target_host, request_id),
  CHECK ((state = 'running') = (lease_token IS NOT NULL AND lease_until IS NOT NULL)),
  CHECK ((state = 'completed') = (screening_id IS NOT NULL)),
  CHECK (NOT flagged OR state = 'completed')
);
