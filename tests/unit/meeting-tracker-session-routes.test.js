/** @jest-environment node */

let mockSchemaReady = true;

jest.mock('../../shared/config/meetingTracker', () => ({
  isMeetingTrackerSchemaReady: jest.fn(() => mockSchemaReady),
}));
jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(),
}));
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: jest.fn((_label, fn) => fn()),
}));
jest.mock('../../lib/services/meeting-tracker/session-service', () => ({
  createDeliberationSession: jest.fn(),
  getDeliberationSession: jest.fn(),
  listDeliberationSessions: jest.fn(),
  updateDeliberationSession: jest.fn(),
}));
jest.mock('../../lib/services/meeting-tracker/slot-service', () => ({
  addDeliberationSlot: jest.fn(),
  moveDeliberationSlot: jest.fn(),
  removeDeliberationSlot: jest.fn(),
  reorderDeliberationSlots: jest.fn(),
  updateDeliberationSlot: jest.fn(),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import {
  createDeliberationSession,
  getDeliberationSession,
} from '../../lib/services/meeting-tracker/session-service';
import {
  addDeliberationSlot,
  moveDeliberationSlot,
  removeDeliberationSlot,
  reorderDeliberationSlots,
  updateDeliberationSlot,
} from '../../lib/services/meeting-tracker/slot-service';
import sessionsHandler from '../../pages/api/meeting-tracker/sessions/index';
import sessionHandler from '../../pages/api/meeting-tracker/sessions/[id]';
import slotsHandler from '../../pages/api/meeting-tracker/slots/index';
import slotHandler from '../../pages/api/meeting-tracker/slots/[id]';
import reorderHandler from '../../pages/api/meeting-tracker/slots/reorder';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const SLOT_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const ACTOR_ID = '44444444-4444-4444-8444-444444444444';
const SPOOFED_ACTOR_ID = '55555555-5555-4555-8555-555555555555';

function mockRes() {
  const res = { statusCode: 200, body: null, headers: {} };
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  res.setHeader = jest.fn((key, value) => { res.headers[key] = value; return res; });
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSchemaReady = true;
  requireAppAccess.mockResolvedValue({
    profileId: 7,
    session: { user: { dynamicsSystemuserId: ACTOR_ID, azureEmail: 'pc@example.org' } },
  });
  createDeliberationSession.mockResolvedValue({ session: { sessionId: SESSION_ID }, notices: [] });
  getDeliberationSession.mockResolvedValue({ session: { sessionId: SESSION_ID }, slots: [] });
  addDeliberationSlot.mockResolvedValue({ slot: { slotId: SLOT_ID }, warning: null });
  updateDeliberationSlot.mockResolvedValue({ slotId: SLOT_ID, warning: null });
  moveDeliberationSlot.mockResolvedValue({ slotId: SLOT_ID, sessionId: SESSION_ID, warning: null });
  removeDeliberationSlot.mockResolvedValue({ removed: true, slotId: SLOT_ID });
  reorderDeliberationSlots.mockResolvedValue({ slots: [] });
});

test('readiness off returns 503 before authentication or a session service call', async () => {
  mockSchemaReady = false;
  const res = mockRes();

  await sessionsHandler({ method: 'GET', query: {} }, res);

  expect(res.statusCode).toBe(503);
  expect(requireAppAccess).not.toHaveBeenCalled();
  expect(getDeliberationSession).not.toHaveBeenCalled();
});

test('invalid session GUID returns 400 before service read', async () => {
  const res = mockRes();

  await sessionHandler({ method: 'GET', query: { id: 'not-a-guid' } }, res);

  expect(res.statusCode).toBe(400);
  expect(requireAppAccess).not.toHaveBeenCalled();
  expect(getDeliberationSession).not.toHaveBeenCalled();
});

test('session create ignores body identity and passes the exact session actor', async () => {
  const res = mockRes();
  const input = {
    scheduledStartIso: '2026-09-14T16:00:00.000Z',
    scheduledEndIso: '2026-09-14T17:00:00.000Z',
    ianaTimeZone: 'America/Chicago',
    meetingLink: 'https://zoom.us/j/123',
    actingUserSystemId: SPOOFED_ACTOR_ID,
  };

  await sessionsHandler({ method: 'POST', query: {}, body: input }, res);

  expect(requireAppAccess).toHaveBeenCalledWith(expect.any(Object), res, 'meeting-tracker');
  expect(createDeliberationSession).toHaveBeenCalledWith({
    scheduledStartIso: input.scheduledStartIso,
    scheduledEndIso: input.scheduledEndIso,
    ianaTimeZone: input.ianaTimeZone,
    meetingLink: input.meetingLink,
  }, { actingUserSystemId: ACTOR_ID });
  expect(res.statusCode).toBe(201);
});

test('slot routes dispatch add, update, move, remove, and full reorder operations', async () => {
  await slotsHandler({
    method: 'POST',
    query: {},
    body: { sessionId: SESSION_ID, requestId: REQUEST_ID, actingUserSystemId: SPOOFED_ACTOR_ID },
  }, mockRes());
  expect(addDeliberationSlot).toHaveBeenCalledWith(
    { sessionId: SESSION_ID, requestId: REQUEST_ID },
    { actingUserSystemId: ACTOR_ID },
  );

  await slotHandler({
    method: 'PATCH', query: { id: SLOT_ID }, body: { etag: 'W/"1"', minutes: 20 },
  }, mockRes());
  expect(updateDeliberationSlot).toHaveBeenCalledWith(
    { slotId: SLOT_ID, etag: 'W/"1"', minutes: 20 },
    { actingUserSystemId: ACTOR_ID },
  );

  await slotHandler({
    method: 'PATCH',
    query: { id: SLOT_ID },
    body: { etag: 'W/"2"', targetSessionId: SESSION_ID, order: 3 },
  }, mockRes());
  expect(moveDeliberationSlot).toHaveBeenCalledWith(
    { slotId: SLOT_ID, etag: 'W/"2"', targetSessionId: SESSION_ID, order: 3 },
    { actingUserSystemId: ACTOR_ID },
  );

  await slotHandler({
    method: 'DELETE', query: { id: SLOT_ID }, body: { etag: 'W/"3"' },
  }, mockRes());
  expect(removeDeliberationSlot).toHaveBeenCalledWith(
    { slotId: SLOT_ID, etag: 'W/"3"' },
    { actingUserSystemId: ACTOR_ID },
  );

  const fullOrder = [
    { slotId: SLOT_ID, etag: 'W/"4"', order: 1 },
    { slotId: REQUEST_ID, etag: 'W/"5"', order: 2 },
  ];
  await reorderHandler({
    method: 'PATCH', query: {}, body: { sessionId: SESSION_ID, slots: fullOrder },
  }, mockRes());
  expect(reorderDeliberationSlots).toHaveBeenCalledWith(
    { sessionId: SESSION_ID, slots: fullOrder },
    { actingUserSystemId: ACTOR_ID },
  );
});

test('unsupported mutation fields are rejected before a service call', async () => {
  const res = mockRes();
  await slotsHandler({
    method: 'POST',
    query: {},
    body: { sessionId: SESSION_ID, requestId: REQUEST_ID, unexpected: true },
  }, res);

  expect(res.statusCode).toBe(400);
  expect(addDeliberationSlot).not.toHaveBeenCalled();
});
