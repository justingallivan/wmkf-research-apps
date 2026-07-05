/**
 * Adapter: wmkf_proposalbudgetlines (intake-drain budget-line rows).
 *
 * Single raw call site absorbed from pages/api/cron/drain-submissions.js's
 * budget-line drain step: byte-mirrors the raw createRecord call (no options —
 * the caller relies on Dataverse's alternate-key duplicate_pk classification for
 * idempotent retries, handled entirely by the caller's catch block).
 */

import { DynamicsService } from '../../services/dynamics-service.js';
import { entitySet } from '../core/entity-registry.js';

const ENTITY_SET = entitySet('wmkf_proposalbudgetlines');

/**
 * Byte-mirror of the drain step's inline createRecord call.
 *
 * @param {object} payload  the create body (caller-owned field set).
 * @returns {Promise<object>} raw DynamicsService.createRecord result.
 */
export async function create(payload) {
  return DynamicsService.createRecord(ENTITY_SET, payload);
}

export const ENTITY_SET_NAME = ENTITY_SET;
