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

export const ENTITY_SET_NAME = ENTITY_SET;
