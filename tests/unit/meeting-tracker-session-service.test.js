/** @jest-environment node */

import {
  createDeliberationSession,
  validateMeetingLink,
} from '../../lib/services/meeting-tracker/session-service';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';

function dependencies(overrides = {}) {
  const attendeeState = {
    refs: { version: 1, attendees: [{ kind: 'staff', profileId: 7 }] },
    attendees: [{ name: 'Alex Staff', email: 'alex@example.org' }],
    notice: null,
  };
  return {
    schemaReady: jest.fn(() => true),
    listSessions: jest.fn(async () => ({ records: [] })),
    getSession: jest.fn(async () => null),
    createSession: jest.fn(async (payload) => ({
      wmkf_deliberationsessionid: SESSION_ID,
      _etag: 'W/"1"',
      ...payload,
    })),
    updateSession: jest.fn(async () => undefined),
    findSlotsBySession: jest.fn(async () => ({ records: [] })),
    getDefaultAttendees: jest.fn(async () => attendeeState),
    resolveAttendees: jest.fn(async () => attendeeState.attendees),
    ...overrides,
  };
}

const input = {
  scheduledStartIso: '2026-09-15T16:00:00.000Z',
  scheduledEndIso: '2026-09-15T17:30:00.000Z',
  ianaTimeZone: 'America/Los_Angeles',
  location: 'Board room',
  meetingLink: 'https://zoom.us/j/123?pwd=CaseSensitive',
  notes: 'Agenda ready',
};

test('session create stores default reference-only attendees and the explicit actor', async () => {
  const deps = dependencies();
  const result = await createDeliberationSession(input, { actingUserSystemId: ACTOR_ID }, deps);

  expect(deps.getDefaultAttendees).toHaveBeenCalledTimes(1);
  expect(deps.createSession).toHaveBeenCalledWith(expect.objectContaining({
    wmkf_scheduledstart: input.scheduledStartIso,
    wmkf_scheduledend: input.scheduledEndIso,
    wmkf_meetinglink: input.meetingLink,
    wmkf_attendeerefsjson: JSON.stringify({
      version: 1,
      attendees: [{ kind: 'staff', profileId: 7 }],
    }),
    'wmkf_UpdatedBy@odata.bind': `/systemusers(${ACTOR_ID})`,
  }), { actingUserSystemId: ACTOR_ID });
  expect(result.session.attendees).toEqual([{ name: 'Alex Staff', email: 'alex@example.org' }]);
});

test('missing defaults remain visible as a notice and do not block creation', async () => {
  const deps = dependencies({
    getDefaultAttendees: jest.fn(async () => ({
      refs: { version: 1, attendees: [] },
      attendees: [],
      notice: 'Default attendees are not configured. Add attendees for this session if needed.',
    })),
  });
  const result = await createDeliberationSession(input, { actingUserSystemId: ACTOR_ID }, deps);

  expect(deps.createSession).toHaveBeenCalledWith(expect.objectContaining({
    wmkf_attendeerefsjson: JSON.stringify({ version: 1, attendees: [] }),
  }), { actingUserSystemId: ACTOR_ID });
  expect(result.notices).toEqual([expect.stringMatching(/not configured/i)]);
});

test('meeting links reject non-HTTPS schemes and preserve valid input exactly', () => {
  expect(() => validateMeetingLink('http://zoom.us/j/123')).toThrow();
  expect(() => validateMeetingLink('javascript:alert(1)')).toThrow();
  expect(validateMeetingLink(input.meetingLink)).toBe(input.meetingLink);
});

// Review finding 1 (S503): a stale or unreadable attendee reference never
// makes a session unreadable or unsaveable.
import {
  getDeliberationSession,
  listDeliberationSessions,
  updateDeliberationSession,
} from '../../lib/services/meeting-tracker/session-service';

function storedRow(overrides = {}) {
  return {
    wmkf_deliberationsessionid: SESSION_ID,
    _etag: 'W/"3"',
    wmkf_scheduledstart: input.scheduledStartIso,
    wmkf_scheduledend: input.scheduledEndIso,
    wmkf_ianatimezone: input.ianaTimeZone,
    wmkf_meetinglink: input.meetingLink,
    wmkf_attendeerefsjson: JSON.stringify({ version: 1, attendees: [{ kind: 'staff', profileId: 7 }, { kind: 'roster', rosterId: 9 }] }),
    wmkf_status: 100000000,
    ...overrides,
  };
}

test('list and get stay readable when one attendee no longer resolves; the issue is reported', async () => {
  const lenient = jest.fn(async () => ({
    attendees: [{ name: 'Alex Staff', email: 'alex@example.org' }],
    issues: ['roster entry 9 is no longer a current Board member.'],
  }));
  const deps = dependencies({
    listSessions: jest.fn(async () => ({ records: [storedRow(), storedRow({ wmkf_deliberationsessionid: '99999999-9999-4999-8999-999999999999', wmkf_attendeerefsjson: 'not json' })] })),
    getSession: jest.fn(async () => storedRow()),
    getRecipientDirectory: jest.fn(async () => ({ staff: [], external: [] })),
    resolveAttendeesLenient: lenient,
    resolveAttendees: jest.fn(async () => { throw new Error('strict resolver must not run on reads'); }),
  });
  const { sessions } = await listDeliberationSessions(deps);
  expect(sessions).toHaveLength(2);
  expect(sessions[0].attendees).toEqual([{ name: 'Alex Staff', email: 'alex@example.org' }]);
  expect(sessions[0].attendeeIssues).toEqual(['roster entry 9 is no longer a current Board member.']);
  expect(sessions[1].attendeeIssues[0]).toMatch(/reference-map version|reconciliation/i);
  expect(sessions[1].attendeeRefs).toEqual([]);
  expect(deps.getRecipientDirectory).toHaveBeenCalledTimes(1);
  const detail = await getDeliberationSession({ sessionId: SESSION_ID }, deps);
  expect(detail.session.attendeeIssues).toHaveLength(1);
});

test('an edit that omits attendees keeps the stored map verbatim and never resolves it strictly', async () => {
  const deps = dependencies({
    getSession: jest.fn(async () => storedRow()),
    resolveAttendees: jest.fn(async () => { throw new Error('strict resolver must not run when attendees are omitted'); }),
    resolveAttendeesLenient: jest.fn(async () => ({ attendees: [], issues: ['roster entry 9 is no longer a current Board member.'] })),
  });
  const result = await updateDeliberationSession(
    { sessionId: SESSION_ID, etag: 'W/"3"', meetingLink: 'https://zoom.us/j/999' },
    { actingUserSystemId: ACTOR_ID },
    deps,
  );
  expect(deps.updateSession).toHaveBeenCalledWith(SESSION_ID, 'W/"3"', expect.objectContaining({
    wmkf_meetinglink: 'https://zoom.us/j/999',
    wmkf_attendeerefsjson: storedRow().wmkf_attendeerefsjson,
  }), { actingUserSystemId: ACTOR_ID });
  expect(result.session.attendeeIssues).toHaveLength(1);
});

test('an unknown session id is a 404, not a 500', async () => {
  const deps = dependencies({ getSession: jest.fn(async () => null) });
  await expect(getDeliberationSession({ sessionId: SESSION_ID }, deps)).rejects.toMatchObject({ httpStatus: 404 });
  await expect(updateDeliberationSession({ sessionId: SESSION_ID, etag: 'W/"1"', notes: 'x' }, { actingUserSystemId: ACTOR_ID }, deps))
    .rejects.toMatchObject({ httpStatus: 404 });
});
