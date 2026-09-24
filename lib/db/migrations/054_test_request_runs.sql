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

-- Receipt grammar, enforced in PostgreSQL as well as in run-ledger.js
-- (Codex round twelve): a receipt is a flat object whose keys are the
-- allowlisted receipt keys (or `<stem>At` timestamps) and whose values match
-- each key's grammar. No URL, control character, credential prefix, nested
-- object or unknown key can be stored, whichever writer inserts the row.
CREATE OR REPLACE FUNCTION test_request_receipt_ok(receipt JSONB) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $receipt$
  SELECT receipt IS NULL OR (
    jsonb_typeof(receipt) = 'object'
    AND (SELECT count(*) FROM jsonb_object_keys(receipt)) <= 40
    AND NOT EXISTS (
      SELECT 1
        FROM jsonb_each(receipt) AS e(key, value)
        CROSS JOIN LATERAL (SELECT e.value #>> '{}' AS v, jsonb_typeof(e.value) AS t) AS s
       WHERE NOT (
         (e.key IN ('size', 'statusCode', 'responseStatus', 'sequence', 'index', 'count', 'versionNumber') AND s.t = 'number')
         OR (e.key IN ('sha256Match', 'sizeMatch', 'recovered', 'recoveredByExactItem', 'restored', 'restoreVerified', 'restoreWasAlreadyActive', 'manualRecheckRequired', 'matched', 'exists', 'ok') AND s.t = 'boolean')
         OR (e.key IN ('requestIds', 'locationIds') AND s.t = 'array' AND NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(e.value) AS a WHERE jsonb_typeof(a) <> 'string' OR (a #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
         OR (e.key = 'itemIds' AND s.t = 'array' AND NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(e.value) AS a WHERE jsonb_typeof(a) <> 'string' OR (a #>> '{}') !~ '^01[A-Z2-7]{32}$'))
         OR (e.key = 'resourceIds' AND s.t = 'array' AND NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(e.value) AS a WHERE jsonb_typeof(a) <> 'string' OR (a #>> '{}') !~ '^[0-9]{1,20}$'))
         OR (
           s.t = 'string'
           AND length(s.v) BETWEEN 1 AND 200
           AND s.v !~ '(://|[[:cntrl:]])'
           AND s.v !~ '(^|[^A-Za-z0-9])(gh[pousr]_|github_pat_|sk-|xox[abprs]-|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{8}|glpat-|AIza|Bearer_)'
           AND CASE
             WHEN e.key IN ('requestId', 'runId', 'locationId', 'parentLocationId', 'workflowId', 'ownerId', 'createdById', 'expectedAppUserId', 'applicantId', 'organizationId') THEN s.v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             WHEN e.key = 'requestNumber' THEN s.v ~ '^[0-9]{1,10}$'
             WHEN e.key IN ('itemId', 'folderItemId', 'graphItemId', 'sourceGraphItemId') THEN s.v ~ '^01[A-Z2-7]{32}$'
             WHEN e.key IN ('driveId', 'sourceDriveId') THEN s.v ~ '^b![A-Za-z0-9_-]{16,120}$'
             WHEN e.key = 'siteId' THEN s.v ~* '^[a-z0-9.-]+[.]sharepoint[.]com,[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12},[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             WHEN e.key = 'library' THEN s.v ~ '^[a-z][a-z0-9_]{1,60}$'
             WHEN e.key IN ('folder', 'relativeUrl') THEN s.v ~ '^([0-9]{1,10}_[0-9A-F]{32}(/(Phase I|AI Materials|Reviewer Materials))?|(Phase I|AI Materials|Reviewer Materials))$'
             WHEN e.key IN ('filename', 'name') THEN s.v ~ '^((Proposal|ProposalNarrative|ProposalBibliography)_[0-9]{1,10}[.]pdf|(ProjectDescription|Biosketches|ProjectBudget)[.]pdf|Project Budget spreadsheet[.]xlsx)$'
             WHEN e.key = 'mimeType' THEN s.v ~ '^[a-z]+/[a-z0-9.+-]{1,80}$'
             WHEN e.key = 'eTag' THEN s.v ~ '^(W/)?"[{]?[0-9A-Za-z-]{1,40}[}]?(,[0-9]{1,9})?"$'
             WHEN e.key = 'versionId' THEN s.v ~ '^([0-9]{1,6}[.][0-9]{1,6}|[0-9]{1,12}|[0-9A-Za-z]{1,40})$'
             WHEN e.key IN ('versionNumber', 'versionNumberBefore', 'versionNumberAfter') THEN s.v ~ '^[0-9]{1,20}$'
             WHEN e.key = 'contentHash' THEN s.v ~ '^[0-9a-f]{64}$'
             WHEN e.key IN ('outcome', 'kind') THEN s.v ~ '^[a-z][a-z0-9_-]{0,39}$'
             WHEN e.key = 'field' THEN s.v ~ '^[a-z][a-z0-9_]{0,63}$'
             WHEN e.key IN ('expectedValue', 'actualValue', 'valueBefore', 'valueAfter', 'fiscalYear', 'meetingDate') THEN s.v ~ '^([0-9]{4}-[0-9]{2}-[0-9]{2}(T[0-9]{2}:[0-9]{2}(:[0-9]{2}([.][0-9]{1,3})?)?Z?)?|(January|February|March|April|May|June|July|August|September|October|November|December) [0-9]{4})$'
             WHEN e.key ~ '^[a-z][A-Za-z0-9]{0,40}At$' AND e.key !~* 'body|content|purpose|token|secret|download|narrative|bytes|title|text|note|message' THEN s.v ~ '^([0-9]{4}-[0-9]{2}-[0-9]{2}(T[0-9]{2}:[0-9]{2}(:[0-9]{2}([.][0-9]{1,3})?)?Z?)?|(January|February|March|April|May|June|July|August|September|October|November|December) [0-9]{4})$'
             ELSE FALSE
           END
         )
       )
    )
  )
$receipt$;

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
  ),
  CONSTRAINT test_request_runs_request_number_shape CHECK (
    destination_request_number IS NULL OR destination_request_number ~ '^[0-9]{1,10}$'
  ),
  CONSTRAINT test_request_runs_ready_request_number CHECK (
    status <> 'ready' OR (destination_request_number IS NOT NULL AND destination_request_number ~ '^[0-9]{1,10}$')
  ),
  CONSTRAINT test_request_runs_actor_id_shape CHECK (
    actor_id ~ '^(cli:[0-9a-f]{16}|(admin|user):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$'
  ),
  CONSTRAINT test_request_runs_idempotency_key_digest CHECK (idempotency_key ~ '^[0-9a-f]{64}$'),
  CONSTRAINT test_request_runs_current_step_enum CHECK (current_step IN (
    'fence_source', 'create_request', 'correct_meeting_date', 'provision_location',
    'copy_file', 'observe', 'verify', 'ready'
  )),
  CONSTRAINT test_request_runs_recipe_enum CHECK (recipe IN ('basic')),
  CONSTRAINT test_request_runs_host_shapes CHECK (
    source_dataverse_host ~ '^[a-z0-9][a-z0-9.-]{1,253}$'
    AND destination_dataverse_host ~ '^[a-z0-9][a-z0-9.-]{1,253}$'
  ),
  CONSTRAINT test_request_runs_source_shapes CHECK (
    source_request_number ~ '^[0-9]{1,10}$'
    AND source_revision ~ '^(W/)?"?[0-9A-Za-z-]{1,80}"?$'
  ),
  CONSTRAINT test_request_runs_digest_shapes CHECK (
    bundle_sha256 ~ '^[0-9a-f]{64}$' AND copy_policy_digest ~ '^[0-9a-f]{64}$'
    AND plan_digest ~ '^[0-9a-f]{64}$' AND create_body_sha256 ~ '^[0-9a-f]{64}$'
    AND copy_policy_version ~ '^[a-z0-9][a-z0-9.-]{0,59}$'
  ),
  CONSTRAINT test_request_runs_graph_identity_shapes CHECK (
    expected_graph_site_id ~* '^[a-z0-9.-]+[.]sharepoint[.]com,[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12},[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND expected_graph_drive_id ~ '^b![A-Za-z0-9_-]{16,120}$'
    AND expected_graph_drive_id !~ '(^|[^A-Za-z0-9])(gh[pousr]_|github_pat_|sk-|xox[abprs]-|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{8}|glpat-|AIza|Bearer_)'
    AND expected_graph_site_id !~ '(^|[^A-Za-z0-9])(gh[pousr]_|github_pat_|sk-|xox[abprs]-|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{8}|glpat-|AIza|Bearer_)'
  ),
  CONSTRAINT test_request_runs_fiscal_year_shape CHECK (
    fiscal_year ~ '^([0-9]{4}-[0-9]{2}-[0-9]{2}|(January|February|March|April|May|June|July|August|September|October|November|December) [0-9]{4})$'
  ),
  CONSTRAINT test_request_runs_test_label_derived CHECK (
    test_label ~ '^TEST [a-z][a-z0-9_-]{0,39} clone of [0-9]{1,10} run [0-9a-f]{8}$'
  ),
  CONSTRAINT test_request_runs_reason_codes CHECK (
    (needs_attention_reason IS NULL OR regexp_replace(needs_attention_reason, ' [(]http [0-9]{3}[)]$', '') IN (
      'test_request_run_fenced', 'test_request_run_not_found', 'test_request_run_conflict',
      'test_request_run_invalid_status', 'test_request_run_invalid_request_number', 'test_request_ledger_unsafe_value',
      'upstream_http', 'timeout', 'network',
      'unknown_error', 'lease_unavailable', 'step_failed',
      'operator_stop', 'preflight_identity_changed', 'manifest_digest_mismatch',
      'bundle_stale', 'source_fence_failed', 'source_changed',
      'preallocated_request_present_not_owned', 'preallocated_request_recovered', 'ambiguous_create_outcome',
      'create_rejected', 'goverify_deactivation_uncertain', 'goverify_restore_unverified',
      'goverify_restore_failed', 'meeting_date_patch_failed', 'meeting_date_readback_mismatch',
      'location_preexisting', 'location_readback_mismatch', 'folder_create_failed',
      'file_conflict', 'file_rejected', 'file_ambiguous_unrecovered',
      'file_source_changed', 'file_verification_failed', 'file_copy_failed',
      'observation_side_effects', 'verification_failed', 'request_readback_mismatch',
      'preallocated_request_present', 'file_journal_unverified'
    ))
    AND (last_error IS NULL OR regexp_replace(last_error, ' [(]http [0-9]{3}[)]$', '') IN (
      'test_request_run_fenced', 'test_request_run_not_found', 'test_request_run_conflict',
      'test_request_run_invalid_status', 'test_request_run_invalid_request_number', 'test_request_ledger_unsafe_value',
      'upstream_http', 'timeout', 'network',
      'unknown_error', 'lease_unavailable', 'step_failed',
      'operator_stop', 'preflight_identity_changed', 'manifest_digest_mismatch',
      'bundle_stale', 'source_fence_failed', 'source_changed',
      'preallocated_request_present_not_owned', 'preallocated_request_recovered', 'ambiguous_create_outcome',
      'create_rejected', 'goverify_deactivation_uncertain', 'goverify_restore_unverified',
      'goverify_restore_failed', 'meeting_date_patch_failed', 'meeting_date_readback_mismatch',
      'location_preexisting', 'location_readback_mismatch', 'folder_create_failed',
      'file_conflict', 'file_rejected', 'file_ambiguous_unrecovered',
      'file_source_changed', 'file_verification_failed', 'file_copy_failed',
      'observation_side_effects', 'verification_failed', 'request_readback_mismatch',
      'preallocated_request_present', 'file_journal_unverified'
    ))
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

  planned_identity  JSONB NOT NULL CHECK (test_request_receipt_ok(planned_identity)),
  source_provenance JSONB NULL CHECK (test_request_receipt_ok(source_provenance)),

  dispatched_at     TIMESTAMPTZ NULL,
  response_status   INTEGER NULL,
  readback          JSONB NULL CHECK (test_request_receipt_ok(readback)),

  outcome           TEXT NOT NULL DEFAULT 'planned' CHECK (outcome IN (
                      'planned', 'dispatched', 'verified', 'recovered',
                      'conflict', 'rejected', 'ambiguous', 'failed'
                    )),
  error             TEXT NULL,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT test_request_run_resources_run_sequence UNIQUE (run_id, sequence),
  CONSTRAINT test_request_run_resources_step_enum CHECK (step IN (
    'fence_source', 'create_request', 'correct_meeting_date', 'provision_location',
    'copy_file', 'observe', 'verify', 'ready'
  )),
  CONSTRAINT test_request_run_resources_error_code CHECK (
    error IS NULL OR regexp_replace(error, ' [(]http [0-9]{3}[)]$', '') IN (
      'test_request_run_fenced', 'test_request_run_not_found', 'test_request_run_conflict',
      'test_request_run_invalid_status', 'test_request_run_invalid_request_number', 'test_request_ledger_unsafe_value',
      'upstream_http', 'timeout', 'network',
      'unknown_error', 'lease_unavailable', 'step_failed',
      'operator_stop', 'preflight_identity_changed', 'manifest_digest_mismatch',
      'bundle_stale', 'source_fence_failed', 'source_changed',
      'preallocated_request_present_not_owned', 'preallocated_request_recovered', 'ambiguous_create_outcome',
      'create_rejected', 'goverify_deactivation_uncertain', 'goverify_restore_unverified',
      'goverify_restore_failed', 'meeting_date_patch_failed', 'meeting_date_readback_mismatch',
      'location_preexisting', 'location_readback_mismatch', 'folder_create_failed',
      'file_conflict', 'file_rejected', 'file_ambiguous_unrecovered',
      'file_source_changed', 'file_verification_failed', 'file_copy_failed',
      'observation_side_effects', 'verification_failed', 'request_readback_mismatch',
      'preallocated_request_present', 'file_journal_unverified'
    )
  )
);

CREATE INDEX IF NOT EXISTS test_request_run_resources_run_step_idx
  ON test_request_run_resources (run_id, step);
