/**
 * Read-only Pre-Site draft reader for bundle v4's `preSiteVisit` section
 * (slice 4a, Recipes 3-5 plan "Recipe 4"). Finds the ONE source Pre-Site
 * Word request-document row to export from and projects an ALLOWLIST off
 * it -- never a delete-list -- so a source row carrying the input snapshot,
 * fingerprint, generation key, lifecycle, claim token or AI-run link never
 * has those fields read into the exported shape in the first place.
 *
 * Row selection (design doc "Recipe 4", "Which source row"): if the source
 * request's `_wmkf_currentpresitevisit_value` pointer is set, it must
 * resolve to a Pre-Site Word artifact among the candidate set below --
 * refused otherwise, never silently falling back. If the pointer is null,
 * the fallback set is every request-document row for the source request
 * that is artifactType Pre-Site-Visit, contentType Word (never the PDF
 * distribution-snapshot content type), not a distribution snapshot
 * (`isPreSiteDistributionSnapshot`), and not SUPERSEDED; exactly one
 * candidate is required, else refused. Lifecycle state (Draft/Review/
 * Board Ready/Final) is otherwise irrelevant -- a source request whose
 * Pre-Site row has moved to Final (e.g. its Final Writeup already exists)
 * is still a valid source: the draft fields are what this export needs.
 *
 * `readPreSiteVisitDraftForExport` returns `{ draft, identity }` (Codex
 * adversarial round-1 finding 1): the document is otherwise read once, and
 * only the PARENT Request's revision is rechecked at the end of export --
 * but a request-document edit need not bump that revision. `identity` lets
 * the caller re-select and compare after every other export read.
 */
import { isGuid } from '../../utils/guid.js';
import {
  isPreSiteDistributionSnapshot,
  PRE_SITE_VISIT_CONTRACT,
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../../shared/config/requestDocument.js';
import { PRE_SITE_SECTION_FIELDS } from './source-bundle.js';

function invalidError(message) {
  const err = new Error(message);
  err.code = 'pre_site_visit_source_invalid';
  return err;
}

// The app itself treats only a READY Word row as current (Opus round-1 P2):
// `lib/services/pre-site-visit/artifact-lineage.js` requires
// `wmkf_operationstatus === READY` on BOTH its pointer-validity check
// (verifyReadyLineage's pointer branch, :209-212 [VERIFIED via source this
// session]) and its `activeReadyWords` fallback census (:145-150). A
// Generating or Failed row is never a valid export source, on either the
// pointer path or the fallback path -- this predicate is shared by both, so
// the rule cannot drift between them.
function isCandidateRow(row, requestId) {
  return !!row
    && String(row._wmkf_request_value || '').toLowerCase() === requestId
    && row.wmkf_artifacttype === REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT
    && row.wmkf_contenttype === PRE_SITE_VISIT_CONTRACT.contentType
    && row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
    && row.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED
    && !isPreSiteDistributionSnapshot(row);
}

/**
 * ALLOWLIST projection off a raw request-document row: exactly
 * `requestDocumentId`, the eight Pre-Site section fields (default null),
 * and the parsed `wmkf_presiteproposalcorejson` envelope. Any other field
 * on `row` (input snapshot, fingerprint, generation key, lifecycle, claim
 * token, AI-run link, etc.) is never read.
 */
function projectAllowlistedDraft(row) {
  if (!row.wmkf_presiteproposalcorejson) {
    throw invalidError('The source Pre-Site Word artifact has no proposal-core JSON to export; refusing.');
  }
  let proposalCoreJson;
  try {
    proposalCoreJson = JSON.parse(row.wmkf_presiteproposalcorejson);
  } catch {
    throw invalidError("The source Pre-Site Word artifact's proposal-core JSON is unreadable; refusing.");
  }
  return {
    requestDocumentId: row.wmkf_requestdocumentid,
    sectionFields: Object.fromEntries(PRE_SITE_SECTION_FIELDS.map((field) => [field, row[field] ?? null])),
    proposalCoreJson,
  };
}

/**
 * The exact row-selection rule (pointer, else the single non-superseded/
 * non-snapshot/READY fallback candidate), extracted so BOTH the initial
 * read and the Codex adversarial round-1 finding-1 re-fence (below) apply
 * the SAME rule -- never two independently-maintained copies that could
 * drift and disagree about which row is "current".
 *
 * `dependencies.getRequest(requestId)` resolves the source request
 * (`akoya_requestid`, `_wmkf_currentpresitevisit_value`);
 * `dependencies.listPreSiteDocuments(requestId)` returns every
 * `wmkf_requestdocument` row for that request carrying at least
 * `wmkf_requestdocumentid`, `_wmkf_request_value`, `wmkf_artifacttype`,
 * `wmkf_contenttype`, `wmkf_lifecyclestate`, `wmkf_producer`, and the
 * allowlisted section/proposal-core fields -- a real wiring's own `$select`
 * is the data-minimization boundary; this function's own projection below
 * is the second, defense-in-depth boundary that never reads anything else
 * off a row regardless of what the read actually returned. `@odata.etag` is
 * a standard Dataverse Web API entity annotation, always present on a
 * returned row independent of `$select` -- no extra header is needed for it.
 */
async function selectPreSiteVisitRow({ requestId }, dependencies) {
  if (!isGuid(requestId)) throw invalidError('Pre-Site export requires a valid requestId.');
  const normalizedRequestId = requestId.toLowerCase();
  const request = await dependencies.getRequest(requestId);
  if (!request || String(request.akoya_requestid || '').toLowerCase() !== normalizedRequestId) {
    throw invalidError('The Pre-Site source request could not be resolved.');
  }
  const rows = (await dependencies.listPreSiteDocuments(requestId)) || [];
  const candidates = rows.filter((row) => isCandidateRow(row, normalizedRequestId));

  const pointerId = request._wmkf_currentpresitevisit_value
    ? String(request._wmkf_currentpresitevisit_value).toLowerCase()
    : null;

  let chosen;
  if (pointerId) {
    chosen = candidates.find((row) => String(row.wmkf_requestdocumentid || '').toLowerCase() === pointerId);
    if (!chosen) {
      throw invalidError("The source request's current Pre-Site pointer does not resolve to a Pre-Site Word artifact; refusing.");
    }
  } else if (candidates.length === 0) {
    throw invalidError('The source request has no Pre-Site Word artifact to export; refusing.');
  } else if (candidates.length > 1) {
    throw invalidError('The source request has more than one candidate Pre-Site Word artifact and no current pointer to disambiguate; refusing.');
  } else {
    [chosen] = candidates;
  }
  return chosen;
}

/**
 * The identity a re-fence compares (Codex adversarial round-1 finding 1):
 * the exact row (by ID), its optimistic-concurrency eTag, and the two
 * status fields that gate candidacy (`isCandidateRow`) -- a document edit
 * need not bump the PARENT Request's revision (the only thing the existing
 * end-of-export fence rechecks), so the document itself needs its own
 * fence. An eTag-less row fails closed (mirrors source-bundle.js's reviewer
 * fence `assertNonEmptyEtag`: a comparison with no eTag on either side
 * proves nothing about whether the row actually changed).
 */
export function preSiteVisitRowIdentity(row) {
  const eTag = row?.['@odata.etag'];
  if (typeof eTag !== 'string' || eTag.length === 0) {
    throw invalidError('Pre-Site source fence: the document row has no readable eTag; refusing to compare.');
  }
  return {
    requestDocumentId: row.wmkf_requestdocumentid,
    eTag,
    operationstatus: row.wmkf_operationstatus,
    lifecyclestate: row.wmkf_lifecyclestate,
  };
}

/**
 * Returns `{ draft, identity }`. `exportTestRequestSourceBundle`
 * (source-bundle.js) calls this SAME function twice -- once up front, once
 * again after every other export read (Codex adversarial round-1 finding 1)
 * -- exactly like it already calls `discoverDocuments`/`discoverReviewers`
 * twice, and compares the two results with `assertPreSiteVisitDraftUnchanged`
 * (source-bundle.js, mirroring `assertReviewerSourceUnchanged`'s own
 * two-snapshot-compare shape).
 */
export async function readPreSiteVisitDraftForExport({ requestId }, dependencies) {
  const chosen = await selectPreSiteVisitRow({ requestId }, dependencies);
  return { draft: projectAllowlistedDraft(chosen), identity: preSiteVisitRowIdentity(chosen) };
}
