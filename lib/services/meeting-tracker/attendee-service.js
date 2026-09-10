/** Reference-only attendee storage and live directory resolution. */

import { getSetting } from '../settings-service.js';
import {
  getSiteVisitRecipientDirectory,
  resolveSiteVisitRecipientRefs,
} from '../site-visit/recipient-directory-service.js';
import { ServiceHttpError } from '../service-http-error.js';
import {
  MEETING_TRACKER_ATTENDEE_REFS_VERSION,
  MEETING_TRACKER_DEFAULT_ATTENDEES_SETTING,
  MEETING_TRACKER_LIMITS,
} from '../../../shared/config/meetingTracker.js';

const DEFAULT_DEPENDENCIES = Object.freeze({
  getSetting,
  getRecipientDirectory: getSiteVisitRecipientDirectory,
  resolveRecipientRefs: resolveSiteVisitRecipientRefs,
});

function attendeeError(message, code, httpStatus = 400) {
  return new ServiceHttpError(message, {
    httpStatus,
    code,
    body: { error: message, code },
  });
}

function exactKeys(value, allowed) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every((key) => allowed.has(key));
}

export function normalizeMeetingAttendeeRefs(input, { persisted = false } = {}) {
  const code = persisted
    ? 'meeting_tracker_attendee_map_invalid'
    : 'meeting_tracker_attendees_invalid';
  const status = persisted ? 503 : 400;
  const fail = (message) => { throw attendeeError(message, code, status); };
  if (!exactKeys(input, new Set(['version', 'attendees']))
    || input.version !== MEETING_TRACKER_ATTENDEE_REFS_VERSION
    || !Array.isArray(input.attendees)) {
    fail(`Attendees must use reference-map version ${MEETING_TRACKER_ATTENDEE_REFS_VERSION}.`);
  }
  if (input.attendees.length > MEETING_TRACKER_LIMITS.attendees) {
    fail(`A session supports at most ${MEETING_TRACKER_LIMITS.attendees} attendees.`);
  }
  const seen = new Set();
  const attendees = input.attendees.map((ref) => {
    let normalized;
    if (exactKeys(ref, new Set(['kind', 'profileId'])) && ref.kind === 'staff'
      && Number.isSafeInteger(ref.profileId) && ref.profileId > 0) {
      normalized = { kind: 'staff', profileId: ref.profileId };
    } else if (exactKeys(ref, new Set(['kind', 'rosterId'])) && ref.kind === 'roster'
      && Number.isSafeInteger(ref.rosterId) && ref.rosterId > 0) {
      normalized = { kind: 'roster', rosterId: ref.rosterId };
    } else {
      fail('Each attendee must be a staff profile or roster reference.');
    }
    const key = normalized.kind === 'staff'
      ? `staff:${normalized.profileId}`
      : `roster:${normalized.rosterId}`;
    if (seen.has(key)) fail(`Duplicate attendee reference: ${key}.`);
    seen.add(key);
    return normalized;
  });
  return { version: MEETING_TRACKER_ATTENDEE_REFS_VERSION, attendees };
}

export function parseMeetingAttendeeRefs(raw) {
  let parsed;
  try {
    parsed = JSON.parse(String(raw || ''));
  } catch {
    throw attendeeError(
      'The saved session attendee map requires reconciliation.',
      'meeting_tracker_attendee_map_invalid',
      503,
    );
  }
  return normalizeMeetingAttendeeRefs(parsed, { persisted: true });
}

function normalizeDefaultAttendeeRefs(input) {
  const normalized = normalizeMeetingAttendeeRefs(input, { persisted: true });
  if (normalized.attendees.some((ref) => ref.kind !== 'staff')) {
    throw attendeeError(
      'Default meeting attendees may contain only staff references.',
      'meeting_tracker_attendee_map_invalid',
      503,
    );
  }
  return normalized;
}

export async function resolveMeetingAttendeeRefs(
  refs,
  dependencies = DEFAULT_DEPENDENCIES,
  { directory = null } = {},
) {
  const normalized = normalizeMeetingAttendeeRefs(refs);
  const resolved = await dependencies.resolveRecipientRefs(normalized.attendees, {
    allowManual: false,
    directory: directory || await dependencies.getRecipientDirectory(),
  });
  return resolved.map((row) => ({ name: row.name, email: row.email }));
}

const DEFAULT_ATTENDEE_NOTICE =
  'Default attendees are not configured. Add attendees for this session if needed.';

export async function getDefaultMeetingAttendees(dependencies = DEFAULT_DEPENDENCIES) {
  let raw = null;
  try {
    raw = await dependencies.getSetting(MEETING_TRACKER_DEFAULT_ATTENDEES_SETTING);
  } catch {
    return {
      refs: { version: MEETING_TRACKER_ATTENDEE_REFS_VERSION, attendees: [] },
      attendees: [],
      notice: DEFAULT_ATTENDEE_NOTICE,
    };
  }
  if (raw == null || String(raw).trim() === '') {
    return {
      refs: { version: MEETING_TRACKER_ATTENDEE_REFS_VERSION, attendees: [] },
      attendees: [],
      notice: DEFAULT_ATTENDEE_NOTICE,
    };
  }
  try {
    const refs = normalizeDefaultAttendeeRefs(JSON.parse(String(raw)));
    const attendees = await resolveMeetingAttendeeRefs(refs, dependencies);
    return { refs, attendees, notice: null };
  } catch {
    return {
      refs: { version: MEETING_TRACKER_ATTENDEE_REFS_VERSION, attendees: [] },
      attendees: [],
      notice: 'Default attendees could not be resolved. Add attendees for this session if needed.',
    };
  }
}

export const MEETING_TRACKER_ATTENDEE_DEPENDENCIES = DEFAULT_DEPENDENCIES;
