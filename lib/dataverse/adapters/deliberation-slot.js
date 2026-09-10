/** Adapter for Wave 28 deliberation-slot rows. */

import { DynamicsService } from '../../services/dynamics-service.js';
import { entitySet } from '../core/entity-registry.js';
import * as odata from '../core/odata.js';
import {
  DELIBERATION_SESSION_STATUS,
  MEETING_TRACKER_ENTITY_SETS,
  isMeetingTrackerSchemaReady,
} from '../../../shared/config/meetingTracker.js';

const ENTITY_SET = entitySet(MEETING_TRACKER_ENTITY_SETS.slots);
export const DELIBERATION_SLOT_REQUEST_BATCH = 25;

function assertReady() {
  if (isMeetingTrackerSchemaReady()) return;
  const error = new Error('Meeting Tracker schema is not ready.');
  error.status = 503;
  error.code = 'meeting_tracker_schema_not_ready';
  throw error;
}

export const DELIBERATION_SLOT_SELECT = [
  'wmkf_deliberationslotid',
  'wmkf_name',
  'wmkf_order',
  'wmkf_minutes',
  'wmkf_notes',
  '_wmkf_session_value',
  '_wmkf_request_value',
  '_wmkf_leadpd_value',
  '_wmkf_updatedby_value',
  'createdon',
  'modifiedon',
].join(',');

export const DELIBERATION_SESSION_EXPAND = [
  'wmkf_deliberationsessionid',
  'wmkf_scheduledstart',
  'wmkf_scheduledend',
  'wmkf_ianatimezone',
  'wmkf_location',
  'wmkf_meetinglink',
  'wmkf_attendeerefsjson',
  'wmkf_status',
].join(',');

export const DELIBERATION_SLOT_DETAIL_EXPAND = [
  'wmkf_Request($select=akoya_requestid,akoya_requestnum,akoya_title)',
  'wmkf_LeadPd($select=systemuserid,fullname)',
].join(',');

export function findByRequestIds(requestIds) {
  assertReady();
  const ids = [...new Set((requestIds || []).map((id) => String(id).toLowerCase()))];
  if (ids.length === 0) return Promise.resolve({ records: [] });
  if (ids.length > DELIBERATION_SLOT_REQUEST_BATCH) {
    throw new Error(`deliberation-slot.findByRequestIds supports at most ${DELIBERATION_SLOT_REQUEST_BATCH} request IDs`);
  }
  const requestFilter = odata.or(ids.map((id) => odata.eqGuid('_wmkf_request_value', id)));
  // queryAllRecords pages past the per-request top so 25 requests with many
  // slots each cannot truncate the batch (review finding 8); `capped` still
  // surfaces the 5000-row ceiling to the fail-open reader.
  return DynamicsService.queryAllRecords(ENTITY_SET, {
    select: DELIBERATION_SLOT_SELECT,
    expand: `wmkf_Session($select=${DELIBERATION_SESSION_EXPAND})`,
    filter: odata.and([
      `(${requestFilter})`,
      `wmkf_Session/wmkf_status ne ${DELIBERATION_SESSION_STATUS.CANCELLED}`,
    ]),
  });
}

export function findBySession(sessionId) {
  assertReady();
  return DynamicsService.queryAllRecords(ENTITY_SET, {
    select: DELIBERATION_SLOT_SELECT,
    expand: DELIBERATION_SLOT_DETAIL_EXPAND,
    filter: odata.eqGuid('_wmkf_session_value', sessionId),
    orderby: 'wmkf_order asc',
  });
}

/** Null on a Dataverse 404 so services can answer 404, not 500 (review finding 5). */
export async function getById(slotId) {
  assertReady();
  try {
    return await DynamicsService.getRecord(ENTITY_SET, slotId, {
      select: DELIBERATION_SLOT_SELECT,
    });
  } catch (error) {
    if (error?.status === 404 || /\(404\)/.test(error?.message || '')) return null;
    throw error;
  }
}

export function create(payload, { actingUserSystemId } = {}) {
  assertReady();
  return DynamicsService.createRecord(ENTITY_SET, payload, { actingUserSystemId });
}

export function update(slotId, etag, patch, { actingUserSystemId } = {}) {
  assertReady();
  return DynamicsService.updateRecord(ENTITY_SET, slotId, patch, {
    ifMatch: etag,
    actingUserSystemId,
  });
}

export function remove(slotId, etag, { actingUserSystemId } = {}) {
  assertReady();
  return DynamicsService.deleteRecord(ENTITY_SET, slotId, {
    ifMatch: etag,
    actingUserSystemId,
  });
}

export function updateOrders(rows, { actingUserSystemId } = {}) {
  assertReady();
  return DynamicsService.executeChangeset(rows.map(({ slotId, etag, order }) => ({
    method: 'PATCH',
    url: `${ENTITY_SET}(${slotId})`,
    ifMatch: etag,
    body: {
      wmkf_order: order,
      'wmkf_UpdatedBy@odata.bind': `/systemusers(${actingUserSystemId})`,
    },
  })), { actingUserSystemId });
}

export const ENTITY_SET_NAME = ENTITY_SET;
