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

/**
 * Fetch one wmkf_ai_run row by GUID with a caller-supplied `$select` — a raw
 * passthrough (byte-mirror) of prompt-resolver.js's PromptResolver
 * `_fetchFromDynamics`'s inline `DynamicsService.getRecord(entitySet, guid,
 * { select: \`${systemField},${userField}\` })` call (the Session-103 scratch
 * prompt-template row).
 *
 * @param {string} id  wmkf_ai_runid.
 * @param {string} select  comma-joined field list.
 * @returns {Promise<object>} raw DynamicsService.getRecord result.
 */
export async function getByIdWithSelect(id, select) {
  return DynamicsService.getRecord(ENTITY_SET, id, { select });
}

export const ENTITY_SET_NAME = ENTITY_SET;
