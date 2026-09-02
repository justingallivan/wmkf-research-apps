/**
 * PATCH /api/review-manager/reviewers + method-dispatch characterization
 * (route-consolidation Stage 2 Phase A envelope inventory).
 *
 * None of the other review-manager-reviewers test files exercise PATCH or the
 * wrong-method branch — this file pins that current behavior: the batch and
 * single-suggestion success envelopes, the batch loop's per-id sequential
 * write semantics, the PATCH domain-error (500) envelope, and the shared
 * method-dispatch 405 for verbs other than GET/PATCH.
 */

import { createMockReq, createMockRes } from '../helpers/auth-mock';
import { requireAppAccess } from '../../lib/utils/auth';
import * as suggestionAdapter from '../../lib/dataverse/adapters/reviewer-suggestion';
import { authorizeReviewerRequestMutation } from '../../lib/services/reviewer-request-authorization';
import { ServiceHttpError } from '../../lib/services/service-http-error';

jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: jest.fn((_label, fn) => fn()),
}));
jest.mock('../../lib/services/reviewer-request-authorization', () => ({
  authorizeReviewerRequestMutation: jest.fn(async () => ({})),
}));
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  updateLifecycle: jest.fn(),
  RESPONSE_TYPE_BY_VALUE: {},
}));

const SUGGESTION_ID = '11111111-1111-1111-1111-111111111111';
const SUGGESTION_ID_2 = '22222222-2222-2222-2222-222222222222';
const ACTING_USER_ID = 'sysuser-guid-1';

let handler;
beforeAll(async () => {
  handler = (await import('../../pages/api/review-manager/reviewers')).default;
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  requireAppAccess.mockResolvedValue({
    session: { user: { azureEmail: 'pd@example.com', dynamicsSystemuserId: ACTING_USER_ID } },
  });
});

afterEach(() => {
  console.error.mockRestore();
});

function call(method, body) {
  const req = createMockReq({ method, body });
  const res = createMockRes();
  return { req, res };
}

test('wrong method (not GET/PATCH) returns 405 with no Allow header set', async () => {
  const { req, res } = call('DELETE');
  await handler(req, res);

  expect(res.statusCode).toBe(405);
  expect(res._data).toEqual({ error: 'Method not allowed' });
  expect(res._headers.Allow).toBeUndefined();
});

test('PATCH single-suggestion success returns the full envelope and forwards actingUserSystemId', async () => {
  suggestionAdapter.updateLifecycle.mockResolvedValue(undefined);
  const { req, res } = call('PATCH', { suggestionId: SUGGESTION_ID, reviewStatus: 'complete', notes: 'looks good' });
  await handler(req, res);

  expect(res.statusCode).toBe(200);
  expect(res._data).toEqual({ success: true, message: 'Reviewer updated' });
  expect(suggestionAdapter.updateLifecycle).toHaveBeenCalledTimes(1);
  expect(suggestionAdapter.updateLifecycle).toHaveBeenCalledWith(
    SUGGESTION_ID,
    { reviewStatus: 'complete', notes: 'looks good' },
    { actingUserSystemId: ACTING_USER_ID },
  );
  expect(authorizeReviewerRequestMutation).toHaveBeenCalledWith({
    profileId: undefined,
    callerSystemId: ACTING_USER_ID,
    suggestionIds: [SUGGESTION_ID],
  });
});

test('PATCH rejects a foreign request before the first lifecycle write', async () => {
  authorizeReviewerRequestMutation.mockRejectedValueOnce(new ServiceHttpError('foreign', { httpStatus: 403 }));
  const { req, res } = call('PATCH', { suggestionIds: [SUGGESTION_ID, SUGGESTION_ID_2], reviewStatus: 'complete' });
  await handler(req, res);
  expect(res.statusCode).toBe(403);
  expect(suggestionAdapter.updateLifecycle).not.toHaveBeenCalled();
});

test('PATCH batch success returns the full envelope and applies the update per-id, sequentially in array order', async () => {
  const callOrder = [];
  suggestionAdapter.updateLifecycle.mockImplementation(async (id) => {
    callOrder.push(id);
  });

  const { req, res } = call('PATCH', { suggestionIds: [SUGGESTION_ID, SUGGESTION_ID_2], reviewStatus: 'complete' });
  await handler(req, res);

  expect(res.statusCode).toBe(200);
  expect(res._data).toEqual({ success: true, message: 'Updated 2 reviewers' });
  // Batch loops with a sequential `for...of await` (not Promise.all) — one
  // updateLifecycle call per id, each awaited before the next starts, in
  // the same order the ids were submitted.
  expect(suggestionAdapter.updateLifecycle).toHaveBeenCalledTimes(2);
  expect(callOrder).toEqual([SUGGESTION_ID, SUGGESTION_ID_2]);
  expect(suggestionAdapter.updateLifecycle).toHaveBeenNthCalledWith(
    1, SUGGESTION_ID, { reviewStatus: 'complete' }, { actingUserSystemId: ACTING_USER_ID },
  );
  expect(suggestionAdapter.updateLifecycle).toHaveBeenNthCalledWith(
    2, SUGGESTION_ID_2, { reviewStatus: 'complete' }, { actingUserSystemId: ACTING_USER_ID },
  );
});

test('PATCH domain error (adapter throw) returns 500 with the failure envelope', async () => {
  suggestionAdapter.updateLifecycle.mockRejectedValue(new Error('Dataverse unavailable'));
  const { req, res } = call('PATCH', { suggestionId: SUGGESTION_ID, reviewStatus: 'complete' });
  await handler(req, res);

  expect(res.statusCode).toBe(500);
  expect(res._data.error).toBe('Failed to update reviewer');
  expect(typeof res._data.timestamp).toBe('string');
  // NODE_ENV is 'test' under jest, not 'development' — details is stripped.
  expect(res._data.details).toBeUndefined();
  expect(console.error).toHaveBeenCalled();
});
