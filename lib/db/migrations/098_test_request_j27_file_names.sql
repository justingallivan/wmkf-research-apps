-- Operational Factory ledger only. Apply through ledger:apply to managed ledgers
-- (and the app database runner, by convention) as a separately authorized
-- release step; this file performs no Dataverse writes.
--
-- J27 file names (owner, 2026-11-14): a Factory clone into a J27-or-later
-- Grant Cycle copies the narrative and bibliography to
-- `Submission-Documents/Project-Narrative_<n>.pdf` and
-- `Submission-Documents/Bibliography_<n>.pdf`
-- (lib/services/test-requests/file-plan.js). This replaces the receipt
-- validator from 058 with one that also accepts that folder and those two
-- names. It only widens what is accepted, so rows already stored still pass.
-- The ledger schema guard (lib/db/ledger-guard.js) refuses a ledger whose
-- function body differs from the checkout's tracked fingerprint, so the
-- Factory pauses between applying this file and deploying the matching code,
-- in either order (as with 094).
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
             WHEN e.key IN ('folder', 'relativeUrl') THEN s.v ~ '^([0-9]{1,10}_[0-9A-F]{32}(/(Phase I|AI Materials|Submission-Documents|Reviewer Materials|Artifacts/Initial Assessment(/Board Milestones)?|Reviewer_Uploads/([A-Za-z0-9]{1,30}_)?[0-9a-f]{8}/attempt_[0-9a-f]{32}))?|(Phase I|AI Materials|Submission-Documents|Reviewer Materials|Artifacts/Initial Assessment(/Board Milestones)?|Reviewer_Uploads/([A-Za-z0-9]{1,30}_)?[0-9a-f]{8}/attempt_[0-9a-f]{32}))$'
             WHEN e.key IN ('filename', 'name') THEN s.v ~ '^((Proposal|ProposalNarrative|ProposalBibliography|Project-Narrative|Bibliography)_[0-9]{1,10}[.]pdf|(ProjectDescription|Biosketches|ProjectBudget)[.]pdf|Project Budget spreadsheet[.]xlsx|[0-9]{1,10} Initial Assessment [0-9a-f]{8}-[0-9a-f]{8}[.]docx|[0-9]{1,10} Initial Assessment Board v[0-9A-Za-z._-]{1,40} [0-9a-f]{8}[.]docx|Review_[1-5][.](pdf|docx|doc))$'
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
