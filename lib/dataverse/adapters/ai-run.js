/**
 * Adapter: wmkf_ai_runs (Executor audit-trail row per prompt run).
 *
 * Single write site absorbed from lib/services/execute-prompt.js's writeRunRow:
 * a raw `DynamicsService.createRecord('wmkf_ai_runs', payload, { actingUserSystemId })`
 * call. Byte-mirrored: caller-built payload + options object forwarded verbatim.
 */

import { DynamicsService } from '../../services/dynamics-service.js';
import { entitySet } from '../core/entity-registry.js';

const ENTITY_SET = entitySet('wmkf_ai_runs');

/**
 * Create one wmkf_ai_run row. Mirrors the caller's exact create shape — the
 * payload is 100% caller-built; `options` (e.g. `{ actingUserSystemId }`) is
 * forwarded unchanged.
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

export const ENTITY_SET_NAME = ENTITY_SET;
