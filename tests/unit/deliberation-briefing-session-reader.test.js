/**
 * The briefing page's session seam reads the Meeting Tracker's §5.4 schedule
 * reader for the one request and stays fail-open (S503 wiring of the seam
 * that returned null unconditionally in S502).
 */
import { getDeliberationSessionForRequest } from '../../lib/services/deliberation-briefing/session-reader';

const REQUEST_ID = 'e43ae6ea-698f-f111-8076-6045bd018a07';
const SCHEDULE = {
  sessionId: 's-1',
  scheduledStartIso: '2026-12-01T18:00:00Z',
  scheduledEndIso: '2026-12-01T18:30:00Z',
  ianaTimeZone: 'America/Los_Angeles',
  meetingLink: 'https://zoom.example/j/1',
  location: '',
  order: 1,
  minutes: 30,
  attendees: [{ name: 'A', email: 'a@example.org' }],
};

test('returns the reader entry for the request, asking for exactly that request', async () => {
  const getScheduleByRequests = jest.fn(async (ids) => new Map(ids.map((id) => [id, SCHEDULE])));
  const session = await getDeliberationSessionForRequest(REQUEST_ID, { getScheduleByRequests });
  expect(getScheduleByRequests).toHaveBeenCalledWith([REQUEST_ID]);
  expect(session).toBe(SCHEDULE);
});

test('null when the reader has no slot for the request (flag off or nothing scheduled)', async () => {
  const getScheduleByRequests = jest.fn(async (ids) => new Map(ids.map((id) => [id, null])));
  await expect(getDeliberationSessionForRequest(REQUEST_ID, { getScheduleByRequests })).resolves.toBeNull();
});

test('null when the reader throws or returns a non-map (fail-open, never fails the briefing)', async () => {
  await expect(getDeliberationSessionForRequest(REQUEST_ID, {
    getScheduleByRequests: jest.fn(async () => { throw new Error('dataverse down'); }),
  })).resolves.toBeNull();
  await expect(getDeliberationSessionForRequest(REQUEST_ID, {
    getScheduleByRequests: jest.fn(async () => undefined),
  })).resolves.toBeNull();
});

test('null for a missing request id without touching the reader', async () => {
  const getScheduleByRequests = jest.fn();
  await expect(getDeliberationSessionForRequest('', { getScheduleByRequests })).resolves.toBeNull();
  expect(getScheduleByRequests).not.toHaveBeenCalled();
});

test('the default dependency is the tracker reader, which is null while the schema flag is unset', async () => {
  const prior = process.env.MEETING_TRACKER_SCHEMA_READY;
  delete process.env.MEETING_TRACKER_SCHEMA_READY;
  try {
    await expect(getDeliberationSessionForRequest(REQUEST_ID)).resolves.toBeNull();
  } finally {
    if (prior !== undefined) process.env.MEETING_TRACKER_SCHEMA_READY = prior;
  }
});
