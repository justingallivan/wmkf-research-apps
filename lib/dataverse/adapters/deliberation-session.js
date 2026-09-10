/** Adapter for Wave 28 deliberation-session rows. */

import { DynamicsService } from '../../services/dynamics-service.js';
import { entitySet } from '../core/entity-registry.js';
import * as odata from '../core/odata.js';
import {
  DELIBERATION_SESSION_STATUS,
  MEETING_TRACKER_ENTITY_SETS,
  isMeetingTrackerSchemaReady,
} from '../../../shared/config/meetingTracker.js';

const ENTITY_SET = entitySet(MEETING_TRACKER_ENTITY_SETS.sessions);

function assertReady() {
  if (isMeetingTrackerSchemaReady()) return;
  const error = new Error('Meeting Tracker schema is not ready.');
  error.status = 503;
  error.code = 'meeting_tracker_schema_not_ready';
  throw error;
}

export const DELIBERATION_SESSION_SELECT = [
  'wmkf_deliberationsessionid',
  'wmkf_name',
  'wmkf_scheduledstart',
  'wmkf_scheduledend',
  'wmkf_ianatimezone',
  'wmkf_location',
  'wmkf_meetinglink',
  'wmkf_attendeerefsjson',
  'wmkf_notes',
  'wmkf_status',
  '_wmkf_updatedby_value',
  'createdon',
  'modifiedon',
].join(',');

export function list({ includeCancelled = false } = {}) {
  assertReady();
  return DynamicsService.queryAllRecords(ENTITY_SET, {
    select: DELIBERATION_SESSION_SELECT,
    ...(includeCancelled ? {} : {
      filter: odata.neRaw('wmkf_status', DELIBERATION_SESSION_STATUS.CANCELLED),
    }),
    orderby: 'wmkf_scheduledstart asc',
  });
}

/** Null on a Dataverse 404 so services can answer 404, not 500 (review finding 5). */
export async function getById(sessionId) {
  assertReady();
  try {
    return await DynamicsService.getRecord(ENTITY_SET, sessionId, {
      select: DELIBERATION_SESSION_SELECT,
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

export function update(sessionId, etag, patch, { actingUserSystemId } = {}) {
  assertReady();
  return DynamicsService.updateRecord(ENTITY_SET, sessionId, patch, {
    ifMatch: etag,
    actingUserSystemId,
  });
}

export const ENTITY_SET_NAME = ENTITY_SET;
