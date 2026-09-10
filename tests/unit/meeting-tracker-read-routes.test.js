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
jest.mock('../../lib/services/meeting-tracker/dashboard-service', () => ({
  loadMeetingTrackerDashboard: jest.fn(),
}));
jest.mock('../../lib/services/meeting-tracker/attendee-service', () => ({
  loadMeetingTrackerRecipientPicker: jest.fn(),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import { loadMeetingTrackerDashboard } from '../../lib/services/meeting-tracker/dashboard-service';
import { loadMeetingTrackerRecipientPicker } from '../../lib/services/meeting-tracker/attendee-service';
import dashboardHandler from '../../pages/api/meeting-tracker/dashboard';
import recipientsHandler from '../../pages/api/meeting-tracker/recipients';

const ACTOR_ID = '44444444-4444-4444-8444-444444444444';

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
    session: { user: { dynamicsSystemuserId: ACTOR_ID, azureEmail: 'pc/adams@example.org' } },
  });
  loadMeetingTrackerDashboard.mockResolvedValue({ cycles: [] });
  loadMeetingTrackerRecipientPicker.mockResolvedValue({ staff: [], board: [] });
});

test('dashboard returns the grant denial without calling its service', async () => {
  requireAppAccess.mockImplementationOnce(async (_req, res) => {
    res.status(403).json({ error: 'App access required' });
    return null;
  });
  const res = mockRes();

  await dashboardHandler({ method: 'GET', query: {} }, res);

  expect(res.statusCode).toBe(403);
  expect(loadMeetingTrackerDashboard).not.toHaveBeenCalled();
});

test('dashboard passes Workbench-compatible cycle, program, scope, and session identity', async () => {
  const res = mockRes();
  await dashboardHandler({
    method: 'GET',
    query: {
      cycleCode: 'D26',
      programId: '11111111-1111-4111-8111-111111111111',
      scope: 'all',
      includeSetAside: '1',
    },
  }, res);

  expect(loadMeetingTrackerDashboard).toHaveBeenCalledWith({
    azureEmail: 'pc/adams@example.org',
    profileId: 7,
    callerSystemId: ACTOR_ID,
    cycleCode: 'D26',
    scope: 'all',
    includeSetAside: false,
    programId: '11111111-1111-4111-8111-111111111111',
  });
  expect(res.statusCode).toBe(200);
});

test('recipients route is readiness-gated before auth and calls one aggregate service', async () => {
  mockSchemaReady = false;
  const blocked = mockRes();
  await recipientsHandler({ method: 'GET', query: {} }, blocked);
  expect(blocked.statusCode).toBe(503);
  expect(requireAppAccess).not.toHaveBeenCalled();
  expect(loadMeetingTrackerRecipientPicker).not.toHaveBeenCalled();

  mockSchemaReady = true;
  const ready = mockRes();
  await recipientsHandler({ method: 'GET', query: {} }, ready);
  expect(loadMeetingTrackerRecipientPicker).toHaveBeenCalledTimes(1);
  expect(ready.statusCode).toBe(200);
});
