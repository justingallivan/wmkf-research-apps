/** @jest-environment node */

jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: jest.fn(async (_label, fn) => fn()),
}));
jest.mock('../../lib/services/reviewer-request-authorization', () => ({
  authorizeReviewerRequestMutation: jest.fn(async () => ({
    requestIds: ['33333333-3333-4333-8333-333333333333'],
  })),
}));
jest.mock('../../lib/services/review-manager/close-review-service', () => ({
  closeReview: jest.fn(),
}));

import handler from '../../pages/api/review-manager/close-review';
import { requireAppAccess } from '../../lib/utils/auth';
import { withDalContext } from '../../lib/dataverse/core/context';
import { authorizeReviewerRequestMutation } from '../../lib/services/reviewer-request-authorization';
import { closeReview } from '../../lib/services/review-manager/close-review-service';

const SUGGESTION = '11111111-1111-4111-8111-111111111111';
const ACTOR = '22222222-2222-4222-8222-222222222222';

function response() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({
    profileId: 7,
    session: { user: { dynamicsSystemuserId: ACTOR } },
  });
  closeReview.mockResolvedValue({
    success: true,
    status: 'closed',
    suggestionId: SUGGESTION,
    disposition: 'eligible',
    completedAt: '2026-09-04T13:00:00.000Z',
  });
});

test('authorizes the session-derived actor and closes inside the DAL context', async () => {
  const req = { method: 'POST', body: { suggestionId: SUGGESTION, disposition: 'eligible' } };
  const res = response();
  await handler(req, res);

  expect(requireAppAccess).toHaveBeenCalledWith(req, res, 'review-manager', 'reviewers');
  expect(withDalContext).toHaveBeenCalledWith('review-manager-close-review', expect.any(Function));
  expect(authorizeReviewerRequestMutation).toHaveBeenCalledWith({
    profileId: 7,
    callerSystemId: ACTOR,
    suggestionIds: [SUGGESTION],
  });
  expect(closeReview).toHaveBeenCalledWith({
    suggestionId: SUGGESTION,
    disposition: 'eligible',
    actingUserSystemId: ACTOR,
    authorizedRequestId: '33333333-3333-4333-8333-333333333333',
  });
  expect(res.statusCode).toBe(200);
});

test.each(['eligible', 'not_eligible', 'not_applicable'])('accepts exact disposition %s', async (disposition) => {
  const res = response();
  await handler({ method: 'POST', body: { suggestionId: SUGGESTION, disposition } }, res);
  expect(closeReview).toHaveBeenCalledWith(expect.objectContaining({ disposition }));
});

test('rejects malformed ids and unknown dispositions before authorization or service work', async () => {
  const badId = response();
  await handler({ method: 'POST', body: { suggestionId: 'bad', disposition: 'eligible' } }, badId);
  expect(badId.statusCode).toBe(400);

  const badDisposition = response();
  await handler({ method: 'POST', body: { suggestionId: SUGGESTION, disposition: 'pay_it' } }, badDisposition);
  expect(badDisposition.statusCode).toBe(400);
  expect(authorizeReviewerRequestMutation).not.toHaveBeenCalled();
  expect(closeReview).not.toHaveBeenCalled();
});

test('auth runs before method dispatch and unsupported methods do no work', async () => {
  const res = response();
  await handler({ method: 'GET', body: {} }, res);
  expect(res.statusCode).toBe(405);
  expect(requireAppAccess).toHaveBeenCalled();
  expect(closeReview).not.toHaveBeenCalled();
});
