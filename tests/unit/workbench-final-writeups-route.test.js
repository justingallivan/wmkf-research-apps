/** @jest-environment node */

jest.mock('../../lib/utils/auth', () => ({
  getUserRole: jest.fn(),
  requireAppAccess: jest.fn(),
}));
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: jest.fn((_label, fn) => fn()),
}));
jest.mock('../../lib/services/final-writeup/dashboard-service', () => ({
  isFinalWriteupCycleSelector: jest.requireActual('../../lib/services/final-writeup/dashboard-service').isFinalWriteupCycleSelector,
  loadFinalWriteupsDashboard: jest.fn(),
}));

import { withDalContext } from '../../lib/dataverse/core/context';
import { loadFinalWriteupsDashboard } from '../../lib/services/final-writeup/dashboard-service';
import { ServiceHttpError } from '../../lib/services/service-http-error';
import { getUserRole, requireAppAccess } from '../../lib/utils/auth';
import handler from '../../pages/api/workbench/final-writeups';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((value) => { res.body = value; return res; });
  res.setHeader = jest.fn((key, value) => { res.headers[key] = value; });
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({
    profileId: 7,
    session: { user: { dynamicsSystemuserId: USER_ID } },
  });
  getUserRole.mockResolvedValue('superuser');
  loadFinalWriteupsDashboard.mockResolvedValue({
    success: true,
    counts: { total: 0, open: 0, history: 0, stewardship: 0 },
    queues: { open: [], history: [], stewardship: [] },
    selected: null,
    navigation: null,
  });
});

test('GET derives viewer identity from the session and accepts only optional requestId', async () => {
  const req = { method: 'GET', query: { requestId: REQUEST_ID } };
  const res = mockRes();
  await handler(req, res);

  expect(requireAppAccess).toHaveBeenCalledWith(req, res, 'reviewers');
  expect(withDalContext).toHaveBeenCalledWith(
    'workbench-final-writeups-dashboard',
    expect.any(Function),
  );
  expect(loadFinalWriteupsDashboard).toHaveBeenCalledWith({
    actingUserSystemId: USER_ID,
    selectedRequestId: REQUEST_ID,
    cycleCode: null,
    isSuperuser: true,
  });
  expect(res.statusCode).toBe(200);

  const invalidKey = mockRes();
  await handler({ method: 'GET', query: { scope: 'all' } }, invalidKey);
  expect(invalidKey.statusCode).toBe(400);
  expect(loadFinalWriteupsDashboard).toHaveBeenCalledTimes(1);
});

test('accepts requestId, a well-formed cycleCode, or the none sentinel, never requestId with cycleCode, and rejects unrecognized keys and malformed codes before service work', async () => {
  const cycle = mockRes();
  await handler({ method: 'GET', query: { cycleCode: ' d26 ' } }, cycle);
  expect(cycle.statusCode).toBe(200);
  expect(loadFinalWriteupsDashboard).toHaveBeenLastCalledWith({
    actingUserSystemId: USER_ID,
    selectedRequestId: null,
    cycleCode: 'd26',
    isSuperuser: true,
  });

  const none = mockRes();
  await handler({ method: 'GET', query: { cycleCode: 'none' } }, none);
  expect(none.statusCode).toBe(200);
  expect(loadFinalWriteupsDashboard).toHaveBeenLastCalledWith(expect.objectContaining({ cycleCode: 'none' }));
  expect(loadFinalWriteupsDashboard).toHaveBeenCalledTimes(2);

  for (const query of [
    { cycleCode: 'X26' },
    { cycleCode: 'NONE' },
    { cycleCode: '2026-12' },
    { cycleCode: ['D26', 'J26'] },
    { requestId: REQUEST_ID, cycleCode: 'D26' },
    { cycleCode: 'D26', scope: 'all' },
  ]) {
    const res = mockRes();
    await handler({ method: 'GET', query }, res);
    expect(res.statusCode).toBe(400);
  }
  expect(loadFinalWriteupsDashboard).toHaveBeenCalledTimes(2);
});

test('ordinary users cannot request the superuser matrix branch', async () => {
  getUserRole.mockResolvedValueOnce('user');
  const res = mockRes();
  await handler({ method: 'GET', query: {} }, res);
  expect(loadFinalWriteupsDashboard).toHaveBeenCalledWith({
    actingUserSystemId: USER_ID,
    selectedRequestId: null,
    cycleCode: null,
    isSuperuser: false,
  });
});

test('rejects malformed request identities and unsupported methods before service work', async () => {
  const invalid = mockRes();
  await handler({ method: 'GET', query: { requestId: 'not-a-guid' } }, invalid);
  expect(invalid.statusCode).toBe(400);
  expect(loadFinalWriteupsDashboard).not.toHaveBeenCalled();

  const repeated = mockRes();
  await handler({ method: 'GET', query: { requestId: [REQUEST_ID, USER_ID] } }, repeated);
  expect(repeated.statusCode).toBe(400);
  expect(loadFinalWriteupsDashboard).not.toHaveBeenCalled();

  const unsupported = mockRes();
  await handler({ method: 'POST', query: {} }, unsupported);
  expect(unsupported.statusCode).toBe(405);
  expect(unsupported.headers.Allow).toBe('GET');
});

test('preserves typed service errors', async () => {
  loadFinalWriteupsDashboard.mockRejectedValueOnce(new ServiceHttpError(
    'Final Writeup review tracking is unavailable.',
    {
      httpStatus: 503,
      code: 'final_writeups_dashboard_schema_not_ready',
      body: {
        error: 'Final Writeup review tracking is unavailable.',
        code: 'final_writeups_dashboard_schema_not_ready',
      },
    },
  ));
  const res = mockRes();
  await handler({ method: 'GET', query: {} }, res);
  expect(res.statusCode).toBe(503);
  expect(res.body.code).toBe('final_writeups_dashboard_schema_not_ready');
});
