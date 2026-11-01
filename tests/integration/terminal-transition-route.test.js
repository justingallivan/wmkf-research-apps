/** @jest-environment node */

jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(async () => ({ session: { user: { dynamicsSystemuserId: 'staff-1' } } })),
}));
jest.mock('../../lib/services/reviewer-request-authorization', () => ({
  authorizeReviewerRequestMutation: jest.fn(async () => ({})),
}));
const transitionReviewersTerminal = jest.fn();
const renderAcceptedReleasePreviews = jest.fn();
jest.mock('../../lib/services/review-manager/terminal-transition-service', () => ({
  transitionReviewersTerminal: (...args) => transitionReviewersTerminal(...args),
  renderAcceptedReleasePreviews: (...args) => renderAcceptedReleasePreviews(...args),
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
    body: {
      requestId: REQUEST,
      suggestionIds: [SUGGESTION],
      terminalStatus: 'released',
      releaseReason: 'sufficient_reviews_received',
      sendEmail: false,
      overrides: { [SUGGESTION]: { expectedNotes: '' } },
    },
  });
  const res = createMockRes();
  await handler(req, res);
  expect(res.status).toHaveBeenCalledWith(409);
  expect(res.json).toHaveBeenCalledWith(result);
});

test('release preview is authorized and delegates without mutation', async () => {
  const result = { ok: true, drafts: [{ suggestionId: SUGGESTION, status: 'ok' }] };
  renderAcceptedReleasePreviews.mockResolvedValue(result);
  const req = createMockReq({
    method: 'POST',
    body: {
      requestId: REQUEST,
      suggestionIds: [SUGGESTION],
      terminalStatus: 'released',
      preview: true,
    },
  });
  const res = createMockRes();
  await handler(req, res);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith(result);
  expect(transitionReviewersTerminal).not.toHaveBeenCalled();
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

describe('staff withdrawal dialog payload', () => {
  async function post(body) {
    transitionReviewersTerminal.mockResolvedValue({ ok: true, transitioned: 1, results: [] });
    const req = createMockReq({ method: 'POST', body: { requestId: REQUEST, suggestionIds: [SUGGESTION], ...body } });
    const res = createMockRes();
    await handler(req, res);
    return res;
  }

  test('a conflict of interest raised by the Foundation reaches the service normalized', async () => {
    const res = await post({ terminalStatus: 'withdrew', withdrawal: { kind: 'coi', endedBy: 'foundation', note: ' Co-author ' } });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(transitionReviewersTerminal.mock.calls[0][0].withdrawal).toEqual({
      reasonPicklist: 'conflict-of-interest',
      reasonText: 'Co-author',
      endedBy: 'foundation',
    });
  });

  test('a withdrawal without a dialog payload keeps the pre-dialog defaults', async () => {
    await post({ terminalStatus: 'withdrew' });
    expect(transitionReviewersTerminal.mock.calls[0][0].withdrawal).toMatchObject({
      reasonPicklist: 'other',
      endedBy: 'reviewer_after_accepting',
    });
  });

  test.each([
    ['unknown kind', { terminalStatus: 'withdrew', withdrawal: { kind: 'fired' } }],
    ['Other without a note', { terminalStatus: 'withdrew', withdrawal: { kind: 'other', endedBy: 'foundation', note: '  ' } }],
    ['client-chosen ended-by outside the allowlist', { terminalStatus: 'withdrew', withdrawal: { kind: 'coi', endedBy: 'reviewer_before_accepting' } }],
    ['withdrawal on did not submit', { terminalStatus: 'did_not_submit', withdrawal: { kind: 'withdrew', reason: 'too-busy' } }],
    ['withdrawal on release', { terminalStatus: 'released', withdrawal: null }],
  ])('%s is a 400 before service work', async (_name, body) => {
    const res = await post(body);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(transitionReviewersTerminal).not.toHaveBeenCalled();
  });
});
