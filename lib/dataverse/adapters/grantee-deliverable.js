/**
 * Adapter: wmkf_granteedeliverables (grantee deliverable package row).
 *
 * Absorbs the three raw call shapes from lib/services/grantee-deliverable-record.js
 * byte-for-byte: the request-scoped read (queryRecords), the create, and the update.
 * `DELIVERABLE_SELECT`/`ENTITY_SET` stay defined in the caller (this module does
 * not own the field-list constant) — callers pass their own select string.
 */

import { DynamicsService } from '../../services/dynamics-service.js';
import { entitySet } from '../core/entity-registry.js';

const ENTITY_SET = entitySet('wmkf_granteedeliverables');

/**
 * Byte-mirror of getDeliverableForRequest's inline queryRecords call.
 *
 * @param {string} filter  caller-built OData filter (e.g. `_wmkf_request_value eq <id>`).
 * @param {object} [opts]
 * @param {string} [opts.select]  comma-string field list.
 * @param {string} [opts.orderby]
 * @param {number} [opts.top]
 * @returns {Promise<{records: object[], count, totalCount, hasMore}>} raw result.
 */
export async function queryDeliverables(filter, { select, orderby, top } = {}) {
  return DynamicsService.queryRecords(ENTITY_SET, { select, filter, orderby, top });
}

/**
 * Byte-mirror of ensureDeliverableForRequest's inline createRecord call.
 *
 * @param {object} payload  the create body (caller-owned field set).
 * @param {object} [options]  forwarded verbatim to createRecord.
 * @returns {Promise<object>} raw DynamicsService.createRecord result.
 */
export async function create(payload, options) {
  if (options === undefined) {
    return DynamicsService.createRecord(ENTITY_SET, payload);
  }
  return DynamicsService.createRecord(ENTITY_SET, payload, options);
}

/**
 * Byte-mirror of patchDeliverable's inline updateRecord call.
 *
 * @param {string} id  wmkf_granteedeliverableid.
 * @param {object} patch  the PATCH body (caller-owned field set).
 * @param {object} [options]  forwarded verbatim to updateRecord.
 * @returns {Promise<object>} raw DynamicsService.updateRecord result.
 */
export async function update(id, patch, options) {
  if (options === undefined) {
    return DynamicsService.updateRecord(ENTITY_SET, id, patch);
  }
  return DynamicsService.updateRecord(ENTITY_SET, id, patch, options);
}

export const ENTITY_SET_NAME = ENTITY_SET;
