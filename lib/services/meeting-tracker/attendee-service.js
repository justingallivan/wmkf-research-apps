/** Reference-only attendee storage and live directory resolution. */

import { getSetting, setSetting } from '../settings-service.js';
import {
  getSiteVisitRecipientDirectory,
  resolveSiteVisitRecipientRefs,
} from '../site-visit/recipient-directory-service.js';
import { ServiceHttpError } from '../service-http-error.js';
import {
  MEETING_TRACKER_ATTENDEE_REFS_VERSION,
  MEETING_TRACKER_DEFAULT_ATTENDEES_SETTING,
  MEETING_TRACKER_LIMITS,
  isMeetingTrackerSchemaReady,
} from '../../../shared/config/meetingTracker.js';

const DEFAULT_DEPENDENCIES = Object.freeze({
  schemaReady: isMeetingTrackerSchemaReady,
  getSetting,
  setSetting,
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

/**
 * Read-side parse that never throws (review finding 1): a malformed stored
 * map yields an empty ref list plus an issue string so the session stays
 * readable and editable; the next explicit attendee save repairs the column.
 */
export function parseMeetingAttendeeRefsLenient(raw) {
  try {
    return { refs: parseMeetingAttendeeRefs(raw), issue: null };
  } catch (error) {
    return {
      refs: { version: MEETING_TRACKER_ATTENDEE_REFS_VERSION, attendees: [] },
      issue: error?.message || 'The saved attendee map could not be read.',
    };
  }
}

/**
 * Read-side resolution that never throws: each reference resolves on its own,
 * so one Board member who left the roster is reported in `issues` while the
 * rest of the attendees still render (review findings 1 and 2).
 */
export async function resolveMeetingAttendeesLenient(
  refs,
  dependencies = DEFAULT_DEPENDENCIES,
  { directory = null } = {},
) {
  const attendees = [];
  const issues = [];
  let normalized;
  try {
    normalized = normalizeMeetingAttendeeRefs(refs);
  } catch (error) {
    return { attendees, issues: [error?.message || 'The attendee map is invalid.'] };
  }
  let resolvedDirectory = directory;
  try {
    resolvedDirectory = resolvedDirectory || await dependencies.getRecipientDirectory();
  } catch (error) {
    return { attendees, issues: [`The recipient directory is unavailable: ${error?.message || 'unknown error'}`] };
  }
  for (const ref of normalized.attendees) {
    const label = ref.kind === 'staff' ? `staff profile ${ref.profileId}` : `roster entry ${ref.rosterId}`;
    try {
      const [row] = await dependencies.resolveRecipientRefs([ref], {
        allowManual: false,
        directory: resolvedDirectory,
      });
      if (ref.kind === 'roster' && row?.roleType !== 'Board') {
        issues.push(`${label} is no longer a current Board member.`);
        continue;
      }
      attendees.push({ name: row.name, email: row.email });
    } catch {
      issues.push(`${label} could not be resolved from the current directory.`);
    }
  }
  return { attendees, issues };
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
  return resolved.map((row, index) => {
    if (normalized.attendees[index]?.kind === 'roster' && row.roleType !== 'Board') {
      throw attendeeError(
        'External meeting attendees must be current Board members.',
        'meeting_tracker_attendee_unresolved',
        409,
      );
    }
    return { name: row.name, email: row.email };
  });
}

export async function getMeetingTrackerRecipientDirectory(dependencies = DEFAULT_DEPENDENCIES) {
  const directory = await dependencies.getRecipientDirectory();
  return {
    staff: (directory.staff || []).map((row) => ({
      ref: { kind: 'staff', profileId: row.profileId },
      name: row.name,
      email: row.email,
    })),
    board: (directory.external || [])
      .filter((row) => row.roleType === 'Board')
      .map((row) => ({
        ref: { kind: 'roster', rosterId: row.rosterId },
        name: row.name,
        email: row.email,
        affiliation: row.affiliation || null,
      })),
  };
}

const DEFAULT_ATTENDEE_NOTICE =
  'Default attendees are not configured. Add attendees for this session if needed.';

export async function getDefaultMeetingAttendees(
  dependencies = DEFAULT_DEPENDENCIES,
  { directory = null } = {},
) {
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
    const attendees = await resolveMeetingAttendeeRefs(refs, dependencies, { directory });
    return { refs, attendees, notice: null };
  } catch {
    return {
      refs: { version: MEETING_TRACKER_ATTENDEE_REFS_VERSION, attendees: [] },
      attendees: [],
      notice: 'Default attendees could not be resolved. Add attendees for this session if needed.',
    };
  }
}

/**
 * Admin writer for the D10 fixed staff list (review finding 4). Staff refs
 * only; validated against the live directory before the setting is written.
 */
export async function writeDefaultMeetingAttendees(
  input,
  { updatedBy = null } = {},
  dependencies = DEFAULT_DEPENDENCIES,
) {
  let refs;
  try {
    refs = normalizeDefaultAttendeeRefs({
      version: MEETING_TRACKER_ATTENDEE_REFS_VERSION,
      attendees: Array.isArray(input?.attendees) ? input.attendees : null,
    });
  } catch (error) {
    throw attendeeError(error?.message || 'Default attendees must be staff references.', 'meeting_tracker_attendees_invalid', 400);
  }
  const attendees = await resolveMeetingAttendeeRefs(refs, dependencies);
  const saved = await dependencies.setSetting(
    MEETING_TRACKER_DEFAULT_ATTENDEES_SETTING,
    JSON.stringify(refs),
    updatedBy,
  );
  if (!saved) throw attendeeError('The default attendee list could not be saved.', 'meeting_tracker_defaults_persist_failed', 500);
  return { refs, attendees };
}

export async function loadMeetingTrackerRecipientPicker(dependencies = DEFAULT_DEPENDENCIES) {
  if (!dependencies.schemaReady()) {
    throw attendeeError(
      'Meeting Tracker is not enabled for this environment.',
      'meeting_tracker_schema_not_ready',
      503,
    );
  }
  const directory = await dependencies.getRecipientDirectory();
  const recipients = {
    staff: (directory.staff || []).map((row) => ({
      ref: { kind: 'staff', profileId: row.profileId },
      name: row.name,
      email: row.email,
    })),
    board: (directory.external || [])
      .filter((row) => row.roleType === 'Board')
      .map((row) => ({
        ref: { kind: 'roster', rosterId: row.rosterId },
        name: row.name,
        email: row.email,
        affiliation: row.affiliation || null,
      })),
  };
  const defaults = await getDefaultMeetingAttendees(dependencies, { directory });
  return {
    ...recipients,
    defaultAttendeeRefs: defaults.refs.attendees,
    defaultAttendees: defaults.attendees,
    notice: defaults.notice,
  };
}

export const MEETING_TRACKER_ATTENDEE_DEPENDENCIES = DEFAULT_DEPENDENCIES;
