/** @jest-environment node */

import { getDeliberationScheduleByRequests } from '../../lib/services/meeting-tracker/schedule-reader';
import { DELIBERATION_SESSION_STATUS } from '../../shared/config/meetingTracker';

const REQUEST_A = '11111111-1111-4111-8111-111111111111';
const REQUEST_B = '22222222-2222-4222-8222-222222222222';
const SESSION_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SESSION_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function slot(requestId, sessionId, start, overrides = {}) {
  return {
    wmkf_deliberationslotid: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    _wmkf_request_value: requestId,
    wmkf_order: 2,
    wmkf_minutes: 15,
    wmkf_Session: {
      wmkf_deliberationsessionid: sessionId,
      wmkf_scheduledstart: start,
      wmkf_scheduledend: new Date(new Date(start).getTime() + 90 * 60000).toISOString(),
      wmkf_ianatimezone: 'America/Los_Angeles',
      wmkf_meetinglink: 'https://zoom.us/j/123',
      wmkf_location: 'Board room',
      wmkf_attendeerefsjson: JSON.stringify({
        version: 1,
        attendees: [{ kind: 'staff', profileId: 7 }],
      }),
      wmkf_status: DELIBERATION_SESSION_STATUS.PLANNED,
      ...overrides,
    },
  };
}

function dependencies(overrides = {}) {
  return {
    schemaReady: jest.fn(() => true),
    findSlotsByRequestIds: jest.fn(async () => ({ records: [] })),
    getRecipientDirectory: jest.fn(async () => ({ staff: [], external: [] })),
    resolveAttendees: jest.fn(async () => [{ name: 'Alex Staff', email: 'alex@example.org' }]),
    ...overrides,
  };
}

test('flag off returns every request as null without a Dataverse or directory call', async () => {
  const deps = dependencies({ schemaReady: jest.fn(() => false) });
  const result = await getDeliberationScheduleByRequests([REQUEST_A, REQUEST_B], deps);

  expect([...result.entries()]).toEqual([[REQUEST_A, null], [REQUEST_B, null]]);
  expect(deps.findSlotsByRequestIds).not.toHaveBeenCalled();
  expect(deps.getRecipientDirectory).not.toHaveBeenCalled();
});

test('the later of two non-cancelled sessions wins for one request', async () => {
  const deps = dependencies({
    findSlotsByRequestIds: jest.fn(async () => ({ records: [
      slot(REQUEST_A, SESSION_A, '2026-09-15T16:00:00.000Z'),
      slot(REQUEST_A, SESSION_B, '2026-09-22T16:00:00.000Z'),
    ] })),
  });
  const result = await getDeliberationScheduleByRequests([REQUEST_A], deps);

  expect(result.get(REQUEST_A)).toEqual({
    sessionId: SESSION_B,
    scheduledStartIso: '2026-09-22T16:00:00.000Z',
    scheduledEndIso: '2026-09-22T17:30:00.000Z',
    ianaTimeZone: 'America/Los_Angeles',
    meetingLink: 'https://zoom.us/j/123',
    location: 'Board room',
    order: 2,
    minutes: 15,
    attendees: [{ name: 'Alex Staff', email: 'alex@example.org' }],
  });
});

test('cancelled sessions are ignored even if an adapter returns them', async () => {
  const deps = dependencies({
    findSlotsByRequestIds: jest.fn(async () => ({ records: [
      slot(REQUEST_A, SESSION_A, '2026-09-15T16:00:00.000Z'),
      slot(REQUEST_A, SESSION_B, '2026-09-29T16:00:00.000Z', {
        wmkf_status: DELIBERATION_SESSION_STATUS.CANCELLED,
      }),
    ] })),
  });
  const result = await getDeliberationScheduleByRequests([REQUEST_A], deps);
  expect(result.get(REQUEST_A).sessionId).toBe(SESSION_A);
});

test('30 request IDs use two reads of at most 25 and preserve all-null omissions', async () => {
  const ids = Array.from({ length: 30 }, (_, index) => (
    `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
  ));
  const deps = dependencies();
  const result = await getDeliberationScheduleByRequests(ids, deps);

  expect(deps.findSlotsByRequestIds).toHaveBeenCalledTimes(2);
  expect(deps.findSlotsByRequestIds.mock.calls[0][0]).toHaveLength(25);
  expect(deps.findSlotsByRequestIds.mock.calls[1][0]).toHaveLength(5);
  expect(result.size).toBe(30);
  expect([...result.values()].every((value) => value === null)).toBe(true);
});

test('an adapter or recipient-resolution failure returns a complete all-null map', async () => {
  const deps = dependencies({
    findSlotsByRequestIds: jest.fn(async () => { throw new Error('Dataverse unavailable'); }),
  });
  const result = await getDeliberationScheduleByRequests([REQUEST_A, REQUEST_B], deps);
  expect([...result.values()]).toEqual([null, null]);
});

// Review finding 2 (S503): attendee failures are isolated per session.
test('a stale attendee reference in one session empties only that session\'s attendees', async () => {
  const deps = dependencies({
    findSlotsByRequestIds: jest.fn(async () => ({ records: [
      slot(REQUEST_A, SESSION_A, '2026-09-16T16:00:00.000Z'),
      slot(REQUEST_B, SESSION_B, '2026-09-17T16:00:00.000Z', { wmkf_attendeerefsjson: 'not json' }),
    ] })),
    resolveAttendees: jest.fn(async (refs) => (refs.attendees.length ? [{ name: 'Alex Staff', email: 'alex@example.org' }] : [])),
  });
  const result = await getDeliberationScheduleByRequests([REQUEST_A, REQUEST_B], deps);
  expect(result.get(REQUEST_A)).toMatchObject({ sessionId: SESSION_A, attendees: [{ name: 'Alex Staff', email: 'alex@example.org' }] });
  expect(result.get(REQUEST_B)).toMatchObject({ sessionId: SESSION_B, attendees: [] });
});

test('a directory outage keeps every schedule entry and only empties attendees', async () => {
  const deps = dependencies({
    findSlotsByRequestIds: jest.fn(async () => ({ records: [slot(REQUEST_A, SESSION_A, '2026-09-16T16:00:00.000Z')] })),
    getRecipientDirectory: jest.fn(async () => { throw new Error('directory down'); }),
  });
  const result = await getDeliberationScheduleByRequests([REQUEST_A], deps);
  expect(result.get(REQUEST_A)).toMatchObject({ sessionId: SESSION_A, attendees: [] });
});
