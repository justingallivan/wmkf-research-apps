/**
 * Adapter: accounts (applicant institution).
 *
 * Single raw call site absorbed from lib/services/grantee-document-assembly.js's
 * assembleGranteeDocument: a single-record read with a caller-owned select.
 */

import { DynamicsService } from '../../services/dynamics-service.js';
import { entitySet } from '../core/entity-registry.js';

const ENTITY_SET = entitySet('accounts');

/**
 * Byte-mirror of the caller's inline getRecord call.
 *
 * @param {string} id  accountid.
 * @param {object} [opts]
 * @param {string} [opts.select]  comma-string field list.
 * @returns {Promise<object>} raw DynamicsService.getRecord result.
 */
export async function getById(id, { select } = {}) {
  return DynamicsService.getRecord(ENTITY_SET, id, { select });
}

/**
 * Business-filter query passthrough — mirrors DynamicsService.queryRecords
 * arg-for-arg, exactly like grant-request.js's queryRequests. Byte-mirror of
 * reviewer-finder/my-candidates.js's inline OR-chained accountid lookup
 * (applicant institution "aka" batch resolve).
 */
export async function queryAccounts(options) {
  return DynamicsService.queryRecords(ENTITY_SET, options);
}

export const ENTITY_SET_NAME = ENTITY_SET;
