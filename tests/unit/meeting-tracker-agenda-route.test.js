/** @jest-environment node */

let mockSchemaReady = true;

jest.mock('../../shared/config/meetingTracker', () => ({
  isMeetingTrackerSchemaReady: jest.fn(() => mockSchemaReady),
}));
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/utils/actor-ref', () => ({ actorRefFromSession: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: jest.fn((_label, fn) => fn()),
}));
jest.mock('../../lib/services/meeting-tracker/agenda-service', () => ({
  getAgendaStatus: jest.fn(),
  prepareAgendaEmail: jest.fn(),
  sendAgendaEmail: jest.fn(),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import { actorRefFromSession } from '../../lib/utils/actor-ref';
import {
  getAgendaStatus,
  prepareAgendaEmail,
  sendAgendaEmail,
} from '../../lib/services/meeting-tracker/agenda-service';
import handler from '../../pages/api/meeting-tracker/sessions/[id]/agenda';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const OPERATION_ID = '22222222-2222-4222-8222-222222222222';
const ACTOR_ID = '33333333-3333-4333-8333-333333333333';

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
  const session = { user: { azureEmail: 'PC@Example.org', dynamicsSystemuserId: ACTOR_ID } };
  requireAppAccess.mockResolvedValue({ session });
  actorRefFromSession.mockReturnValue(ACTOR_ID);
  getAgendaStatus.mockResolvedValue({
    lastAgenda: { operationId: OPERATION_ID, state: 'sent' },
    pendingSend: { operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', state: 'send_requested' },
    scheduleChanged: false,
  });
  prepareAgendaEmail.mockResolvedValue({ agenda: { operationId: OPERATION_ID } });
  sendAgendaEmail.mockResolvedValue({ agenda: { operationId: OPERATION_ID, state: 'sent' } });
});

test('validates the path id before auth and discloses readiness only after auth', async () => {
  const invalid = mockRes();
  await handler({ method: 'GET', query: { id: 'bad' } }, invalid);
  expect(invalid.statusCode).toBe(400);
  expect(requireAppAccess).not.toHaveBeenCalled();

  mockSchemaReady = false;
  const unavailable = mockRes();
  await handler({ method: 'GET', query: { id: SESSION_ID } }, unavailable);
  expect(requireAppAccess).toHaveBeenCalledWith(expect.any(Object), unavailable, 'meeting-tracker');
  expect(unavailable.statusCode).toBe(503);
  expect(getAgendaStatus).not.toHaveBeenCalled();
});

test('GET returns sent and unresolved agenda projections separately', async () => {
  const res = mockRes();
  await handler({ method: 'GET', query: { id: SESSION_ID } }, res);
  expect(getAgendaStatus).toHaveBeenCalledWith({ sessionId: SESSION_ID });
  expect(res.statusCode).toBe(200);
  expect(res.body).toMatchObject({
    lastAgenda: { operationId: OPERATION_ID, state: 'sent' },
    pendingSend: { state: 'send_requested' },
  });
});

test('POST rejects body identity and derives sender identity from the authenticated session', async () => {
  const spoofed = mockRes();
  await handler({
    method: 'POST',
    query: { id: SESSION_ID },
    body: { operationId: OPERATION_ID, to: 'board@example.org', cc: '', subject: 'Agenda', bodyText: 'Message', actingUserSystemId: 'spoofed' },
  }, spoofed);
  expect(spoofed.statusCode).toBe(400);
  expect(prepareAgendaEmail).not.toHaveBeenCalled();

  const body = {
    operationId: OPERATION_ID,
    to: 'board@example.org',
    cc: 'staff@example.org',
    subject: 'Agenda',
    bodyText: 'Message',
  };
  const res = mockRes();
  await handler({ method: 'POST', query: { id: SESSION_ID }, body }, res);
  expect(prepareAgendaEmail).toHaveBeenCalledWith({
    sessionId: SESSION_ID,
    ...body,
    fromEmail: 'pc@example.org',
    actingUserSystemId: ACTOR_ID,
  });
  expect(res.statusCode).toBe(200);
});

test('PATCH sends only the path session and operation through the authenticated actor', async () => {
  const res = mockRes();
  await handler({
    method: 'PATCH', query: { id: SESSION_ID }, body: { operationId: OPERATION_ID },
  }, res);
  expect(sendAgendaEmail).toHaveBeenCalledWith({
    sessionId: SESSION_ID,
    operationId: OPERATION_ID,
    fromEmail: 'pc@example.org',
    actingUserSystemId: ACTOR_ID,
  });
  expect(res.statusCode).toBe(200);
});

test('mutation allowlists fail closed for unknown fields', async () => {
  const res = mockRes();
  await handler({
    method: 'PATCH', query: { id: SESSION_ID }, body: { operationId: OPERATION_ID, sessionId: 'spoofed' },
  }, res);
  expect(res.statusCode).toBe(400);
  expect(sendAgendaEmail).not.toHaveBeenCalled();
});
