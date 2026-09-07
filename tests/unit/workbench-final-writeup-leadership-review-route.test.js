/** @jest-environment node */

jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(),
  getUserRole: jest.fn(),
}));
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: jest.fn((_label, fn) => fn()),
}));
jest.mock('../../lib/services/final-writeup/transition-service', () => ({
  advanceToLeadershipReview: jest.fn(),
}));

import { withDalContext } from '../../lib/dataverse/core/context';
import { advanceToLeadershipReview } from '../../lib/services/final-writeup/transition-service';
import { ServiceHttpError } from '../../lib/services/service-http-error';
import { getUserRole, requireAppAccess } from '../../lib/utils/auth';
import handler from '../../pages/api/workbench/final-writeup/leadership-review';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const FINAL_ID = '22222222-2222-4222-8222-222222222222';
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
  getUserRole.mockResolvedValue('user');
  advanceToLeadershipReview.mockResolvedValue({
    phase: 'leadership-review',
    reused: false,
    artifact: { artifactId: FINAL_ID },
  });
});

test('POST is the only method', async () => {
  const res = mockRes();
  await handler({ method: 'GET', query: { requestId: REQUEST_ID } }, res);
  expect(res.statusCode).toBe(405);
  expect(res.headers.Allow).toBe('POST');
  expect(advanceToLeadershipReview).not.toHaveBeenCalled();
});

test('POST accepts only request and current-Final fences and passes the fresh role', async () => {
  const req = {
    method: 'POST',
    body: { requestId: REQUEST_ID, expectedFinalArtifactId: FINAL_ID },
  };
  const res = mockRes();
  await handler(req, res);

  expect(requireAppAccess).toHaveBeenCalledWith(req, res, 'reviewers');
  expect(getUserRole).toHaveBeenCalledWith(7);
  expect(withDalContext).toHaveBeenCalledWith(
    'workbench-final-writeup-leadership-review',
    expect.any(Function),
  );
  expect(advanceToLeadershipReview).toHaveBeenCalledWith({
    requestId: REQUEST_ID,
    expectedFinalArtifactId: FINAL_ID,
    isSuperuser: false,
    actingUserSystemId: USER_ID,
  });
  expect(res.statusCode).toBe(200);
  expect(res.body).toMatchObject({ success: true, phase: 'leadership-review' });

  const extraKey = mockRes();
  await handler({
    method: 'POST',
    body: { requestId: REQUEST_ID, expectedFinalArtifactId: FINAL_ID, actingUserSystemId: USER_ID },
  }, extraKey);
  expect(extraKey.statusCode).toBe(400);

  const notGuid = mockRes();
  await handler({
    method: 'POST',
    body: { requestId: REQUEST_ID, expectedFinalArtifactId: 'latest' },
  }, notGuid);
  expect(notGuid.statusCode).toBe(400);
  expect(advanceToLeadershipReview).toHaveBeenCalledTimes(1);
});

test('a null profile resolves to superuser without a role lookup', async () => {
  requireAppAccess.mockResolvedValueOnce({
    profileId: null,
    session: { user: { dynamicsSystemuserId: USER_ID } },
  });
  const res = mockRes();
  await handler({
    method: 'POST',
    body: { requestId: REQUEST_ID, expectedFinalArtifactId: FINAL_ID },
  }, res);
  expect(getUserRole).not.toHaveBeenCalled();
  expect(advanceToLeadershipReview).toHaveBeenCalledWith(expect.objectContaining({ isSuperuser: true }));
});

test('service errors pass through with their own status and body', async () => {
  advanceToLeadershipReview.mockRejectedValueOnce(new ServiceHttpError(
    'Only the lead Program Director (or a superuser) can move this writeup to leadership review.',
    {
      httpStatus: 403,
      code: 'final_writeup_leadership_forbidden',
      body: { error: 'forbidden copy', code: 'final_writeup_leadership_forbidden' },
    },
  ));
  const res = mockRes();
  await handler({
    method: 'POST',
    body: { requestId: REQUEST_ID, expectedFinalArtifactId: FINAL_ID },
  }, res);
  expect(res.statusCode).toBe(403);
  expect(res.body).toEqual({ error: 'forbidden copy', code: 'final_writeup_leadership_forbidden' });
});

test('unexpected errors are a bounded 500', async () => {
  advanceToLeadershipReview.mockRejectedValueOnce(new Error('boom'));
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const res = mockRes();
  await handler({
    method: 'POST',
    body: { requestId: REQUEST_ID, expectedFinalArtifactId: FINAL_ID },
  }, res);
  expect(res.statusCode).toBe(500);
  expect(res.body.error).toBe('The leadership review transition failed.');
  spy.mockRestore();
});

test('denied access returns before any service work', async () => {
  requireAppAccess.mockResolvedValueOnce(null);
  const res = mockRes();
  await handler({
    method: 'POST',
    body: { requestId: REQUEST_ID, expectedFinalArtifactId: FINAL_ID },
  }, res);
  expect(advanceToLeadershipReview).not.toHaveBeenCalled();
});
