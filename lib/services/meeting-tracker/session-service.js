/** Deliberation-session validation, projection, and ETag-fenced writes. */

import * as sessionAdapter from '../../dataverse/adapters/deliberation-session.js';
import { getLiveBriefingLink } from '../deliberation-briefing/briefing-link-service.js';
import * as slotAdapter from '../../dataverse/adapters/deliberation-slot.js';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import { requestInstitution } from '../../../shared/utils/institution.js';
import {
  DELIBERATION_SESSION_STATUS,
  MEETING_TRACKER_ATTENDEE_REFS_VERSION,
  MEETING_TRACKER_LIMITS,
  isMeetingTrackerSchemaReady,
} from '../../../shared/config/meetingTracker.js';
import { isGuid } from '../../utils/guid.js';
import { ServiceHttpError } from '../service-http-error.js';
import {
  MEETING_TRACKER_ATTENDEE_DEPENDENCIES,
  getDefaultMeetingAttendees,
  normalizeMeetingAttendeeRefs,
  parseMeetingAttendeeRefsLenient,
  resolveMeetingAttendeeRefs,
  resolveMeetingAttendeesLenient,
} from './attendee-service.js';

const DEFAULT_DEPENDENCIES = Object.freeze({
  schemaReady: isMeetingTrackerSchemaReady,
  listSessions: sessionAdapter.list,
  getSession: sessionAdapter.getById,
  createSession: sessionAdapter.create,
  updateSession: sessionAdapter.update,
  findSlotsBySession: slotAdapter.findBySession,
  getDefaultAttendees: getDefaultMeetingAttendees,
  // Strict: explicit attendee input on create/update must resolve or fail.
  resolveAttendees: resolveMeetingAttendeeRefs,
  // Lenient: reads never fail on a stale or unreadable reference.
  resolveAttendeesLenient: (refs, { directory } = {}) => (
    resolveMeetingAttendeesLenient(refs, MEETING_TRACKER_ATTENDEE_DEPENDENCIES, { directory })
  ),
  getRecipientDirectory: MEETING_TRACKER_ATTENDEE_DEPENDENCIES.getRecipientDirectory,
  // D11: each slot carries the request's live briefing link; fail-open null
  // (flag off, no Share yet, expired, or unreadable) renders "not yet shared".
  getBriefingLink: (requestId) => getLiveBriefingLink({ requestId }),
  // Applicant institution per slot (row and agenda email); one bounded read
  // per session detail, fail-open null.
  findRequestsByIds: grantRequestAdapter.findByIds,
});

function trackerError(message, code, httpStatus = 400, extras = {}) {
  return new ServiceHttpError(message, {
    httpStatus,
    code,
    body: { error: message, code, ...extras },
  });
}

function assertReady(dependencies) {
  if (!dependencies.schemaReady()) {
    throw trackerError(
      'Meeting Tracker is not enabled for this environment.',
      'meeting_tracker_schema_not_ready',
      503,
    );
  }
}

function requireActor(actingUserSystemId) {
  if (!isGuid(actingUserSystemId || '')) {
    throw trackerError(
      'A mapped Dataverse staff identity is required to save a meeting.',
      'meeting_tracker_actor_required',
      403,
    );
  }
}

function normalizeText(value, field, max, { required = false } = {}) {
  const text = String(value ?? '').trim();
  if ((required && !text) || text.length > max) {
    throw trackerError(
      `${field} ${required ? 'is required and ' : ''}must be at most ${max} characters.`,
      'meeting_tracker_field_invalid',
      400,
      { field },
    );
  }
  return text;
}

function validIanaTimeZone(value) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function validateMeetingLink(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value !== value.trim()
    || value.length > MEETING_TRACKER_LIMITS.meetingLink) {
    throw trackerError('The meeting link must be an HTTPS URL of at most 1000 characters.', 'meeting_tracker_link_invalid');
  }
  let parsed;
  try { parsed = new URL(value); } catch { parsed = null; }
  if (!parsed || parsed.protocol !== 'https:' || !parsed.hostname) {
    throw trackerError('The meeting link must be an HTTPS URL of at most 1000 characters.', 'meeting_tracker_link_invalid');
  }
  return value;
}

function normalizeRange(startValue, endValue) {
  if (typeof startValue !== 'string' || !startValue.trim()
    || typeof endValue !== 'string' || !endValue.trim()) {
    throw trackerError(
      'The session start and end are required.',
      'meeting_tracker_time_invalid',
      422,
    );
  }
  const start = new Date(startValue);
  const end = new Date(endValue);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
    throw trackerError(
      'The session end must be after its start.',
      'meeting_tracker_time_invalid',
      422,
    );
  }
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

function sessionName(startIso) {
  return `Deliberation session · ${startIso}`.slice(0, MEETING_TRACKER_LIMITS.name);
}

function normalizeStatus(value) {
  const status = value === undefined ? DELIBERATION_SESSION_STATUS.PLANNED : Number(value);
  if (!Object.values(DELIBERATION_SESSION_STATUS).includes(status)) {
    throw trackerError('Choose a valid session status.', 'meeting_tracker_status_invalid');
  }
  return status;
}

/**
 * Read projection. Attendee resolution is lenient here on purpose: a Board
 * member who left the roster, or a damaged stored map, is reported in
 * `attendeeIssues` and never makes a session unreadable or unsaveable
 * (review finding 1). `attendees` may be supplied by a write path that just
 * resolved strictly; `directory` lets list callers resolve many rows with one
 * directory read.
 */
async function projectSession(row, dependencies, { attendees = null, directory = null } = {}) {
  if (!row) return null;
  const parsed = parseMeetingAttendeeRefsLenient(row.wmkf_attendeerefsjson);
  let resolvedAttendees = attendees;
  const attendeeIssues = parsed.issue ? [parsed.issue] : [];
  if (!resolvedAttendees) {
    if (typeof dependencies.resolveAttendeesLenient === 'function') {
      const lenient = await dependencies.resolveAttendeesLenient(parsed.refs, { directory });
      resolvedAttendees = lenient.attendees;
      attendeeIssues.push(...lenient.issues);
    } else {
      try {
        resolvedAttendees = await dependencies.resolveAttendees(parsed.refs);
      } catch (error) {
        resolvedAttendees = [];
        attendeeIssues.push(error?.message || 'Attendees could not be resolved.');
      }
    }
  }
  return {
    sessionId: row.wmkf_deliberationsessionid,
    etag: row._etag || null,
    scheduledStartIso: row.wmkf_scheduledstart || null,
    scheduledEndIso: row.wmkf_scheduledend || null,
    ianaTimeZone: row.wmkf_ianatimezone || '',
    location: row.wmkf_location || '',
    meetingLink: row.wmkf_meetinglink || '',
    attendeeRefs: parsed.refs.attendees,
    attendees: resolvedAttendees,
    attendeeIssues,
    notes: row.wmkf_notes || '',
    status: row.wmkf_status,
    modifiedAt: row.modifiedon || null,
  };
}

async function normalizedCreate(input, dependencies, { keepAttendeeRefs = null } = {}) {
  const range = normalizeRange(input.scheduledStartIso, input.scheduledEndIso);
  const ianaTimeZone = normalizeText(
    input.ianaTimeZone,
    'ianaTimeZone',
    MEETING_TRACKER_LIMITS.timeZone,
    { required: true },
  );
  if (!validIanaTimeZone(ianaTimeZone)) {
    throw trackerError('Choose a valid IANA time zone.', 'meeting_tracker_timezone_invalid');
  }
  let attendeeState;
  if (keepAttendeeRefs) {
    attendeeState = { refs: keepAttendeeRefs, attendees: null, notice: null };
  } else if (input.attendees === undefined) {
    attendeeState = await dependencies.getDefaultAttendees();
  } else {
    const refs = normalizeMeetingAttendeeRefs({
      version: MEETING_TRACKER_ATTENDEE_REFS_VERSION,
      attendees: input.attendees,
    });
    attendeeState = {
      refs,
      attendees: await dependencies.resolveAttendees(refs),
      notice: null,
    };
  }
  const refsJson = JSON.stringify(attendeeState.refs);
  if (refsJson.length > MEETING_TRACKER_LIMITS.attendeeRefsJson) {
    throw trackerError('The attendee reference map is too large.', 'meeting_tracker_attendee_map_too_large');
  }
  return {
    range,
    ianaTimeZone,
    location: normalizeText(input.location, 'location', MEETING_TRACKER_LIMITS.location),
    meetingLink: validateMeetingLink(input.meetingLink),
    notes: normalizeText(input.notes, 'notes', MEETING_TRACKER_LIMITS.notes),
    status: normalizeStatus(input.status),
    attendeeState,
    refsJson,
  };
}

function createPayload(normalized, actingUserSystemId) {
  return {
    wmkf_name: sessionName(normalized.range.startIso),
    wmkf_scheduledstart: normalized.range.startIso,
    wmkf_scheduledend: normalized.range.endIso,
    wmkf_ianatimezone: normalized.ianaTimeZone,
    wmkf_location: normalized.location || null,
    wmkf_meetinglink: normalized.meetingLink,
    wmkf_attendeerefsjson: normalized.refsJson,
    wmkf_notes: normalized.notes || null,
    wmkf_status: normalized.status,
    'wmkf_UpdatedBy@odata.bind': `/systemusers(${actingUserSystemId})`,
  };
}

export async function createDeliberationSession(
  input,
  { actingUserSystemId = null } = {},
  dependencies = DEFAULT_DEPENDENCIES,
) {
  assertReady(dependencies);
  requireActor(actingUserSystemId);
  const normalized = await normalizedCreate(input || {}, dependencies);
  const body = createPayload(normalized, actingUserSystemId);
  const created = await dependencies.createSession(
    body,
    { actingUserSystemId },
  );
  if (!isGuid(created?.wmkf_deliberationsessionid || '')) {
    throw trackerError('Dataverse did not confirm the created session.', 'meeting_tracker_create_unconfirmed', 502);
  }
  return {
    session: await projectSession({ ...body, ...created }, dependencies, {
      attendees: normalized.attendeeState.attendees,
    }),
    notices: normalized.attendeeState.notice ? [normalized.attendeeState.notice] : [],
  };
}

export async function updateDeliberationSession(
  input,
  { actingUserSystemId = null } = {},
  dependencies = DEFAULT_DEPENDENCIES,
) {
  assertReady(dependencies);
  requireActor(actingUserSystemId);
  const sessionId = String(input?.sessionId || '').trim();
  const etag = String(input?.etag || '').trim();
  if (!isGuid(sessionId)) throw trackerError('A valid sessionId is required.', 'invalid_session_id');
  if (!etag) throw trackerError('The session write fence is required.', 'meeting_tracker_session_etag_required');
  const current = await dependencies.getSession(sessionId);
  if (!current?.wmkf_deliberationsessionid) {
    throw trackerError('Session not found.', 'meeting_tracker_session_not_found', 404);
  }
  const currentParsed = parseMeetingAttendeeRefsLenient(current.wmkf_attendeerefsjson);
  const normalized = await normalizedCreate({
    scheduledStartIso: input.scheduledStartIso ?? current.wmkf_scheduledstart,
    scheduledEndIso: input.scheduledEndIso ?? current.wmkf_scheduledend,
    ianaTimeZone: input.ianaTimeZone ?? current.wmkf_ianatimezone,
    location: input.location ?? current.wmkf_location,
    meetingLink: input.meetingLink ?? current.wmkf_meetinglink,
    notes: input.notes ?? current.wmkf_notes,
    status: input.status ?? current.wmkf_status,
    attendees: input.attendees,
  }, dependencies, {
    // Attendees omitted: carry the stored map through untouched, so a stale
    // reference never blocks an unrelated edit (Zoom link, time, notes).
    keepAttendeeRefs: input.attendees === undefined ? currentParsed.refs : null,
  });
  try {
    await dependencies.updateSession(
      sessionId,
      etag,
      createPayload(normalized, actingUserSystemId),
      { actingUserSystemId },
    );
  } catch (error) {
    if (error?.status === 412) {
      throw trackerError(
        'The session changed while it was being saved. Reload before trying again.',
        'meeting_tracker_session_write_conflict',
        409,
      );
    }
    throw error;
  }
  const saved = await dependencies.getSession(sessionId);
  if (!saved?.wmkf_deliberationsessionid) {
    throw trackerError('The saved session could not be verified.', 'meeting_tracker_save_unconfirmed', 502);
  }
  return {
    session: await projectSession(saved, dependencies, {
      attendees: normalized.attendeeState.attendees || null,
    }),
    notices: [],
  };
}

export async function getDeliberationSession(
  { sessionId },
  dependencies = DEFAULT_DEPENDENCIES,
) {
  assertReady(dependencies);
  if (!isGuid(sessionId || '')) {
    throw trackerError('A valid sessionId is required.', 'invalid_session_id');
  }
  const [row, slots] = await Promise.all([
    dependencies.getSession(sessionId),
    dependencies.findSlotsBySession(sessionId),
  ]);
  if (!row?.wmkf_deliberationsessionid) {
    throw trackerError('Session not found.', 'meeting_tracker_session_not_found', 404);
  }
  const slotRows = slots?.records || [];
  const requestIds = [...new Set(slotRows.map((slot) => String(slot._wmkf_request_value || '').toLowerCase()).filter(Boolean))];
  // One link read per distinct request; a read that fails leaves that slot
  // without a link rather than failing the session page.
  const briefingByRequest = new Map();
  const briefingReads = typeof dependencies.getBriefingLink === 'function'
    ? Promise.all(requestIds.map(async (requestId) => {
      try {
        const link = await dependencies.getBriefingLink(requestId);
        briefingByRequest.set(requestId, link?.url ? { url: link.url, expiresAt: link.expiresAt || null } : null);
      } catch {
        briefingByRequest.set(requestId, null);
      }
    }))
    : Promise.resolve();
  // One bounded request read for the applicant institution; a failed read
  // leaves every slot without an institution rather than failing the page.
  const institutionByRequest = new Map();
  const institutionRead = (typeof dependencies.findRequestsByIds === 'function' && requestIds.length > 0)
    ? dependencies.findRequestsByIds(requestIds, { select: 'akoya_requestid,_akoya_applicantid_value', top: requestIds.length })
      .then((result) => {
        for (const request of result?.records || []) {
          institutionByRequest.set(String(request.akoya_requestid || '').toLowerCase(), requestInstitution(request));
        }
      })
      .catch((error) => {
        console.error('meeting tracker session institution read failed:', error?.message || error);
      })
    : Promise.resolve();
  await Promise.all([briefingReads, institutionRead]);
  return {
    session: await projectSession(row, dependencies),
    slots: slotRows.map((slot) => {
      const key = String(slot._wmkf_request_value || '').toLowerCase();
      return {
        ...slot,
        institution: institutionByRequest.get(key) || null,
        briefing: briefingByRequest.get(key) || null,
      };
    }),
  };
}

export async function listDeliberationSessions(dependencies = DEFAULT_DEPENDENCIES) {
  assertReady(dependencies);
  const result = await dependencies.listSessions();
  const rows = result?.records || [];
  // One directory read for the whole list (review finding 10); a directory
  // failure degrades to empty attendee lists with an issue, never a 500.
  let directory = null;
  if (rows.length && typeof dependencies.getRecipientDirectory === 'function') {
    try { directory = await dependencies.getRecipientDirectory(); } catch { directory = null; }
  }
  const sessions = [];
  for (const row of rows) sessions.push(await projectSession(row, dependencies, { directory }));
  return { sessions };
}

export const MEETING_TRACKER_SESSION_DEPENDENCIES = DEFAULT_DEPENDENCIES;
export const _internal = { createPayload, normalizeRange, normalizedCreate, projectSession };
