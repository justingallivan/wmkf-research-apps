/**
 * Adapter: akoya_requests (grant request — the giant).
 *
 * The hottest raw Dataverse entity in the tree: 79 raw call identities across
 * 48 files at Stage-0 census (Appendix A of
 * docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md). Wave 5(a)+(b) (merged) built the
 * READ surface: single-record fetches (44 raw `getRecord` sites) and read-only
 * queries/lists (7 `queryRecords` + 9 `queryAllRecords` sites). This addition is
 * Wave 5(c) — the WRITE surface (`updateRecord` PATCH passthrough) plus the two
 * business-filter query passthroughs that let the four documented business-filter
 * read callers drop their raw transport import without adopting a caller-built
 * filter into the adapter. Changeset participation (Wave 5(d), e.g. the external
 * submit flow) is deliberately still absent here — do NOT add it.
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
 *    NOT consolidate and are intentionally not wrapped as bespoke methods; they
 *    convert via `queryRequests`/`queryAllRequests` instead (below), which are
 *    raw arg-forwarding passthroughs, not filter builders.
 *  - `updateById` is the single write method for every akoya_requests PATCH site
 *    (no per-field method proliferation, matching the read-side design). Every
 *    live write site passes a caller-built patch body plus zero or more of
 *    `ifMatch`/`actingUserSystemId`/`noFallback` — `updateById` forwards the
 *    options object verbatim (or omits the 4th arg entirely when the caller
 *    passes none), so the PATCH body and options are 100% caller-owned.
 *  - `queryRequests`/`queryAllRequests`/`aggregateRequests` are raw passthroughs
 *    to the corresponding DynamicsService reads (arg-for-arg): they exist so a
 *    caller-built business query can drop the raw DynamicsService import
 *    without the query itself moving into the adapter.
 *
 * Behavior freeze (Stage 2 / Wave 5 ground rule 6): every method reproduces the
 * exact DynamicsService call the raw caller makes — same entity set, `$select`,
 * `$filter`, `top`, `$orderby`, options, and return object — so later in-place
 * conversion is provably a no-op. No DTO/filter/error changes.
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
 * Full-text search the indexed grant-request table. This is deliberately a
 * thin entity-scoped adapter over Dataverse Search: callers own their bounded
 * result size and any escaped server-built filter, while the adapter fixes the
 * searchable logical table to `akoya_request` so domain services never import
 * the raw transport.
 *
 * @param {string} search non-empty Dataverse Search expression
 * @param {object} [opts]
 * @param {number} [opts.top=25] maximum relevance-ranked hits (transport caps at 100)
 * @param {number} [opts.skip=0] number of ranked hits to skip
 * @param {string[]} [opts.orderby] stable Dataverse Search sort expressions
 * @param {string} [opts.filter] server-built, entity-qualified Dataverse Search filter
 * @returns {Promise<{results: object[], totalCount: number, queryContext: object|null}>}
 */
export async function searchRequests(search, {
  top = 25,
  skip = 0,
  orderby,
  filter,
} = {}) {
  return DynamicsService.searchRecords(search, {
    entities: ['akoya_request'],
    top,
    ...(skip ? { skip } : {}),
    ...(orderby?.length ? { orderby } : {}),
    ...(filter ? { filter } : {}),
  });
}

/**
 * Fetch a batch of requests by a set of GUID ids, via the OR-chain the raw
 * callers hand-build (`akoya_requestid eq <id> or ...`). No wrapping parens — the
 * mirror of the live filter strings. Ids are interpolated raw (server-sourced
 * record ids from a prior query, never client input), matching current behavior.
 * Callers own their own chunking; pass one chunk per call.
 *
 * @param {string[]} requestIds  request GUIDs (one chunk). Callers that accept
 *   client-originating ids must GUID-validate them before this raw filter seam.
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
 * Bounded legacy association read for a Potential Reviewer stored in any of the
 * five historical request lookup slots. The person id is server-resolved and
 * GUID-validated before it is interpolated into the OR filter.
 */
export async function findByPotentialReviewerSlots(potentialReviewerId, { top = 25 } = {}) {
  const slotFields = [1, 2, 3, 4, 5].map((slot) => `_wmkf_potentialreviewer${slot}_value`);
  return DynamicsService.queryRecords(ENTITY_SET, {
    select: odata.select([
      'akoya_requestid',
      'akoya_requestnum',
      'akoya_title',
      'akoya_fiscalyear',
      'wmkf_meetingdate',
    ]),
    filter: odata.or(slotFields.map((field) => odata.eqGuid(field, potentialReviewerId))),
    orderby: 'createdon desc',
    top,
  });
}

/**
 * Update one request by GUID id — the single write method for every
 * akoya_requests PATCH site (Wave 5(c)). A raw passthrough: the patch body and
 * the options object (`ifMatch`/`actingUserSystemId`/`noFallback`, any subset,
 * in any combination) are 100% caller-built, exactly like DynamicsService.
 * updateRecord itself — this only removes the raw transport import.
 *
 * @param {string} requestId  akoya_requestid (record key path segment; the raw
 *   callers do not pre-validate it, so neither does this method).
 * @param {object} data  the PATCH body (caller-owned field set).
 * @param {object} [options]  forwarded verbatim to updateRecord — `ifMatch`,
 *   `actingUserSystemId`, `noFallback`, any combination, or entirely omitted.
 *   When the caller passes no 3rd argument at all (an unconditional write, e.g.
 *   the field-primer lease-restore path), this method calls updateRecord with
 *   exactly 3 args too — never a synthesized `{}` — so the mirrored call shape
 *   is byte-for-byte, not just behaviorally equivalent.
 * @returns {Promise<object>} raw DynamicsService.updateRecord result.
 */
export async function updateById(requestId, data, options) {
  if (options === undefined) {
    return DynamicsService.updateRecord(ENTITY_SET, requestId, data);
  }
  return DynamicsService.updateRecord(ENTITY_SET, requestId, data, options);
}

/**
 * Business-filter query passthrough — mirrors DynamicsService.queryRecords
 * arg-for-arg (`select`/`filter`/`orderby`/`top`/`expand`, any subset). Exists
 * so callers whose $filter is genuinely bespoke business logic (cycle code,
 * triage status, program scope, ...) can drop the raw DynamicsService import
 * without that filter moving into the adapter — the adapter's design note is
 * explicit that these filters do NOT consolidate into named methods.
 *
 * @param {object} [options]  forwarded verbatim to queryRecords.
 * @returns {Promise<{records: object[], count, totalCount, hasMore}>} raw result.
 */
export async function queryRequests(options) {
  return DynamicsService.queryRecords(ENTITY_SET, options);
}

/**
 * Business-filter paginated-scan passthrough — mirrors
 * DynamicsService.queryAllRecords arg-for-arg. Same caller-owned-filter design
 * as `queryRequests`, for the unbounded/paginated list shape.
 *
 * @param {object} [options]  forwarded verbatim to queryAllRecords.
 * @returns {Promise<{records: object[], count, totalCount, hasMore, capped?}>} raw result.
 */
export async function queryAllRequests(options) {
  return DynamicsService.queryAllRecords(ENTITY_SET, options);
}

/**
 * Business aggregation passthrough — mirrors DynamicsService.aggregateRecords
 * arg-for-arg while keeping the akoya_requests entity owned by this adapter.
 * The shared read primitive enforces the trusted restriction context and checks
 * both the aggregate field and group-by field before issuing the request.
 *
 * @param {object} options aggregate field/operation plus optional filter/groupBy.
 * @returns {Promise<{results: object[], operation?: string, field?: string, groupBy?: string}>}
 */
export async function aggregateRequests(options) {
  return DynamicsService.aggregateRecords(ENTITY_SET, options);
}

/**
 * Create one akoya_requests row — a raw passthrough (byte-mirror). Every live
 * caller (the drain's request-created create, and the honorarium
 * orchestrator's deterministic-GUID honorarium create) passes exactly a body,
 * no options — this method matches that 2-arg shape exactly.
 *
 * @param {object} data  the POST body (caller-owned field set, including any
 *   `@odata.bind` navigation-property keys).
 * @returns {Promise<object>} raw DynamicsService.createRecord result.
 */
export async function create(data) {
  return DynamicsService.createRecord(ENTITY_SET, data);
}

/**
 * Delete a single-valued navigation-property reference ($ref DELETE) on one
 * request — a raw passthrough (byte-mirror) of the reviewer-merge applicant-
 * slot clear step's `DynamicsService.disassociate('akoya_requests', ...)` call.
 *
 * @param {string} requestId  akoya_requestid.
 * @param {string} navProperty  single-valued nav prop (e.g. 'wmkf_PotentialReviewer1').
 * @param {object} [options]
 * @param {string} [options.actingUserSystemId]
 * @returns {Promise<void>}
 */
export async function disassociate(requestId, navProperty, options) {
  return DynamicsService.disassociate(ENTITY_SET, requestId, navProperty, options);
}

export const ENTITY_SET_NAME = ENTITY_SET;
