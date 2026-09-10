/**
 * Shared Meeting Tracker schema constants.
 *
 * Keep status values in lockstep with Wave 28. Runtime readers and writers must
 * stay disabled unless MEETING_TRACKER_SCHEMA_READY is the literal string on.
 */

export const MEETING_TRACKER_SCHEMA_READY_FLAG = 'MEETING_TRACKER_SCHEMA_READY';

export function isMeetingTrackerSchemaReady(env = process.env) {
  return env?.[MEETING_TRACKER_SCHEMA_READY_FLAG] === 'on';
}

export const DELIBERATION_SESSION_STATUS = Object.freeze({
  PLANNED: 100000000,
  HELD: 100000001,
  CANCELLED: 100000002,
});

export const DELIBERATION_SESSION_STATUS_LABEL = Object.freeze({
  [DELIBERATION_SESSION_STATUS.PLANNED]: 'Planned',
  [DELIBERATION_SESSION_STATUS.HELD]: 'Held',
  [DELIBERATION_SESSION_STATUS.CANCELLED]: 'Cancelled',
});

export const MEETING_TRACKER_DEFAULTS = Object.freeze({
  sessionMinutes: 90,
  slotMinutes: 15,
});

export const MEETING_TRACKER_ENTITY_SETS = Object.freeze({
  sessions: 'wmkf_deliberationsessions',
  slots: 'wmkf_deliberationslots',
});

export const MEETING_TRACKER_DEFAULT_ATTENDEES_SETTING = 'meeting_tracker.default_attendees';
export const MEETING_TRACKER_ATTENDEE_REFS_VERSION = 1;

export const MEETING_TRACKER_LIMITS = Object.freeze({
  name: 200,
  timeZone: 100,
  location: 2000,
  meetingLink: 1000,
  attendeeRefsJson: 32000,
  attendees: 100,
  notes: 10000,
  slotOrder: 1000,
  slotMinutes: 1440,
});
