/**
 * Adapter: akoya_requests (grant request — the giant).
 *
 * The hottest raw Dataverse entity in the tree: 79 raw call identities across
 * 48 files at Stage-0 census (Appendix A of
 * docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md). This module is Wave 5(a)+(b) — the
 * READ surface ONLY: single-record fetches (44 raw `getRecord` sites) and
 * read-only queries/lists (7 `queryRecords` + 9 `queryAllRecords` sites). Writes
 * (`createRecord`/`updateRecord`/`disassociate`) and changeset participation are
 * Wave 5(c)/(d) and deliberately absent here — do NOT add them.
 *
 * Design (48 files depend on this entity, so method design matters most here):
 *  - `getById` is a thin single-record fetch. It mirrors BOTH live shapes: with a
 *    `$select` (43 sites) and WITHOUT one (the full-record read at
 *    lib/services/execute-prompt.js:104). Callers keep supplying their own field
 *    list — most akoya_requests reads are legitimately bespoke projections (a
 *    lone memo field, a 9-field email-render set), NOT drift. `SELECT_PROFILES`
 *    below names only the field lists that recur VERBATIM across files.
 *  - The query methods cover the read shapes that genuinely consolidate: exact
 *    request-number lookup (~5 sites), OR-chain fetch by a set of request ids
 *    (2 sites), and the PD-scoped meeting-date scan (2 sites). Cycle/triage/
 *    fiscal-year/program list filters stay caller-built business logic — they do
 *    NOT consolidate and are intentionally not wrapped (see the plan's Wave-5
 *    report).
 *
 * Behavior freeze (Stage 2 / Wave 5 ground rule 6): every method reproduces the
 * exact DynamicsService call the raw caller makes — same entity set, `$select`,
 * `$filter`, `top`, `$orderby`, and return object — so later in-place conversion
 * is provably a no-op. No DTO/filter/error changes.
 */

import { DynamicsService } from '../../services/dynamics-service.js';
import * as odata from '../core/odata.js';
import { entitySet } from '../core/entity-registry.js';

const ENTITY_SET = entitySet('akoya_requests');

/**
 * SELECT field lists that recur VERBATIM across ≥2 caller files. Local to this
 * adapter (entity-registry.js holds only the primary select of entities whose
 * adapters share one FIELD_SELECT — akoya_requests reads have no single shared
 * projection). Callers converting to `getById` may pass one of these OR their own
 * bespoke field list; both are honored. The many single-use selects across the 44
 * getRecord sites are deliberately NOT enumerated here — they are per-caller read
 * intent, not drift to consolidate.
 */
export const SELECT_PROFILES = Object.freeze({
  // Existence/etag refresh only. lib/bill/honorarium-onboard-orchestrator.js:212,
  // pages/api/workbench/grantee-deliverables/abstract.js:228.
  ID_ONLY: ['akoya_requestid'],
  // Identity pair — id + human request number. pages/api/review-manager/
  // materials-preflight.js:41, pages/api/reviewer-finder/load-proposal.js:79,
  // pages/api/workbench/grantee-deliverables/send-invite.js:87.
  IDENTITY: ['akoya_requestid', 'akoya_requestnum'],
  // Identity + meeting date — the SharePoint document-scope resolution inputs.
  // pages/api/workbench/download-proposal-document.js:78,
  // pages/api/workbench/proposal-documents.js:37.
  DOCUMENT_SCOPE: ['akoya_requestid', 'akoya_requestnum', 'wmkf_meetingdate'],
});

/**
 * Fetch one request by its GUID id.
 *
 * @param {string} requestId  akoya_requestid (record key path segment — Dataverse
 *   validates it; the raw callers do not pre-validate, so neither do we).
 * @param {object} [opts]
 * @param {string[]|string} [opts.select]  field list (array or comma-string) or a
 *   `SELECT_PROFILES` value. Omit entirely for a full-record read (mirrors
 *   lib/services/execute-prompt.js:104, which passes no options).
 * @returns {Promise<object|null>} the record as DynamicsService.getRecord returns it.
 *
 * Serves all 44 raw `getRecord('akoya_requests', ...)` sites.
 */
export async function getById(requestId, { select } = {}) {
  if (select === undefined) {
    // Full-record read: no third arg, byte-for-byte the execute-prompt:104 shape.
    return DynamicsService.getRecord(ENTITY_SET, requestId);
  }
  return DynamicsService.getRecord(ENTITY_SET, requestId, { select: odata.select(select) });
}

/**
 * Look up requests by exact request number (`akoya_requestnum eq '<value>'`).
 * The number is escaped for the OData string literal exactly as the raw callers
 * do (`String(x).replace(/'/g, "''")`), never GUID-treated.
 *
 * @param {string} requestNumber  human request number (may be client-supplied).
 * @param {object} [opts]
 * @param {string[]|string} [opts.select]  field list (array or comma-string).
 * @param {number} [opts.top=1]  live callers all fetch the single expected match.
 * @returns {Promise<{records: object[], count, totalCount, hasMore}>} the raw
 *   DynamicsService.queryRecords result; callers destructure `{ records }` and
 *   take `records[0]`.
 *
 * Serves the request-number resolvers in pages/api/review-manager/reviewers.js:422,
 * pages/api/reviewer-finder/my-candidates.js:339, pages/api/workbench/
 * resolve-request.js:82, pages/api/grant-reporting/lookup-grant.js:90.
 */
export async function findByRequestNumber(requestNumber, { select, top = 1 } = {}) {
  return DynamicsService.queryRecords(ENTITY_SET, {
    select: odata.select(select),
    filter: odata.eq('akoya_requestnum', requestNumber),
    top,
  });
}

/**
 * Fetch a batch of requests by a set of GUID ids, via the OR-chain the raw
 * callers hand-build (`akoya_requestid eq <id> or ...`). No wrapping parens — the
 * mirror of the live filter strings. Ids are interpolated raw (server-sourced
 * record ids from a prior query, never client input), matching current behavior.
 * Callers own their own chunking; pass one chunk per call.
 *
 * @param {string[]} requestIds  request GUIDs (one chunk).
 * @param {object} [opts]
 * @param {string[]|string} [opts.select]  field list (array or comma-string).
 * @param {number} [opts.top]  defaults to `requestIds.length` (the sweep shape);
 *   pass an explicit cap to mirror the contact-history CHUNK_SIZE shape.
 * @returns {Promise<{records: object[], count, totalCount, hasMore}>} raw
 *   queryRecords result. Empty input short-circuits to an empty result rather than
 *   issuing an unfiltered query.
 *
 * Serves pages/api/reviewer-finder/contact-history.js:157 and
 * lib/services/reviewer-suggestion-sweep.js:66.
 */
export async function findByIds(requestIds, { select, top } = {}) {
  if (!requestIds?.length) {
    return { records: [], count: 0, totalCount: 0, hasMore: false };
  }
  return DynamicsService.queryRecords(ENTITY_SET, {
    select: odata.select(select),
    filter: odata.or(requestIds.map((id) => odata.eqRaw('akoya_requestid', id))),
    top: top === undefined ? requestIds.length : top,
  });
}

/**
 * Paginated scan of a program director's meeting-dated requests, returning just
 * `akoya_requestid,wmkf_meetingdate` ordered by meeting date descending — the
 * cycle-picker source. The PD systemuser id is server-resolved (never client
 * input) and interpolated raw as a lookup value, matching the raw callers.
 *
 * @param {string} programDirectorId  systemuserid of the PD.
 * @returns {Promise<{records: object[], count, totalCount, hasMore, capped?}>} raw
 *   DynamicsService.queryAllRecords result.
 *
 * Serves the `listCycles` scans in pages/api/workbench/dashboard.js:106 and
 * pages/api/reviewer-finder/my-proposals.js:80.
 */
export async function findMeetingDatesByProgramDirector(programDirectorId) {
  return DynamicsService.queryAllRecords(ENTITY_SET, {
    select: odata.select(['akoya_requestid', 'wmkf_meetingdate']),
    filter: `${odata.eqRaw('_wmkf_programdirector_value', programDirectorId)} and wmkf_meetingdate ne null`,
    orderby: 'wmkf_meetingdate desc',
  });
}
