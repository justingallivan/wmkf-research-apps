/**
 * Adapter: wmkf_portalmemberships (applicant intake-portal membership).
 *
 * Single raw call site absorbed from lib/services/membership-service.js's
 * getLiveMembershipsForContact: byte-mirrors the exact select/filter/top shape
 * (live == approved + active). The picklist/statecode constants stay in the
 * caller — this module owns only the transport call.
 */

import { DynamicsService } from '../../services/dynamics-service.js';
import { entitySet } from '../core/entity-registry.js';

const ENTITY_SET = entitySet('wmkf_portalmemberships');

/**
 * Byte-mirror of getLiveMembershipsForContact's inline queryRecords call.
 *
 * @param {string} select  comma-string field list (caller-owned).
 * @param {string} filter  caller-built OData filter.
 * @param {number} top
 * @returns {Promise<{records: object[], count, totalCount, hasMore}>} raw result.
 */
export async function queryMemberships(select, filter, top) {
  return DynamicsService.queryRecords(ENTITY_SET, { select, filter, top });
}

export const ENTITY_SET_NAME = ENTITY_SET;
