-- Superuser D26 pilot: private dossiers/editions, shared generated request entries.
-- Payload bytes live in the dedicated private dossier Blob store; JSON holds refs/checkpoints.
CREATE TABLE IF NOT EXISTS cycle_dossiers (
  id UUID PRIMARY KEY, owner_profile_id INTEGER NOT NULL REFERENCES user_profiles(id),
  cycle TEXT NOT NULL DEFAULT 'D26' CHECK (cycle = 'D26'), selection JSONB,
  latest_edition_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE (owner_profile_id, cycle)
);
CREATE TABLE IF NOT EXISTS cycle_dossier_previews (
  id UUID PRIMARY KEY, owner_profile_id INTEGER NOT NULL REFERENCES user_profiles(id),
  dossier_id UUID NOT NULL REFERENCES cycle_dossiers(id), data JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 minutes',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS cycle_dossier_entries (
  id UUID PRIMARY KEY, request_id UUID NOT NULL, cycle TEXT NOT NULL DEFAULT 'D26' CHECK (cycle = 'D26'),
  revision BIGINT GENERATED ALWAYS AS IDENTITY, created_by INTEGER NOT NULL REFERENCES user_profiles(id),
  data JSONB NOT NULL, ready BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS cycle_dossier_entries_latest ON cycle_dossier_entries(request_id, revision DESC) WHERE ready;
CREATE TABLE IF NOT EXISTS cycle_dossier_runs (
  id UUID PRIMARY KEY, owner_profile_id INTEGER NOT NULL REFERENCES user_profiles(id),
  dossier_id UUID NOT NULL REFERENCES cycle_dossiers(id), idempotency_key UUID NOT NULL,
  launch_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','paused','cancelled','completed','partial','failed')),
  data JSONB NOT NULL, lease_token UUID, locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(owner_profile_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS cycle_dossier_runs_queue ON cycle_dossier_runs(status, created_at);
CREATE TABLE IF NOT EXISTS cycle_dossier_control (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id=TRUE),
  stop_requested BOOLEAN NOT NULL DEFAULT FALSE,
  reason TEXT,
  updated_by INTEGER REFERENCES user_profiles(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO cycle_dossier_control(id) VALUES(TRUE) ON CONFLICT(id) DO NOTHING;
CREATE TABLE IF NOT EXISTS cycle_dossier_editions (
  id UUID PRIMARY KEY, owner_profile_id INTEGER NOT NULL REFERENCES user_profiles(id),
  dossier_id UUID NOT NULL REFERENCES cycle_dossiers(id), run_id UUID NOT NULL REFERENCES cycle_dossier_runs(id),
  cut_key TEXT NOT NULL, data JSONB NOT NULL, ready BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(run_id, cut_key)
);
