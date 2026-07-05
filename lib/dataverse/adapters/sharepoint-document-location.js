/**
 * Adapter: sharepointdocumentlocations (SharePoint bucket discovery).
 *
 * Two raw call shapes absorbed, shared byte-for-byte by lib/utils/sharepoint-buckets.js
 * and pages/api/expertise-finder/batch-match.js:
 *  - `findByRegardingObject` — locations pointing at a request.
 *  - `findByParentIds` — resolve parent locations → library names (OR-chain).
 */

import { DynamicsService } from '../../services/dynamics-service.js';
import * as odata from '../core/odata.js';
import { entitySet } from '../core/entity-registry.js';

const ENTITY_SET = entitySet('sharepointdocumentlocations');

/**
 * Byte-mirror of the callers' inline `_regardingobjectid_value eq '<id>'` query.
 * `requestId` is a server-sourced GUID; `odata.eq` quotes/escapes it exactly as
 * the raw callers' hand-built string literal did (escaping is a no-op for a
 * well-formed GUID, so the resulting filter string is unchanged).
 *
 * @param {string} requestId
 * @param {object} [opts]
 * @param {string} [opts.select]  comma-string field list.
 * @param {number} [opts.top=10]
 * @returns {Promise<{records: object[], count, totalCount, hasMore}>} raw result.
 */
export async function findByRegardingObject(requestId, { select, top = 10 } = {}) {
  return DynamicsService.queryRecords(ENTITY_SET, {
    select,
    filter: odata.eq('_regardingobjectid_value', requestId),
    top,
  });
}

/**
 * Byte-mirror of the callers' inline parent-location OR-chain query
 * (`sharepointdocumentlocationid eq <id> or ...`, ids interpolated raw —
 * server-sourced, never client input).
 *
 * @param {string[]} parentIds
 * @param {object} [opts]
 * @param {string} [opts.select]  comma-string field list (caller-owned; differs
 *   per caller, e.g. 'relativeurl' vs 'sharepointdocumentlocationid,relativeurl').
 * @param {number} [opts.top]
 * @returns {Promise<{records: object[], count, totalCount, hasMore}>} raw result.
 */
export async function findByParentIds(parentIds, { select, top } = {}) {
  return DynamicsService.queryRecords(ENTITY_SET, {
    select,
    filter: odata.or(parentIds.map((id) => odata.eqRaw('sharepointdocumentlocationid', id))),
    top,
  });
}

export const ENTITY_SET_NAME = ENTITY_SET;
