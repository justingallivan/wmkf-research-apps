/**
 * @jest-environment node
 */

jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(),
}));
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: jest.fn((_label, fn) => fn()),
}));
jest.mock('../../lib/services/pre-rp-brief/share-lock-service', () => ({
  lockPreRpBriefForShare: jest.fn(),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import { withDalContext } from '../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../lib/services/service-http-error';
import { lockPreRpBriefForShare } from '../../lib/services/pre-rp-brief/share-lock-service';
import handler from '../../pages/api/workbench/pre-rp-brief/lock-for-share';

const REQUEST_ID = '11111111-1111-1111-1111-111111111111';
const ARTIFACT_ID = '33333333-3333-3333-3333-333333333333';

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  res.setHeader = jest.fn((key, value) => { res.headers[key] = value; });
  return res;
}

function post(body = { requestId: REQUEST_ID, expectedArtifactId: ARTIFACT_ID }) {
  return { method: 'POST', body };
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({
    profileId: '44444444-4444-4444-8444-444444444444',
    session: { user: { dynamicsSystemuserId: '22222222-2222-2222-2222-222222222222' } },
  });
  lockPreRpBriefForShare.mockResolvedValue({
    artifact: { artifactId: ARTIFACT_ID, lifecycleState: 100000001 },
    reused: false,
  });
});

test('rejects methods other than POST before authentication', async () => {
  const res = mockRes();
  await handler({ method: 'GET' }, res);
  expect(res.statusCode).toBe(405);
  expect(res.headers.Allow).toBe('POST');
  expect(requireAppAccess).not.toHaveBeenCalled();
});

test('short-circuits an unauthorized caller before locking', async () => {
  requireAppAccess.mockResolvedValueOnce(null);
  await handler(post(), mockRes());
  expect(lockPreRpBriefForShare).not.toHaveBeenCalled();
});

test.each([
  [null, 'missing body'],
  [{ requestId: REQUEST_ID, expectedArtifactId: ARTIFACT_ID, extra: 'field' }, 'extra field'],
  [{ requestId: 'not-a-guid', expectedArtifactId: ARTIFACT_ID }, 'invalid request id'],
  [{ requestId: REQUEST_ID, expectedArtifactId: 'not-a-guid' }, 'invalid artifact id'],
])('rejects %s (%s) before locking', async (body) => {
  const res = mockRes();
  await handler(post(body), res);
  expect(res.statusCode).toBe(400);
  expect(lockPreRpBriefForShare).not.toHaveBeenCalled();
});

test('locks through the durable service and returns the governed artifact identity', async () => {
  const res = mockRes();
  await handler(post(), res);
  expect(withDalContext).toHaveBeenCalledWith('workbench-pre-rp-brief-lock-for-share', expect.any(Function));
  expect(lockPreRpBriefForShare).toHaveBeenCalledWith({
    requestId: REQUEST_ID,
    expectedArtifactId: ARTIFACT_ID,
    actingUserSystemId: '22222222-2222-2222-2222-222222222222',
  });
  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({
    success: true,
    artifact: { artifactId: ARTIFACT_ID, lifecycleState: 100000001 },
    reused: false,
  });
});

test('maps governed service errors', async () => {
  // The real share-lock-service always sets `body` (its `lockError` helper),
  // so this mirrors that shape rather than the route's bare-message fallback.
  lockPreRpBriefForShare.mockRejectedValueOnce(new ServiceHttpError(
    'The current Pre-RP Brief request pointer requires reconciliation.',
    {
      httpStatus: 409,
      code: 'brief_pointer_invalid',
      body: {
        error: 'The current Pre-RP Brief request pointer requires reconciliation.',
        code: 'brief_pointer_invalid',
      },
    },
  ));
  const res = mockRes();
  await handler(post(), res);
  expect(res.statusCode).toBe(409);
  expect(res.body).toEqual({
    error: 'The current Pre-RP Brief request pointer requires reconciliation.',
    code: 'brief_pointer_invalid',
  });
});
