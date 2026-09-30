-- B4 typed slot journal. This version repairs cast additions absent from an
-- already-applied earlier 054, then refuses conflicting existing shapes.
DO $shape$
DECLARE actual TEXT[];
BEGIN
  IF to_regclass(format('%I.test_request_cast_members', current_schema())) IS NOT NULL THEN
    SELECT array_agg(column_name::text ORDER BY column_name) INTO actual
      FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'test_request_cast_members';
    IF actual IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY['member_id','environment','role','entity','first_name','last_name','address_sha256','status','dispatched_at','readback','error','created_at','updated_at','verified_at']) x)
      THEN RAISE EXCEPTION 'B4 refuses incompatible test_request_cast_members columns'; END IF;
  END IF;
  IF to_regclass(format('%I.test_request_cast_bindings', current_schema())) IS NOT NULL THEN
    SELECT array_agg(column_name::text ORDER BY column_name) INTO actual
      FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'test_request_cast_bindings';
    IF actual IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY['binding_id','run_id','member_id','status','dispatched_at','readback','error','created_at','updated_at','verified_at']) x)
      THEN RAISE EXCEPTION 'B4 refuses incompatible test_request_cast_bindings columns'; END IF;
  END IF;
  IF to_regclass(format('%I.test_request_cast_slot_bindings', current_schema())) IS NOT NULL THEN
    SELECT array_agg(column_name::text ORDER BY column_name) INTO actual
      FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'test_request_cast_slot_bindings';
    IF actual IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY['run_id','member_id','expected_request_id','expected_person_id','status','before_etag','snapshot_at','slot1_before','slot2_before','slot3_before','slot4_before','slot5_before','dispatched_at','verified_at','provenance','failure_code','error','readback_at','after_etag','after_marker','after_run_id','slot1_after','slot2_after','slot3_after','slot4_after','slot5_after','created_at','updated_at']) x)
      THEN RAISE EXCEPTION 'B4 refuses incompatible test_request_cast_slot_bindings columns'; END IF;
  END IF;
END $shape$;

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
         (e.key IN ('size', 'itemSize', 'statusCode', 'responseStatus', 'sequence', 'index', 'count', 'versionNumber', 'answerCount', 'assignmentSequence', 'promptVersion') AND s.t = 'number')
         OR (e.key IN ('sha256Match', 'sizeMatch', 'recovered', 'recoveredByExactItem', 'restored', 'restoreVerified', 'restoreWasAlreadyActive', 'manualRecheckRequired', 'matched', 'exists', 'ok') AND s.t = 'boolean')
         OR (e.key IN ('requestIds', 'locationIds', 'emailIds', 'trackingIds', 'paymentIds', 'jobIds') AND s.t = 'array' AND NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(e.value) AS a WHERE jsonb_typeof(a) <> 'string' OR (a #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
         OR (e.key = 'primaryContactId' AND s.t = 'null')
         OR (e.key = 'itemIds' AND s.t = 'array' AND NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(e.value) AS a WHERE jsonb_typeof(a) <> 'string' OR (a #>> '{}') !~ '^01[A-Z2-7]{32}$'))
         OR (e.key = 'resourceIds' AND s.t = 'array' AND NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(e.value) AS a WHERE jsonb_typeof(a) <> 'string' OR (a #>> '{}') !~ '^[0-9]{1,20}$'))
         OR (
           s.t = 'string'
           AND length(s.v) BETWEEN 1 AND 200
           AND s.v !~ '(://|[[:cntrl:]])'
           AND s.v !~ '(gh[pousr]_|github_pat_|sk-|xox[abprs]-|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{8}|glpat-|AIza|Bearer_)'
           AND CASE
             WHEN e.key IN ('requestId', 'runId', 'locationId', 'parentLocationId', 'workflowId', 'ownerId', 'createdById', 'expectedAppUserId', 'applicantId', 'organizationId', 'requestDocumentId', 'sourcePersonId', 'destinationPersonId', 'suggestionId', 'promptId', 'confirmedRunId', 'primaryContactId', 'liaisonContactId', 'piContactId', 'researchLeaderContactId') THEN s.v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             WHEN e.key = 'requestNumber' THEN s.v ~ '^[0-9]{1,10}$'
             WHEN e.key IN ('itemId', 'folderItemId', 'graphItemId', 'sourceGraphItemId') THEN s.v ~ '^01[A-Z2-7]{32}$'
             WHEN e.key IN ('driveId', 'sourceDriveId') THEN s.v ~ '^b![A-Za-z0-9_-]{16,120}$'
             WHEN e.key = 'siteId' THEN s.v ~* '^[a-z0-9.-]+[.]sharepoint[.]com,[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12},[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             WHEN e.key = 'library' THEN s.v ~ '^[a-z][a-z0-9_]{1,60}$'
             WHEN e.key IN ('folder', 'relativeUrl') THEN s.v ~ '^([0-9]{1,10}_[0-9A-F]{32}(/(Phase I|AI Materials|Reviewer Materials|Artifacts/Initial Assessment(/Board Milestones)?|Reviewer_Uploads/([A-Za-z0-9]{1,30}_)?[0-9a-f]{8}/attempt_[0-9a-f]{32}))?|(Phase I|AI Materials|Reviewer Materials|Artifacts/Initial Assessment(/Board Milestones)?|Reviewer_Uploads/([A-Za-z0-9]{1,30}_)?[0-9a-f]{8}/attempt_[0-9a-f]{32}))$'
             WHEN e.key IN ('filename', 'name') THEN s.v ~ '^((Proposal|ProposalNarrative|ProposalBibliography)_[0-9]{1,10}[.]pdf|(ProjectDescription|Biosketches|ProjectBudget)[.]pdf|Project Budget spreadsheet[.]xlsx|[0-9]{1,10} Initial Assessment [0-9a-f]{8}-[0-9a-f]{8}[.]docx|[0-9]{1,10} Initial Assessment Board v[0-9A-Za-z._-]{1,40} [0-9a-f]{8}[.]docx|Review_[1-5][.](pdf|docx|doc))$'
             WHEN e.key = 'mimeType' THEN s.v ~ '^[a-z]+/[a-z0-9.+-]{1,80}$'
             WHEN e.key IN ('eTag', 'eTagBefore', 'eTagAfter') THEN s.v ~ '^(W/)?"[{]?[0-9A-Za-z-]{1,40}[}]?(,[0-9]{1,9})?"$'
             WHEN e.key IN ('versionId', 'sourceVersionId') THEN s.v ~ '^([0-9]{1,6}[.][0-9]{1,6}|[0-9]{1,12}|[0-9A-Za-z]{1,40})$'
             WHEN e.key IN ('versionNumber', 'versionNumberBefore', 'versionNumberAfter') THEN s.v ~ '^[0-9]{1,20}$'
             WHEN e.key IN ('contentHash', 'generationKey', 'claimTokenSha256', 'foundationBaselineSha256', 'foundationProjectionSha256', 'foundationGoverifyResultSha256', 'foundationGuidestarSha256', 'foundationContactsSha256', 'requestStatusSha256', 'bytesSha256', 'addressSha256', 'attestedDigest', 'inputFingerprint', 'renderInputFingerprint') THEN s.v ~ '^[0-9a-f]{64}$'
             WHEN e.key IN ('outcome', 'kind') THEN s.v ~ '^[a-z][a-z0-9_-]{0,39}$'
             WHEN e.key = 'reviewForm' THEN s.v ~ '^(uploaded|received_no_file|unreceived)$'
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

-- Synthetic cast (cast-and-status plan, slices A + B, 2026-09-28): the
-- reused synthetic PI and Liaison contacts and suggested-reviewer person,
-- one per role per environment. `member_id` is the Dataverse GUID,
-- preallocated and journaled before the create POST names it, so ownership
-- is by journal: a lost response is recovered by reading that GUID, never by
-- re-POSTing, and a row the ledger did not journal is never adopted. Names
-- are the Factory's synthetic defaults; the address is stored as a digest
-- only (the owner supplies it at run time, off the repository).
CREATE TABLE IF NOT EXISTS test_request_cast_members (
  member_id      UUID PRIMARY KEY,
  environment    TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
  role           TEXT NOT NULL CHECK (role IN ('pi', 'liaison', 'suggested_reviewer', 'org_leader', 'research_leader')),
  entity         TEXT NOT NULL CHECK (entity IN ('contact', 'wmkf_potentialreviewers')),
  first_name     TEXT NOT NULL CHECK (length(first_name) BETWEEN 1 AND 50 AND first_name !~ '[[:cntrl:]]'),
  last_name      TEXT NOT NULL CHECK (length(last_name) BETWEEN 1 AND 50 AND last_name !~ '[[:cntrl:]]'),
  address_sha256 TEXT NOT NULL CHECK (address_sha256 ~ '^[0-9a-f]{64}$'),
  status         TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'dispatched', 'verified', 'needs_attention')),
  dispatched_at  TIMESTAMPTZ NULL,
  readback       JSONB NULL CHECK (test_request_receipt_ok(readback)),
  error          TEXT NULL CHECK (error IS NULL OR length(error) <= 2000),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_at    TIMESTAMPTZ NULL,
  CONSTRAINT test_request_cast_members_one_per_role UNIQUE (environment, role),
  CONSTRAINT test_request_cast_members_role_entity CHECK ((role = 'suggested_reviewer') = (entity = 'wmkf_potentialreviewers'))
);

-- One row per suggested-reviewer suggestion the Factory binds to a ready
-- production test Request (owner-run, like a status change, so no lease).
-- `binding_id` is the preallocated wmkf_appreviewersuggestionid.
CREATE TABLE IF NOT EXISTS test_request_cast_bindings (
  binding_id     UUID PRIMARY KEY,
  run_id         UUID NOT NULL REFERENCES test_request_runs (run_id),
  member_id      UUID NOT NULL REFERENCES test_request_cast_members (member_id),
  status         TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'dispatched', 'verified', 'needs_attention')),
  dispatched_at  TIMESTAMPTZ NULL,
  readback       JSONB NULL CHECK (test_request_receipt_ok(readback)),
  error          TEXT NULL CHECK (error IS NULL OR length(error) <= 2000),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_at    TIMESTAMPTZ NULL,
  CONSTRAINT test_request_cast_bindings_one_per_run UNIQUE (run_id, member_id)
);

-- Earlier applied 054 may have had only three roles.
ALTER TABLE test_request_cast_members DROP CONSTRAINT IF EXISTS test_request_cast_members_role_check;
ALTER TABLE test_request_cast_members ADD CONSTRAINT test_request_cast_members_role_check
  CHECK (role IN ('pi','liaison','suggested_reviewer','org_leader','research_leader'));

DO $cast_constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'test_request_cast_members'::regclass AND conname = 'test_request_cast_members_one_per_role')
    OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'test_request_cast_members'::regclass AND conname = 'test_request_cast_members_role_entity')
    OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'test_request_cast_bindings'::regclass AND conname = 'test_request_cast_bindings_one_per_run')
  THEN RAISE EXCEPTION 'B4 refuses incomplete cast constraints'; END IF;
END $cast_constraints$;

CREATE TABLE IF NOT EXISTS test_request_cast_slot_bindings (
  run_id UUID NOT NULL,
  member_id UUID NOT NULL,
  expected_request_id UUID NOT NULL,
  expected_person_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','dispatched','verified','needs_attention')),
  before_etag TEXT NULL CHECK (before_etag IS NULL OR before_etag ~ '^W/"[0-9]{1,20}"$'),
  snapshot_at TIMESTAMPTZ NULL,
  slot1_before UUID NULL, slot2_before UUID NULL, slot3_before UUID NULL, slot4_before UUID NULL, slot5_before UUID NULL,
  dispatched_at TIMESTAMPTZ NULL, verified_at TIMESTAMPTZ NULL,
  provenance TEXT NULL CHECK (provenance IN ('confirmed_patch','observed_preexisting','observed_after_conflict','observed_after_ambiguous_dispatch')),
  failure_code TEXT NULL CHECK (failure_code IN ('occupied_slot','etag_conflict','readback_mismatch','ambiguous_dispatch','request_drift','metadata_unavailable','ledger_conflict')),
  error TEXT NULL CHECK (error IS NULL OR (length(error) <= 500 AND error !~ '(://|[[:cntrl:]])')),
  readback_at TIMESTAMPTZ NULL,
  after_etag TEXT NULL CHECK (after_etag IS NULL OR after_etag ~ '^W/"[0-9]{1,20}"$'),
  after_marker BOOLEAN NULL, after_run_id UUID NULL,
  slot1_after UUID NULL, slot2_after UUID NULL, slot3_after UUID NULL, slot4_after UUID NULL, slot5_after UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT test_request_cast_slot_bindings_pkey PRIMARY KEY (run_id, member_id),
  CONSTRAINT test_request_cast_slot_bindings_suggestion_fk FOREIGN KEY (run_id, member_id)
    REFERENCES test_request_cast_bindings (run_id, member_id),
  CONSTRAINT test_request_cast_slot_bindings_expected_pair CHECK (expected_person_id = member_id),
  CONSTRAINT test_request_cast_slot_bindings_snapshot CHECK (
    (snapshot_at IS NULL AND before_etag IS NULL AND status = 'planned')
    OR (snapshot_at IS NOT NULL AND before_etag IS NOT NULL)),
  CONSTRAINT test_request_cast_slot_bindings_dispatched CHECK (status <> 'dispatched' OR dispatched_at IS NOT NULL),
  CONSTRAINT test_request_cast_slot_bindings_verified CHECK (
    status <> 'verified' OR (verified_at IS NOT NULL AND provenance IS NOT NULL AND readback_at IS NOT NULL
      AND after_marker IS TRUE AND after_run_id = run_id AND slot1_after = member_id AND after_etag IS NOT NULL)),
  CONSTRAINT test_request_cast_slot_bindings_failure CHECK (status <> 'needs_attention' OR failure_code IS NOT NULL)
);

DO $slot_constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'test_request_cast_slot_bindings'::regclass AND conname = 'test_request_cast_slot_bindings_suggestion_fk')
    OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'test_request_cast_slot_bindings'::regclass AND conname = 'test_request_cast_slot_bindings_verified')
  THEN RAISE EXCEPTION 'B4 refuses incomplete slot journal constraints'; END IF;
END $slot_constraints$;
