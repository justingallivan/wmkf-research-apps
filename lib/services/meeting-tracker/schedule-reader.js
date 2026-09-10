/** Fail-open batched schedule reader shared with Workbench and email flows. */

import * as slotAdapter from '../../dataverse/adapters/deliberation-slot.js';
import {
  DELIBERATION_SESSION_STATUS,
  isMeetingTrackerSchemaReady,
} from '../../../shared/config/meetingTracker.js';
import {
  MEETING_TRACKER_ATTENDEE_DEPENDENCIES,
  parseMeetingAttendeeRefs,
  resolveMeetingAttendeeRefs,
} from './attendee-service.js';

const BATCH_SIZE = slotAdapter.DELIBERATION_SLOT_REQUEST_BATCH;

const DEFAULT_DEPENDENCIES = Object.freeze({
  schemaReady: isMeetingTrackerSchemaReady,
  findSlotsByRequestIds: slotAdapter.findByRequestIds,
  getRecipientDirectory: MEETING_TRACKER_ATTENDEE_DEPENDENCIES.getRecipientDirectory,
  resolveAttendees: (refs, { directory } = {}) => (
    resolveMeetingAttendeeRefs(refs, MEETING_TRACKER_ATTENDEE_DEPENDENCIES, { directory })
  ),
});

function nullSchedule(requestIds) {
  return new Map((requestIds || []).map((requestId) => [requestId, null]));
}

function sessionFromSlot(row) {
  return row?.wmkf_Session || row?.wmkf_session || row?.session || null;
}

function laterThan(left, right) {
  return new Date(left || 0).getTime() > new Date(right || 0).getTime();
}

/**
 * Return the latest non-cancelled deliberation slot for every supplied request.
 * Any readiness, Dataverse, attendee-map, or directory failure returns the
 * complete all-null map so consumers can render their normal unscheduled state.
 */
export async function getDeliberationScheduleByRequests(
  requestIds,
  dependencies = DEFAULT_DEPENDENCIES,
) {
  const output = nullSchedule(requestIds);
  if (!dependencies.schemaReady()) return output;

  try {
    const ids = [...new Set((requestIds || []).map((id) => String(id).toLowerCase()))];
    const rows = [];
    for (let index = 0; index < ids.length; index += BATCH_SIZE) {
      const result = await dependencies.findSlotsByRequestIds(ids.slice(index, index + BATCH_SIZE));
      if (result?.hasMore) throw new Error('Meeting Tracker slot batch was truncated.');
      rows.push(...(result?.records || []));
    }

    const latest = new Map();
    for (const row of rows) {
      const requestId = String(row?._wmkf_request_value || '').toLowerCase();
      const session = sessionFromSlot(row);
      if (!requestId || !session
        || session.wmkf_status === DELIBERATION_SESSION_STATUS.CANCELLED) continue;
      const current = latest.get(requestId);
      if (!current || laterThan(
        session.wmkf_scheduledstart,
        sessionFromSlot(current)?.wmkf_scheduledstart,
      )) {
        latest.set(requestId, row);
      }
    }

    const directory = latest.size ? await dependencies.getRecipientDirectory() : null;
    const attendeeCache = new Map();
    for (const row of latest.values()) {
      const session = sessionFromSlot(row);
      const sessionId = String(session.wmkf_deliberationsessionid || '').toLowerCase();
      if (!attendeeCache.has(sessionId)) {
        const refs = parseMeetingAttendeeRefs(session.wmkf_attendeerefsjson);
        attendeeCache.set(
          sessionId,
          await dependencies.resolveAttendees(refs, { directory }),
        );
      }
    }

    for (const requestId of output.keys()) {
      const row = latest.get(String(requestId).toLowerCase());
      if (!row) continue;
      const session = sessionFromSlot(row);
      output.set(requestId, {
        sessionId: session.wmkf_deliberationsessionid,
        scheduledStartIso: session.wmkf_scheduledstart || null,
        scheduledEndIso: session.wmkf_scheduledend || null,
        ianaTimeZone: session.wmkf_ianatimezone || '',
        meetingLink: session.wmkf_meetinglink || '',
        location: session.wmkf_location || '',
        order: row.wmkf_order,
        minutes: row.wmkf_minutes,
        attendees: attendeeCache.get(
          String(session.wmkf_deliberationsessionid || '').toLowerCase(),
        ) || [],
      });
    }
    return output;
  } catch {
    return nullSchedule(requestIds);
  }
}

export const MEETING_TRACKER_SCHEDULE_READER_DEPENDENCIES = DEFAULT_DEPENDENCIES;
