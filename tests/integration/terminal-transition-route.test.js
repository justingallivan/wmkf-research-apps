/** @jest-environment node */

jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(async () => ({ session: { user: { dynamicsSystemuserId: 'staff-1' } } })),
}));
jest.mock('../../lib/services/reviewer-request-authorization', () => ({
  authorizeReviewerRequestMutation: jest.fn(async () => ({})),
}));
const transitionReviewersTerminal = jest.fn();
jest.mock('../../lib/services/review-manager/terminal-transition-service', () => ({
  transitionReviewersTerminal: (...args) => transitionReviewersTerminal(...args),
}));
const { authorizeReviewerRequestMutation } = require('../../lib/services/reviewer-request-authorization');
const { ServiceHttpError } = require('../../lib/services/service-http-error');

const { createMockReq, createMockRes } = require('../helpers/auth-mock');
const handler = require('../../pages/api/review-manager/terminal-transition').default;

const REQUEST = '11111111-1111-4111-8111-111111111111';
const SUGGESTION = '22222222-2222-4222-8222-222222222222';

beforeEach(() => jest.clearAllMocks());

test('valid partial-success request maps service result to 200', async () => {
  transitionReviewersTerminal.mockResolvedValue({
    ok: true,
    transitioned: 1,
    results: [{ suggestionId: SUGGESTION, status: 'transitioned', terminalStatus: 'withdrew' }],
  });
  const req = createMockReq({
    method: 'POST',
    body: { requestId: REQUEST, suggestionIds: [SUGGESTION], terminalStatus: 'withdrew' },
  });
  const res = createMockRes();
  await handler(req, res);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(authorizeReviewerRequestMutation).toHaveBeenCalledWith({
    profileId: undefined,
    callerSystemId: 'staff-1',
    requestIds: [REQUEST],
    suggestionIds: [SUGGESTION],
  });
});

test('authorization denial prevents the terminal-transition service', async () => {
  authorizeReviewerRequestMutation.mockRejectedValueOnce(new ServiceHttpError('foreign', { httpStatus: 403 }));
  const req = createMockReq({
    method: 'POST',
    body: { requestId: REQUEST, suggestionIds: [SUGGESTION], terminalStatus: 'withdrew' },
  });
  const res = createMockRes();
  await handler(req, res);
  expect(res.status).toHaveBeenCalledWith(403);
  expect(transitionReviewersTerminal).not.toHaveBeenCalled();
});

test('whole-request state conflict returns 409 with per-row reason', async () => {
  const result = { ok: true, transitioned: 0, results: [{ suggestionId: SUGGESTION, status: 'review_received' }] };
  transitionReviewersTerminal.mockResolvedValue(result);
  const req = createMockReq({
    method: 'POST',
    body: { requestId: REQUEST, suggestionIds: [SUGGESTION], terminalStatus: 'released' },
  });
  const res = createMockRes();
  await handler(req, res);
  expect(res.status).toHaveBeenCalledWith(409);
  expect(res.json).toHaveBeenCalledWith(result);
});

test('invalid terminal status fails before service work', async () => {
  const req = createMockReq({
    method: 'POST',
    body: { requestId: REQUEST, suggestionIds: [SUGGESTION], terminalStatus: 'complete' },
  });
  const res = createMockRes();
  await handler(req, res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(transitionReviewersTerminal).not.toHaveBeenCalled();
});
