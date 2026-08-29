/**
 * Adapter: systemusers (Dynamics/Dataverse staff identity).
 *
 * Two read call shapes absorbed from Wave-4 conversion, each byte-mirrored
 * from its former inline caller:
 *
 *  - `findByEmail` — lib/services/dynamics-identity-service.js's
 *    reconcileProfile: resolve a Dynamics systemuser by internalemailaddress
 *    (identity reconciliation between user_profiles.azure_email and Dynamics).
 *  - `getById` — lib/services/reviewer-acceptance-email.js's
 *    resolveAcceptanceConfirmationSender: resolve the program director's
 *    systemuser record to pick an acceptance-email sender.
 *
 * Restriction-context posture is CALLER-OWNED, matching the other Wave-3/4
 * adapters — this module issues the raw transport call and leaves the trust
 * boundary to the caller.
 */

import { DynamicsService } from '../../services/dynamics-service.js';
import * as odata from '../core/odata.js';
import { entitySet } from '../core/entity-registry.js';

const ENTITY_SET = entitySet('systemusers');

/**
 * Byte-mirror of dynamics-identity-service.reconcileProfile's inline query:
 * select/filter/top unchanged. Returns the raw queryRecords result shape
 * (`{ records, ... }`) so the caller keeps its own `records.length === 0` /
 * `records[0]` branching.
 */
export async function findByEmail(email) {
  return DynamicsService.queryRecords(ENTITY_SET, {
    select: 'systemuserid,fullname,isdisabled,internalemailaddress',
    filter: odata.eq('internalemailaddress', email),
    top: 1,
  });
}

/**
 * Byte-mirror of reviewer-acceptance-email.resolveAcceptanceConfirmationSender's
 * inline DynamicsService.getRecord call: select unchanged.
 */
export async function getById(id) {
  return DynamicsService.getRecord(ENTITY_SET, id, {
    select: 'systemuserid,internalemailaddress,isdisabled',
  });
}

/**
 * Generic single-record fetch with a caller-supplied `$select` — a raw
 * passthrough (byte-mirror) for callers whose field list is genuinely
 * bespoke and does not match `getById`'s fixed select. Byte-mirror of the
 * email-signature / program-director-resolver / send-emails inline
 * `DynamicsService.getRecord('systemusers', id, { select: '...' })` calls.
 */
export async function getByIdWithSelect(id, select) {
  return DynamicsService.getRecord(ENTITY_SET, id, { select: odata.select(select) });
}

/**
 * Business-filter query passthrough — mirrors DynamicsService.queryRecords
 * arg-for-arg (`select`/`filter`/`top`, any subset). Byte-mirror of
 * program-director-resolver.resolveByEmail's inline
 * `internalemailaddress eq '<escaped>' and isdisabled eq false` query.
 */
export async function queryUsers(options) {
  return DynamicsService.queryRecords(ENTITY_SET, options);
}

/**
 * Paginated business-filter query for callers that must enumerate every
 * matching system user rather than accept queryRecords' 100-row safety cap.
 */
export async function queryAllUsers(options) {
  return DynamicsService.queryAllRecords(ENTITY_SET, options);
}

export const ENTITY_SET_NAME = ENTITY_SET;
