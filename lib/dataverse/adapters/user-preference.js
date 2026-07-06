/**
 * Adapter: wmkf_appuserpreferences (Dataverse-backed user preferences).
 *
 * Restriction-context posture is CALLER-OWNED, matching the other DAL adapters:
 * routes/services/scripts establish withDalContext or enterDynamicsBypassForScript
 * before calling this module. This adapter issues raw DynamicsService calls and
 * preserves the service-level failure/fallback contract in its caller.
 */

import { DynamicsService } from '../../services/dynamics-service.js';
import * as odata from '../core/odata.js';
import { entitySet } from '../core/entity-registry.js';

const ENTITY_SET = entitySet('wmkf_appuserpreferences');
const FIND_SELECT = 'wmkf_appuserpreferenceid,wmkf_preferencevalue,wmkf_isencrypted';
const LIST_SELECT = 'wmkf_preferencekey,wmkf_preferencevalue,wmkf_isencrypted';

function ownerFilter(systemuserid) {
  return odata.eqRaw('_ownerid_value', systemuserid);
}

function ownerAndKeyFilter(systemuserid, key) {
  return odata.and([
    ownerFilter(systemuserid),
    odata.eq('wmkf_preferencekey', key),
  ]);
}

export async function findByOwnerAndKey(systemuserid, key) {
  // Guarded swap (OData Escape Consolidation Plan, owner ruling S331): reject a
  // non-string key BEFORE odata.escape can coerce it.
  if (typeof key !== 'string') throw new TypeError('key must be a string');
  const { records } = await DynamicsService.queryRecords(ENTITY_SET, {
    select: FIND_SELECT,
    filter: ownerAndKeyFilter(systemuserid, key),
    top: 1,
  });
  return records?.[0] || null;
}

export async function listByOwner(systemuserid) {
  return DynamicsService.queryAllRecords(ENTITY_SET, {
    select: LIST_SELECT,
    filter: ownerFilter(systemuserid),
  });
}

export async function create(body) {
  return DynamicsService.createRecord(ENTITY_SET, body);
}

export async function update(id, body) {
  return DynamicsService.updateRecord(ENTITY_SET, id, body);
}

export async function remove(id) {
  return DynamicsService.deleteRecord(ENTITY_SET, id);
}

export const ENTITY_SET_NAME = ENTITY_SET;
export const SELECTS = {
  FIND_SELECT,
  LIST_SELECT,
};
