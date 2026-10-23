/**
 * @jest-environment node
 *
 * The withdrawal preview starts from the sending PD's saved wording, so it is
 * limited to the lead PD or a superuser, like the accepted-release preview.
 */
const renderWithdrawPreviews = jest.fn(async () => ({ ok: true, drafts: [] }));
const authorizeReviewerRequestMutation = jest.fn();

jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(async () => ({
    profileId: 'profile-1',
    session: { user: { dynamicsSystemuserId: 'staff-1' } },
  })),
}));
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: jest.fn(async (_source, fn) => fn()),
}));
jest.mock('../../lib/services/review-manager/withdraw-sufficient-service', () => ({
  renderWithdrawPreviews: (...args) => renderWithdrawPreviews(...args),
}));
jest.mock('../../lib/services/reviewer-request-authorization', () => ({
  authorizeReviewerRequestMutation: (...args) => authorizeReviewerRequestMutation(...args),
}));

const { createMockReq, createMockRes } = require('../helpers/auth-mock');
const { ServiceHttpError } = require('../../lib/services/service-http-error');

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const SUGGESTION_ID = 'abcdefab-cdef-4abc-8def-abcdefabcdef';

let handler;
beforeAll(async () => {
  handler = (await import('../../pages/api/review-manager/render-withdraw-emails')).default;
});

beforeEach(() => {
  renderWithdrawPreviews.mockClear();
  authorizeReviewerRequestMutation.mockReset();
});

async function run() {
  const req = createMockReq({ method: 'POST', body: { requestId: REQUEST_ID, suggestionIds: [SUGGESTION_ID] } });
  const res = createMockRes();
  await handler(req, res);
  return res;
}

test('authorizes every target before rendering', async () => {
  authorizeReviewerRequestMutation.mockResolvedValue({});
  const res = await run();
  expect(res.statusCode).toBe(200);
  expect(authorizeReviewerRequestMutation).toHaveBeenCalledWith({
    profileId: 'profile-1',
    callerSystemId: 'staff-1',
    requestIds: [REQUEST_ID],
    suggestionIds: [SUGGESTION_ID],
  });
  expect(renderWithdrawPreviews).toHaveBeenCalledWith({ requestId: REQUEST_ID, suggestionIds: [SUGGESTION_ID] });
});

test('a non-owner gets 403 and no draft (or saved wording) is rendered', async () => {
  authorizeReviewerRequestMutation.mockRejectedValue(new ServiceHttpError(
    'Only the lead Program Director (or a superuser) can manage reviewer activity for this request.',
    { httpStatus: 403 },
  ));
  const res = await run();
  expect(res.statusCode).toBe(403);
  expect(renderWithdrawPreviews).not.toHaveBeenCalled();
});
