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
