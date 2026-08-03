// @ts-check
/**
 * DynamicsService decomposition — Stage 6 module (Checkpoint C, write core).
 *
 * Moved verbatim from lib/services/dynamics-service.js: the DAL entity-write
 * cluster — `_withCallerId`, `_writeFetch`, `createRecord`, `updateRecord`,
 * `updateIfEmpty`, `deleteRecord`, `disassociate`. Every class-surface `this.`
 * access in a moved body is rewritten to `svc.` per C1 (the svc-dispatch rule),
 * so sibling calls (`svc.getAccessToken`, `svc.buildHeaders`,
 * `svc._withCallerId`, `svc._writeFetch`, `svc.processAnnotations`, and the
 * read-path `svc.getRecord`/`svc.updateRecord` inside `updateIfEmpty`) still
 * route through the facade and its test spies. Nothing else in the bodies
 * changed.
 *
 * `_withCallerId` and `_writeFetch` carry no `this`, so they stay svc-less
 * module functions (facade keeps thin wrappers for exact-surface parity, and so
 * the changeset/email clusters can still reach them via `svc._writeFetch` /
 * `svc._withCallerId` per C12).
 *
 * DAL enforcement (C2): the four write mutators (`createRecord`, `updateRecord`,
 * `deleteRecord`, `disassociate`) call `assertTrustedDalContext` as the FIRST
 * statement of their body, importing it directly from `../dynamics-context.js`
 * so the guard lives inside the moved implementation — a future direct module
 * import is still runtime-guarded. `updateIfEmpty` carries no assert of its own:
 * it composes `svc.updateRecord` (guarded) and never mutates directly.
 *
 * Error-shape freeze (C13): `createRecord`/`updateRecord` throw
 * `buildServiceError` (412-aware); `deleteRecord`/`disassociate` throw a plain
 * Error with `.status` attached; `disassociate` treats 404 as idempotent
 * success. Impersonation 403-fallback (C12) lives in `_writeFetch`.
 *
 * Deps: http (`fetchWithTimeout`), constants (`API_TIMEOUT`), dynamics-context
 * (`assertTrustedDalContext`), service-error (`buildServiceError`).
 */

import { API_TIMEOUT } from './constants.js';
import { fetchWithTimeout } from './http.js';
import { assertTrustedDalContext } from '../dynamics-context.js';
import { buildServiceError } from '../../utils/service-error.js';
import { observeReviewerFindWarmEffect } from '../workbench/reviewer-find-warm-observation.js';

/**
 * Branded Dataverse record id (see lib/utils/guid.js). A raw request-input
 * string does not type-check as `Guid` until narrowed through `isGuid` at the
 * route edge; server-derived ids are cast at the write site.
 * @typedef {import('../../utils/guid.js').Guid} Guid
 */

/**
 * The DynamicsService facade receiver (C1 svc-dispatch). Typed `any` here on
 * purpose: this module brands the record-id selector surface, not the facade —
 * the facade's own typed coverage is deferred to the decomposition's
 * facade-finalize checkpoint. See docs/DYNAMICS_SERVICE_DECOMPOSITION_PLAN.md.
 * @typedef {any} Svc
 */

// Write paths only. Adding MSCRMCallerID to reads would impersonate the user
// for security-role evaluation, breaking callers whose linked Dynamics user
// has narrower privileges than the service principal. Writes are the goal —
// attribution on createdby/modifiedby/audit history.
//
// Important: Dataverse impersonation runs under the *intersection* of the app
// user's privileges and the impersonated user's privileges. A staff role
// missing a single table-level write privilege (e.g. Update on
// wmkf_ai_run) will 403 even though the app registration has it. To ship
// safely we:
//   1. Gate the feature behind DYNAMICS_IMPERSONATION_ENABLED so admins
//      can flip it per-environment after a privilege audit.
//   2. Catch 403s from impersonated writes in _writeFetch and retry once
//      without the header (logs a warning so the missing privilege is
//      visible). The user's request still succeeds; attribution falls
//      back to the service principal for that one call.
/**
 * @param {Record<string, string>} headers
 * @param {string|null|undefined} actingUserSystemId
 */
export function _withCallerId(headers, actingUserSystemId) {
  if (actingUserSystemId && process.env.DYNAMICS_IMPERSONATION_ENABLED === 'true') {
    headers.MSCRMCallerID = actingUserSystemId;
  }
  return headers;
}

/**
 * Write-path fetch with automatic privilege-intersection fallback.
 *
 * If the request has an MSCRMCallerID header and Dataverse responds 403,
 * retry once without the header so the write still lands as the service
 * principal. Emits a structured warning so the missing privilege is
 * actionable (telemetry, not silence). Other failure modes (4xx/5xx,
 * timeouts) bubble unchanged.
 *
 * @param {string} url
 * @param {{ method?: string, headers?: Record<string, string>, body?: string }} init -
 *   fetch init; init.headers must already include or exclude MSCRMCallerID per
 *   _withCallerId.
 * @param {string|null|undefined} actingUserSystemId - the systemuserid attempted,
 *   used for the warning. Pass null when no impersonation was attempted.
 * @param {{ noFallback?: boolean }} [options]
 */
export async function _writeFetch(url, init, actingUserSystemId, { noFallback = false } = {}) {
  let resp = await observeReviewerFindWarmEffect({
    effectClass: 'dataverse_write',
    operation: 'dataverse_write_fetch',
  }, () => fetchWithTimeout(url, init, API_TIMEOUT));
  const triedImpersonation = !!(actingUserSystemId && init.headers?.MSCRMCallerID);
  if (resp.status === 403 && triedImpersonation) {
    if (noFallback) return resp;
    const errBody = await resp.text().catch(() => '');
    console.warn(
      `[DynamicsService] Impersonated write rejected (acting=${actingUserSystemId}, ` +
      `url=${url}). Retrying as service principal. Body: ${errBody.slice(0, 300)}`
    );
    const fallbackHeaders = { ...init.headers };
    delete fallbackHeaders.MSCRMCallerID;
    resp = await observeReviewerFindWarmEffect({
      effectClass: 'dataverse_write',
      operation: 'dataverse_write_fetch',
    }, () => fetchWithTimeout(url, { ...init, headers: fallbackHeaders }, API_TIMEOUT));
  }
  return resp;
}

/**
 * Create a record. Uses Prefer: return=representation so the created row
 * comes back in the response — callers often need the new ID.
 *
 * @param {Svc} svc
 * @param {string} entitySet - e.g. 'wmkf_ai_runs', 'akoya_requests'
 * @param {object} data - Field payload. Lookups use `<nav>@odata.bind`.
 * @param {{ actingUserSystemId?: string|null, noFallback?: boolean }} [options]
 *   actingUserSystemId: when set, sends `MSCRMCallerID` so Dataverse records
 *   the acting staff member on `createdby` / audit history. Plumbed from the
 *   session by user-initiated API routes; null for unattended writes.
 * @returns {Promise<object>} The created record.
 */
export async function createRecord(svc, entitySet, data, { actingUserSystemId, noFallback = false } = {}) {
  assertTrustedDalContext('DynamicsService.createRecord');
  const token = await svc.getAccessToken();
  const baseUrl = process.env.DYNAMICS_URL;
  const url = `${baseUrl}/api/data/v9.2/${entitySet}`;

  const resp = await svc._writeFetch(url, {
    method: 'POST',
    headers: svc._withCallerId({
      ...svc.buildHeaders(token),
      Prefer: 'return=representation',
    }, actingUserSystemId),
    body: JSON.stringify(data),
  }, actingUserSystemId, { noFallback });

  if (!resp.ok) {
    const errorBody = await resp.text();
    throw buildServiceError('dataverse', resp, errorBody);
  }

  return svc.processAnnotations(await resp.json());
}

/**
 * Update a record by ID (PATCH). Returns void on success (204).
 *
 * @param {Svc} svc
 * @param {string} entitySet
 * @param {Guid} recordId - branded record id; interpolated into the key predicate
 * @param {object} data
 * @param {{ ifMatch?: string, actingUserSystemId?: string|null, noFallback?: boolean }} [options]
 *   ifMatch: ETag from a prior getRecord (`record._etag`). When supplied,
 *   Dataverse rejects the PATCH with 412 if the row changed since the read; a
 *   thrown Error's `.status` is set to 412 so callers can distinguish
 *   concurrent-edit. actingUserSystemId: sends `MSCRMCallerID` so `modifiedby`
 *   reflects the acting staff member.
 * @returns {Promise<void>}
 */
export async function updateRecord(svc, entitySet, recordId, data, { ifMatch, actingUserSystemId, noFallback = false } = {}) {
  assertTrustedDalContext('DynamicsService.updateRecord');
  const token = await svc.getAccessToken();
  const baseUrl = process.env.DYNAMICS_URL;
  const url = `${baseUrl}/api/data/v9.2/${entitySet}(${recordId})`;

  const headers = svc._withCallerId(svc.buildHeaders(token), actingUserSystemId);
  if (ifMatch) headers['If-Match'] = ifMatch;

  const resp = await svc._writeFetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(data),
  }, actingUserSystemId, { noFallback });

  if (!resp.ok) {
    const errorBody = await resp.text();
    // 412-aware behavior preserved: buildServiceError sets .status; callers
    // that branch on err.status === 412 (concurrent-edit detection) continue
    // to work. buildServiceError also adds .isTransient and Dataverse code/
    // message — purely additive vs. the pre-P1 throw.
    throw buildServiceError('dataverse', resp, errorBody);
  }
}

/**
 * Write a value to a single field only when the field is currently empty —
 * unless `overwrite: true` is set. Uses the M1 ETag plumbing so the write
 * is safe against concurrent edits: if the row changes between the
 * preflight read and the PATCH, the PATCH fails with 412 and we surface
 * that as `{ ok: false, reason: 'conflict' }` instead of clobbering.
 *
 * Returns a discriminated object so callers can translate to HTTP
 * responses themselves (some want 409, some want 200 + a flag):
 *
 *   { ok: true, written: true }                         — field was empty, write succeeded
 *   { ok: true, written: false, reason: 'overwrote' }   — field was non-empty, overwrite=true, write succeeded
 *   { ok: false, reason: 'already-populated', existing, modifiedOn }
 *   { ok: false, reason: 'conflict' }                   — 412 from Dataverse (race)
 *   { ok: false, reason: 'writeback_failed', error }    — any other failure
 *
 * @param {Svc} svc
 * @param {string} entitySet
 * @param {Guid} recordId - branded record id (flows into `getRecord`/`updateRecord`)
 * @param {string} fieldName - Dataverse field to write (e.g. 'wmkf_ai_summary')
 * @param {string|number|boolean} value - value to write
 * @param {{ overwrite?: boolean, extraSelect?: string[], actingUserSystemId?: string|null }} [options]
 *   overwrite (default false); extraSelect (default ['modifiedon']) — extra
 *   fields to return in `existing`; actingUserSystemId — pass-through to `updateRecord`.
 */
export async function updateIfEmpty(svc, entitySet, recordId, fieldName, value, { overwrite = false, extraSelect = ['modifiedon'], actingUserSystemId } = {}) {
  const selectFields = Array.from(new Set([fieldName, ...extraSelect])).join(',');

  let existing;
  try {
    existing = await svc.getRecord(entitySet, recordId, { select: selectFields });
  } catch (err) {
    return { ok: false, reason: 'writeback_failed', error: err };
  }

  const current = (existing?.[fieldName] ?? '');
  const isEmpty = current === '' || current === null || current === undefined ||
    (typeof current === 'string' && current.trim() === '');

  if (!isEmpty && !overwrite) {
    return {
      ok: false,
      reason: 'already-populated',
      existing: current,
      modifiedOn: existing?.modifiedon || null,
    };
  }

  try {
    await svc.updateRecord(
      entitySet,
      recordId,
      { [fieldName]: value },
      {
        ...(existing?._etag ? { ifMatch: existing._etag } : {}),
        ...(actingUserSystemId ? { actingUserSystemId } : {}),
      },
    );
    return isEmpty
      ? { ok: true, written: true }
      : { ok: true, written: false, reason: 'overwrote' };
  } catch (err) {
    if (/** @type {any} */ (err)?.status === 412) return { ok: false, reason: 'conflict' };
    return { ok: false, reason: 'writeback_failed', error: err };
  }
}

/**
 * Delete a record by ID. Returns void on success (204).
 *
 * @param {Svc} svc
 * @param {string} entitySet
 * @param {Guid} recordId - branded record id; interpolated into the key predicate
 * @param {{ actingUserSystemId?: string|null, ifMatch?: string }} [options]
 *   actingUserSystemId: when set, sends `MSCRMCallerID`. ifMatch: ETag from a
 *   prior read (`record._etag`); when supplied, Dataverse rejects the DELETE
 *   with 412 if the row changed since the read — fail-closed against a
 *   concurrent write (the merge collision-delete). The thrown Error's `.status`
 *   is the HTTP status so callers can branch on 412.
 * @returns {Promise<void>}
 */
export async function deleteRecord(svc, entitySet, recordId, { actingUserSystemId, ifMatch } = {}) {
  assertTrustedDalContext('DynamicsService.deleteRecord');
  const token = await svc.getAccessToken();
  const baseUrl = process.env.DYNAMICS_URL;
  const url = `${baseUrl}/api/data/v9.2/${entitySet}(${recordId})`;

  const headers = svc._withCallerId(svc.buildHeaders(token), actingUserSystemId);
  if (ifMatch) headers['If-Match'] = ifMatch;

  const resp = await svc._writeFetch(url, {
    method: 'DELETE',
    headers,
  }, actingUserSystemId);

  if (!resp.ok) {
    const errorBody = await resp.text();
    // Plain-Error shape preserved for existing callers that match on the
    // message; `.status` added (purely additive) so the conditional-delete
    // caller can distinguish a 412 precondition failure from other errors.
    const err = /** @type {Error & { status?: number }} */ (new Error(`Delete ${entitySet}(${recordId}) failed (${resp.status}): ${errorBody}`));
    err.status = resp.status;
    throw err;
  }
}

/**
 * Clear a single-valued navigation property (NULL a lookup) by deleting its
 * $ref. This is the supported way to disassociate a lookup — a PATCH with
 * `<NavProp>@odata.bind: null` is NOT accepted by Dataverse. Mirrors the proven
 * slot-clear in scripts/reset-request-reviewers.mjs (`<entity>(id)/<NavProp>/$ref`
 * DELETE). A 404 is treated as success: the reference was already absent, so the
 * post-condition (lookup empty) already holds — idempotent clear.
 *
 * @param {Svc} svc
 * @param {string} entitySet
 * @param {Guid} recordId - branded record id of the referencing row
 * @param {string} navProperty - single-valued nav prop (e.g. 'wmkf_PotentialReviewer1')
 * @param {{ actingUserSystemId?: string|null }} [options]
 *   actingUserSystemId: MSCRMCallerID attribution.
 */
export async function disassociate(svc, entitySet, recordId, navProperty, { actingUserSystemId } = {}) {
  assertTrustedDalContext('DynamicsService.disassociate');
  const token = await svc.getAccessToken();
  const baseUrl = process.env.DYNAMICS_URL;
  const url = `${baseUrl}/api/data/v9.2/${entitySet}(${recordId})/${navProperty}/$ref`;

  const headers = svc._withCallerId(svc.buildHeaders(token), actingUserSystemId);

  const resp = await svc._writeFetch(url, {
    method: 'DELETE',
    headers,
  }, actingUserSystemId);

  if (!resp.ok && resp.status !== 404) {
    const errorBody = await resp.text();
    const err = /** @type {Error & { status?: number }} */ (new Error(`Disassociate ${entitySet}(${recordId})/${navProperty} failed (${resp.status}): ${errorBody}`));
    err.status = resp.status;
    throw err;
  }
}
