/**
 * Adapter: accounts (applicant institution).
 *
 * Account reads for applicant-institution consumers: single-record lookup,
 * bounded business queries, and filtered auto-paginating reconciliation scans.
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

/**
 * Auto-paginating account scan for read-only reconciliation/reporting callers
 * that must classify a complete filtered population. Callers must supply a
 * filter; DynamicsService.queryAllRecords fails closed on unfiltered exports.
 */
export async function queryAllAccounts(options) {
  return DynamicsService.queryAllRecords(ENTITY_SET, options);
}

export const ENTITY_SET_NAME = ENTITY_SET;
