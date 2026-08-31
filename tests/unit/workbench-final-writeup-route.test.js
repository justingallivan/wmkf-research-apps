/** @jest-environment node */

jest.mock('../../lib/utils/auth', () => ({
  getUserRole: jest.fn(),
  requireAppAccess: jest.fn(),
}));
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: jest.fn((_label, fn) => fn()),
}));
jest.mock('../../lib/services/final-writeup/transition-service', () => ({
  getFinalWriteupStatus: jest.fn(),
  startFinalWriteup: jest.fn(),
}));

import { getUserRole, requireAppAccess } from '../../lib/utils/auth';
import { withDalContext } from '../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../lib/services/service-http-error';
import {
  getFinalWriteupStatus,
  startFinalWriteup,
} from '../../lib/services/final-writeup/transition-service';
import handler from '../../pages/api/workbench/final-writeup';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';

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
  getUserRole.mockResolvedValue('read_write');
  getFinalWriteupStatus.mockResolvedValue({ available: true, phase: 'ready', canStart: true });
  startFinalWriteup.mockResolvedValue({
    artifact: { artifactId: SOURCE_ID },
    reused: false,
    inProgress: false,
  });
});

test('GET reads status in authenticated DAL context with server-derived identity', async () => {
  const req = { method: 'GET', query: { requestId: REQUEST_ID } };
  const res = mockRes();
  await handler(req, res);

  expect(requireAppAccess).toHaveBeenCalledWith(req, res, 'reviewers');
  expect(withDalContext).toHaveBeenCalledWith('workbench-final-writeup', expect.any(Function));
  expect(getFinalWriteupStatus).toHaveBeenCalledWith({
    requestId: REQUEST_ID,
    isSuperuser: false,
    actingUserSystemId: USER_ID,
  });
  expect(res.statusCode).toBe(200);
  expect(res.body).toMatchObject({ success: true, phase: 'ready' });
});

test('POST accepts only the two transition identities and returns 202 for a live claim', async () => {
  startFinalWriteup.mockResolvedValueOnce({
    artifact: { artifactId: SOURCE_ID },
    reused: true,
    inProgress: true,
  });
  const req = {
    method: 'POST',
    body: { requestId: REQUEST_ID, expectedArtifactId: SOURCE_ID },
  };
  const res = mockRes();
  await handler(req, res);

  expect(startFinalWriteup).toHaveBeenCalledWith({
    requestId: REQUEST_ID,
    expectedArtifactId: SOURCE_ID,
    isSuperuser: false,
    actingUserSystemId: USER_ID,
  });
  expect(res.statusCode).toBe(202);
  expect(res.body).toMatchObject({ success: true, inProgress: true });

  const invalid = mockRes();
  await handler({
    method: 'POST',
    body: { requestId: REQUEST_ID, expectedArtifactId: SOURCE_ID, actingUserSystemId: USER_ID },
  }, invalid);
  expect(invalid.statusCode).toBe(400);
});

test('preserves governed authorization and conflict errors', async () => {
  startFinalWriteup.mockRejectedValueOnce(new ServiceHttpError('Lead PD only.', {
    httpStatus: 403,
    code: 'final_writeup_forbidden',
    body: { error: 'Lead PD only.', code: 'final_writeup_forbidden' },
  }));
  const res = mockRes();
  await handler({
    method: 'POST',
    body: { requestId: REQUEST_ID, expectedArtifactId: SOURCE_ID },
  }, res);
  expect(res.statusCode).toBe(403);
  expect(res.body).toEqual({ error: 'Lead PD only.', code: 'final_writeup_forbidden' });
});

test('rejects unsupported methods before authentication', async () => {
  const res = mockRes();
  await handler({ method: 'DELETE' }, res);
  expect(res.statusCode).toBe(405);
  expect(res.headers.Allow).toBe('GET, POST');
  expect(requireAppAccess).not.toHaveBeenCalled();
});
