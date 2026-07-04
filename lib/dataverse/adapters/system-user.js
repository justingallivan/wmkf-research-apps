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

export const ENTITY_SET_NAME = ENTITY_SET;
