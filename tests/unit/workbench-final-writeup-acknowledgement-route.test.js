/** @jest-environment node */

jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(),
}));
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: jest.fn((_label, fn) => fn()),
}));
jest.mock('../../lib/services/final-writeup/acknowledgement-service', () => ({
  getFinalWriteupAcknowledgementState: jest.fn(),
  markFinalWriteupReviewed: jest.fn(),
}));

import { withDalContext } from '../../lib/dataverse/core/context';
import {
  getFinalWriteupAcknowledgementState,
  markFinalWriteupReviewed,
} from '../../lib/services/final-writeup/acknowledgement-service';
import { ServiceHttpError } from '../../lib/services/service-http-error';
import { requireAppAccess } from '../../lib/utils/auth';
import handler from '../../pages/api/workbench/final-writeup/acknowledgement';

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
  getFinalWriteupAcknowledgementState.mockResolvedValue({
    available: true,
    finalArtifactId: FINAL_ID,
    mayAcknowledge: true,
    personalState: 'unreviewed',
    reviewers: [],
  });
  markFinalWriteupReviewed.mockResolvedValue({
    available: true,
    finalArtifactId: FINAL_ID,
    mayAcknowledge: true,
    personalState: 'reviewed',
    reviewers: [],
  });
});

test('GET reads review state with only the session-derived reviewer identity', async () => {
  const req = { method: 'GET', query: { requestId: REQUEST_ID } };
  const res = mockRes();
  await handler(req, res);

  expect(requireAppAccess).toHaveBeenCalledWith(req, res, 'reviewers');
  expect(withDalContext).toHaveBeenCalledWith(
    'workbench-final-writeup-acknowledgement',
    expect.any(Function),
  );
  expect(getFinalWriteupAcknowledgementState).toHaveBeenCalledWith({
    requestId: REQUEST_ID,
    actingUserSystemId: USER_ID,
  });
  expect(res.statusCode).toBe(200);
  expect(res.body).toMatchObject({ success: true, personalState: 'unreviewed' });
});

test('POST accepts only request and current-Final fences', async () => {
  const req = {
    method: 'POST',
    body: { requestId: REQUEST_ID, expectedFinalArtifactId: FINAL_ID },
  };
  const res = mockRes();
  await handler(req, res);

  expect(markFinalWriteupReviewed).toHaveBeenCalledWith({
    requestId: REQUEST_ID,
    expectedFinalArtifactId: FINAL_ID,
    actingUserSystemId: USER_ID,
  });
  expect(res.statusCode).toBe(200);
  expect(res.body).toMatchObject({ success: true, personalState: 'reviewed' });

  const invalid = mockRes();
  await handler({
    method: 'POST',
    body: {
      requestId: REQUEST_ID,
      expectedFinalArtifactId: FINAL_ID,
      reviewerId: USER_ID,
    },
  }, invalid);
  expect(invalid.statusCode).toBe(400);
  expect(markFinalWriteupReviewed).toHaveBeenCalledTimes(1);
});

test('fails closed when the authenticated session has no Dataverse identity', async () => {
  requireAppAccess.mockResolvedValueOnce({
    profileId: 7,
    session: { user: { dynamicsSystemuserId: null } },
  });
  getFinalWriteupAcknowledgementState.mockRejectedValueOnce(new ServiceHttpError(
    'A resolved staff identity is required to record Final Writeup review.',
    {
      httpStatus: 403,
      code: 'final_writeup_acknowledgement_actor_required',
      body: {
        error: 'A resolved staff identity is required to record Final Writeup review.',
        code: 'final_writeup_acknowledgement_actor_required',
      },
    },
  ));
  const res = mockRes();
  await handler({ method: 'GET', query: { requestId: REQUEST_ID } }, res);
  expect(getFinalWriteupAcknowledgementState).toHaveBeenCalledWith({
    requestId: REQUEST_ID,
    actingUserSystemId: null,
  });
  expect(res.statusCode).toBe(403);
  expect(res.body.code).toBe('final_writeup_acknowledgement_actor_required');
});

test('preserves readiness and conflict errors from the service', async () => {
  getFinalWriteupAcknowledgementState.mockRejectedValueOnce(new ServiceHttpError(
    'Final Writeup review tracking is unavailable.',
    {
      httpStatus: 503,
      code: 'final_writeup_acknowledgement_schema_not_ready',
      body: {
        error: 'Final Writeup review tracking is unavailable.',
        code: 'final_writeup_acknowledgement_schema_not_ready',
      },
    },
  ));
  const unavailable = mockRes();
  await handler({ method: 'GET', query: { requestId: REQUEST_ID } }, unavailable);
  expect(unavailable.statusCode).toBe(503);
  expect(unavailable.body.code).toBe('final_writeup_acknowledgement_schema_not_ready');

  markFinalWriteupReviewed.mockRejectedValueOnce(new ServiceHttpError(
    'A different Final Writeup is now current.',
    {
      httpStatus: 409,
      code: 'final_writeup_acknowledgement_stale_final',
      body: {
        error: 'A different Final Writeup is now current.',
        code: 'final_writeup_acknowledgement_stale_final',
      },
    },
  ));
  const conflict = mockRes();
  await handler({
    method: 'POST',
    body: { requestId: REQUEST_ID, expectedFinalArtifactId: FINAL_ID },
  }, conflict);
  expect(conflict.statusCode).toBe(409);
  expect(conflict.body.code).toBe('final_writeup_acknowledgement_stale_final');
});

test('rejects invalid identities and unsupported methods before service work', async () => {
  const invalid = mockRes();
  await handler({ method: 'GET', query: { requestId: 'not-a-guid' } }, invalid);
  expect(invalid.statusCode).toBe(400);
  expect(getFinalWriteupAcknowledgementState).not.toHaveBeenCalled();

  const unsupported = mockRes();
  await handler({ method: 'DELETE' }, unsupported);
  expect(unsupported.statusCode).toBe(405);
  expect(unsupported.headers.Allow).toBe('GET, POST');
  expect(requireAppAccess).toHaveBeenCalledTimes(1);
});
