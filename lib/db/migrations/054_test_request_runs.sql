-- Test Request Factory durable run ledger (design doc
-- docs/plans/TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md, "Operation contract
-- and recovery", stage "3. Basic clone"). This is operational orchestration
-- only: Dataverse remains the request/document-registry authority and
-- SharePoint remains file authority. The ledger never stores credentials,
-- bearer links, document bodies, purpose text, create request bodies, or
-- bundle contents -- only identities, hashes/digests, sizes, timestamps, and
-- sanitized error text.
--
-- test_request_runs: one row per attempted clone run, reserved atomically on
-- (actor_id, idempotency_key) so a retried confirm never creates a second
-- destination request. Step identity (current_step/step_index) is stored
-- separately from status, per the design doc's "store step identity
-- separately" instruction. Lease/fencing columns follow the
-- scheduled_email_messages convention (lib/services/scheduled-email-store.js):
-- lease_token + locked_until gate concurrent workers, and lease_generation
-- additionally fences a stale worker that held an now-expired lease.
--
-- test_request_run_resources: append-only per-resource journal. planned_identity
-- is written before the resource is dispatched to the remote system; readback
-- is written after, so a resumed run can tell "did I already create this" from
-- exact identity rather than re-deriving it.

CREATE TABLE IF NOT EXISTS test_request_runs (
  run_id                      UUID PRIMARY KEY,
  actor_id                    TEXT NOT NULL,
  idempotency_key             TEXT NOT NULL,

  status                      TEXT NOT NULL CHECK (status IN (
                                'prepared', 'creating', 'ready',
                                'needs_attention', 'retiring', 'retired'
                              )),
  current_step                TEXT NOT NULL,
  step_index                  INTEGER NOT NULL DEFAULT 0,
  recipe                      TEXT NOT NULL,

  source_dataverse_host       TEXT NOT NULL,
  source_request_id           UUID NOT NULL,
  source_request_number       TEXT NOT NULL,
  source_revision             TEXT NOT NULL,
  bundle_sha256               TEXT NOT NULL,
  bundle_exported_at          TIMESTAMPTZ NOT NULL,

  copy_policy_version         TEXT NOT NULL,
  copy_policy_digest          TEXT NOT NULL,
  plan_digest                 TEXT NOT NULL,
  create_body_sha256          TEXT NOT NULL,

  destination_environment     TEXT NOT NULL CHECK (destination_environment IN ('sandbox', 'production')),
  destination_dataverse_host  TEXT NOT NULL,
  destination_request_id      UUID NOT NULL UNIQUE,
  destination_location_id     UUID NOT NULL UNIQUE,
  destination_request_number  TEXT NULL,

  expected_app_user_id        UUID NOT NULL,
  expected_organization_id    UUID NOT NULL,
  expected_graph_site_id      TEXT NOT NULL,
  expected_graph_drive_id     TEXT NOT NULL,

  fiscal_year                 TEXT NOT NULL,
  meeting_date                DATE NOT NULL,
  test_label                  TEXT NOT NULL,

  version                     INTEGER NOT NULL DEFAULT 1,
  lease_token                 UUID NULL,
  lease_generation            INTEGER NOT NULL DEFAULT 0,
  locked_until                TIMESTAMPTZ NULL,

  attempt_count                INTEGER NOT NULL DEFAULT 0,
  needs_attention_reason      TEXT NULL,
  last_error                  TEXT NULL,

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at                TIMESTAMPTZ NULL,

  CONSTRAINT test_request_runs_actor_idempotency_key UNIQUE (actor_id, idempotency_key),

  CONSTRAINT test_request_runs_needs_attention_reason_coherence CHECK (
    (status = 'needs_attention' AND needs_attention_reason IS NOT NULL)
    OR (status <> 'needs_attention' AND needs_attention_reason IS NULL)
  ),

  CONSTRAINT test_request_runs_completed_at_coherence CHECK (
    (status = 'ready' AND completed_at IS NOT NULL)
    OR (status IN ('prepared', 'creating', 'needs_attention') AND completed_at IS NULL)
    OR status IN ('retiring', 'retired')
  )
);

CREATE INDEX IF NOT EXISTS test_request_runs_status_idx
  ON test_request_runs (status);
CREATE INDEX IF NOT EXISTS test_request_runs_actor_created_idx
  ON test_request_runs (actor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS test_request_run_resources (
  resource_id       BIGSERIAL PRIMARY KEY,
  run_id            UUID NOT NULL REFERENCES test_request_runs (run_id),
  sequence          INTEGER NOT NULL,

  step              TEXT NOT NULL,
  resource_kind     TEXT NOT NULL CHECK (resource_kind IN (
                      'dataverse_request', 'dataverse_request_patch',
                      'sharepoint_folder', 'dataverse_document_location',
                      'sharepoint_file', 'workflow_bypass'
                    )),
  system            TEXT NOT NULL CHECK (system IN ('dataverse', 'sharepoint')),

  planned_identity  JSONB NOT NULL,
  source_provenance JSONB NULL,

  dispatched_at     TIMESTAMPTZ NULL,
  response_status   INTEGER NULL,
  readback          JSONB NULL,

  outcome           TEXT NOT NULL DEFAULT 'planned' CHECK (outcome IN (
                      'planned', 'dispatched', 'verified', 'recovered',
                      'conflict', 'rejected', 'ambiguous', 'failed'
                    )),
  error             TEXT NULL,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT test_request_run_resources_run_sequence UNIQUE (run_id, sequence)
);

CREATE INDEX IF NOT EXISTS test_request_run_resources_run_step_idx
  ON test_request_run_resources (run_id, step);
