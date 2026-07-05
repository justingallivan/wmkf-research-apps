/**
 * Adapter: wmkf_appgrantcycles (grant cycle metadata).
 *
 * Two raw call sites absorbed, each byte-mirrored from its former inline caller:
 *  - `queryAll` — lib/services/maintenance-service.js's cleanupBlobs blob-URL scan
 *    (select/filter forwarded verbatim; no options).
 */

import { DynamicsService } from '../../services/dynamics-service.js';
import { entitySet } from '../core/entity-registry.js';

const ENTITY_SET = entitySet('wmkf_appgrantcycles');

/**
 * Business-filter paginated-scan passthrough — mirrors
 * DynamicsService.queryAllRecords arg-for-arg, matching the akoya_requests
 * adapter's queryAllRequests design for the same reason: the caller's filter is
 * bespoke business logic (a blob-URL existence scan) that does not consolidate
 * into a named method.
 *
 * @param {object} [options]  forwarded verbatim to queryAllRecords.
 * @returns {Promise<{records: object[], count, totalCount, hasMore, capped?}>} raw result.
 */
export async function queryAllCycles(options) {
  return DynamicsService.queryAllRecords(ENTITY_SET, options);
}

export const ENTITY_SET_NAME = ENTITY_SET;
