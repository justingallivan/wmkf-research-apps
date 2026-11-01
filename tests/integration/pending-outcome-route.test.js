/** @jest-environment node */

jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(async () => ({ profileId: 7, session: { user: { dynamicsSystemuserId: 'staff-1' } } })),
}));
jest.mock('../../lib/services/reviewer-request-authorization', () => ({
  authorizeReviewerRequestMutation: jest.fn(async () => ({})),
}));
const recordPendingOutcome = jest.fn();
jest.mock('../../lib/services/reviewer-engagement/record-pending-outcome', () => ({
  recordPendingOutcome: (...args) => recordPendingOutcome(...args),
}));
const { authorizeReviewerRequestMutation } = require('../../lib/services/reviewer-request-authorization');
const { ServiceHttpError } = require('../../lib/services/service-http-error');
const { createMockReq, createMockRes } = require('../helpers/auth-mock');
const handler = require('../../pages/api/review-manager/pending-outcome').default;

const REQUEST = '11111111-1111-4111-8111-111111111111';
const SUGGESTION = '22222222-2222-4222-8222-222222222222';

async function post(body, method = 'POST') {
  const req = createMockReq({ method, body });
  const res = createMockRes();
  await handler(req, res);
  return res;
}

const valid = { requestId: REQUEST, suggestionId: SUGGESTION, outcome: { kind: 'coi', endedBy: 'foundation', note: ' Co-author ' } };

beforeEach(() => {
  jest.clearAllMocks();
  recordPendingOutcome.mockResolvedValue({ status: 'recorded' });
});

test('authorizes the request and row, then passes the normalized outcome', async () => {
  const res = await post(valid);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(authorizeReviewerRequestMutation).toHaveBeenCalledWith({
    profileId: 7,
    callerSystemId: expect.anything(),
    requestIds: [REQUEST],
    suggestionIds: [SUGGESTION],
  });
  expect(recordPendingOutcome).toHaveBeenCalledWith(expect.objectContaining({
    requestId: REQUEST,
    suggestionId: SUGGESTION,
    outcome: { reasonPicklist: 'conflict-of-interest', reasonText: 'Co-author', endedBy: 'foundation' },
  }));
});

test.each([
  ['not_found', 404],
  ['not_pending', 409],
  ['wrong_request', 409],
  ['changed_skipped', 409],
  ['honorarium_linked', 409],
])('service status %s maps to %i', async (status, http) => {
  recordPendingOutcome.mockResolvedValue({ status });
  const res = await post(valid);
  expect(res.status).toHaveBeenCalledWith(http);
  expect(res.json).toHaveBeenCalledWith({ status });
});

test.each([
  ['a non-GUID request', { ...valid, requestId: 'R-1' }],
  ['a non-GUID suggestion', { ...valid, suggestionId: "x' or 1 eq 1" }],
  ['no outcome', { requestId: REQUEST, suggestionId: SUGGESTION }],
  ['Other without a note', { ...valid, outcome: { kind: 'other', endedBy: 'foundation' } }],
  ['an after-accepting ended-by', { ...valid, outcome: { kind: 'coi', endedBy: 'reviewer_after_accepting' } }],
])('%s is a 400 before authorization or service work', async (_name, body) => {
  const res = await post(body);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(authorizeReviewerRequestMutation).not.toHaveBeenCalled();
  expect(recordPendingOutcome).not.toHaveBeenCalled();
});

test('authorization denial prevents the service', async () => {
  authorizeReviewerRequestMutation.mockRejectedValueOnce(new ServiceHttpError('foreign', { httpStatus: 403 }));
  const res = await post(valid);
  expect(res.status).toHaveBeenCalledWith(403);
  expect(recordPendingOutcome).not.toHaveBeenCalled();
});

test('an unexpected error returns a fixed message, not the upstream text', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  recordPendingOutcome.mockRejectedValue(new Error('[dataverse-interlock] denied host.example'));
  const res = await post(valid);
  expect(res.status).toHaveBeenCalledWith(500);
  expect(res.json).toHaveBeenCalledWith({ error: 'Failed to record the reviewer outcome' });
});

test('GET is 405', async () => {
  const res = await post(undefined, 'GET');
  expect(res.status).toHaveBeenCalledWith(405);
});
