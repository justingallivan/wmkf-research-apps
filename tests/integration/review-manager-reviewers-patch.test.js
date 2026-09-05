/**
 * Actual reviewer PATCH route + service with mocked authorization/adapter.
 * Pins ordered canonical outcomes and HTTP sanitation; real authorization and
 * real adapter transport composition live in reviewer-engagement-races.test.js.
 */

import { createMockReq, createMockRes } from '../helpers/auth-mock';
import { requireAppAccess } from '../../lib/utils/auth';
import { bypassDynamicsRestrictions } from '../../lib/services/dynamics-context';
import * as suggestionAdapter from '../../lib/dataverse/adapters/reviewer-suggestion';
import { authorizeReviewerRequestMutation } from '../../lib/services/reviewer-request-authorization';
import { ServiceHttpError } from '../../lib/services/service-http-error';
import { REVIEW_STATUS_MAP } from '../../shared/config/reviewerLifecycle';
import { TERMINAL_REVIEW_STATUS_VALUES } from '../../shared/config/reviewerStatus';

jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: jest.fn((_label, fn) => fn()),
}));
jest.mock('../../lib/services/reviewer-request-authorization', () => ({
  authorizeReviewerRequestMutation: jest.fn(),
}));
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  updateLifecycle: jest.fn(),
  RESPONSE_TYPE_BY_VALUE: {},
}));

const IDS = [
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
];
const ACTING_USER_ID = 'sysuser-guid-1';
const initialNodeEnv = process.env.NODE_ENV;
let handler;
beforeAll(async () => {
  handler = (await import('../../pages/api/review-manager/reviewers')).default;
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  requireAppAccess.mockResolvedValue({
    profileId: 42,
    session: { user: { azureEmail: 'pd@example.com', dynamicsSystemuserId: ACTING_USER_ID } },
  });
  authorizeReviewerRequestMutation.mockResolvedValue({});
  suggestionAdapter.updateLifecycle.mockResolvedValue(undefined);
});

afterEach(() => {
  process.env.NODE_ENV = initialNodeEnv;
  console.error.mockRestore();
});

function call(method, body) {
  const req = createMockReq({ method, body });
  const res = createMockRes();
  return { req, res };
}

function success(savedIds, message) {
  return { success: true, message, savedIds, failedIds: [], notAttemptedIds: [] };
}

function expectFailure(res, cause, savedIds, failedIds, notAttemptedIds) {
  expect(res.statusCode).toBe(500);
  expect(res._data).toEqual({
    error: 'Failed to update reviewer',
    details: process.env.NODE_ENV === 'development' ? cause.message : undefined,
    timestamp: expect.any(String),
    success: false, savedIds, failedIds, notAttemptedIds,
  });
  expect(new Date(res._data.timestamp).toISOString()).toBe(res._data.timestamp);
  expect(console.error).toHaveBeenCalledTimes(1);
  expect(console.error).toHaveBeenCalledWith('Review Manager PATCH error:', cause);
}

function expectNoMutation() {
  expect(suggestionAdapter.updateLifecycle).not.toHaveBeenCalled();
}

test('wrong method returns 405 without an Allow header after access guard', async () => {
  const { req, res } = call('DELETE');
  await handler(req, res);
  expect(res.statusCode).toBe(405);
  expect(res._data).toEqual({ error: 'Method not allowed' });
  expect(res._headers.Allow).toBeUndefined();
  expect(requireAppAccess).toHaveBeenCalledWith(req, res, 'review-manager', 'reviewers');
  expectNoMutation();
});

test.each([401, 403])('access denial %i preserves the auth response before context, validation or writes', async httpStatus => {
  requireAppAccess.mockImplementationOnce(async (_req, res) => {
    res.status(httpStatus).json({ error: 'Access denied' });
    return null;
  });
  const { req, res } = call('PATCH', { suggestionIds: ['invalid'] });
  await handler(req, res);
  expect(res.statusCode).toBe(httpStatus);
  expect(res._data).toEqual({ error: 'Access denied' });
  expect(bypassDynamicsRestrictions).not.toHaveBeenCalled();
  expect(authorizeReviewerRequestMutation).not.toHaveBeenCalled();
  expectNoMutation();
});

test('single success preserves submitted identity, session actor and trusted-context ordering', async () => {
  const suggestionId = ` ${IDS[0].toUpperCase()} `;
  const { req, res } = call('PATCH', {
    suggestionId, reviewStatus: 'accepted', actingUserSystemId: 'spoofed', profileId: 999,
    notes: 'ignored unsupported field',
  });
  await handler(req, res);
  expect(res.statusCode).toBe(200);
  expect(res._data).toEqual(success([suggestionId], 'Reviewer updated'));
  expect(suggestionAdapter.updateLifecycle.mock.calls).toEqual([
    [suggestionId, { reviewStatus: 'accepted' }, { actingUserSystemId: ACTING_USER_ID }],
  ]);
  expect(authorizeReviewerRequestMutation).toHaveBeenCalledWith({
    profileId: 42, callerSystemId: ACTING_USER_ID, suggestionIds: [suggestionId],
  });
  expect(bypassDynamicsRestrictions).toHaveBeenCalledWith('review-manager-reviewers', expect.any(Function));
  expect(requireAppAccess.mock.invocationCallOrder[0]).toBeLessThan(bypassDynamicsRestrictions.mock.invocationCallOrder[0]);
  expect(bypassDynamicsRestrictions.mock.invocationCallOrder[0]).toBeLessThan(authorizeReviewerRequestMutation.mock.invocationCallOrder[0]);
  expect(authorizeReviewerRequestMutation.mock.invocationCallOrder[0]).toBeLessThan(suggestionAdapter.updateLifecycle.mock.invocationCallOrder[0]);
});

test('batch returns all confirmed IDs with per-target status and session actor', async () => {
  const { req, res } = call('PATCH', { suggestionIds: IDS, reviewStatus: 'accepted' });
  await handler(req, res);
  expect(res.statusCode).toBe(200);
  expect(res._data).toEqual(success(IDS, 'Updated 3 reviewers'));
  expect(suggestionAdapter.updateLifecycle.mock.calls).toEqual(IDS.map(id => [id, { reviewStatus: 'accepted' }, { actingUserSystemId: ACTING_USER_ID }]));
});

test('batch cannot start any write until the entire authorization promise resolves', async () => {
  let resolveAuthorization;
  authorizeReviewerRequestMutation.mockImplementationOnce(() => new Promise(resolve => { resolveAuthorization = resolve; }));
  const { req, res } = call('PATCH', { suggestionIds: IDS, reviewStatus: 'accepted' });
  const pending = handler(req, res);
  // Enter the access and correlation wrappers before inspecting the suspended gate.
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  expect(authorizeReviewerRequestMutation).toHaveBeenCalledTimes(1);
  expectNoMutation();
  resolveAuthorization({});
  await pending;
  expect(res._data).toEqual(success(IDS, 'Updated 3 reviewers'));
});

test('a suspended first adapter operation blocks later operations and route completion', async () => {
  let resolveFirst;
  suggestionAdapter.updateLifecycle.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }));
  const { req, res } = call('PATCH', { suggestionIds: IDS, reviewStatus: 'accepted' });
  let settled = false;
  const pending = handler(req, res).then(() => { settled = true; });
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  expect(suggestionAdapter.updateLifecycle.mock.calls.map(([id]) => id)).toEqual([IDS[0]]);
  expect(settled).toBe(false);
  resolveFirst();
  await pending;
  expect(res._data).toEqual(success(IDS, 'Updated 3 reviewers'));
});

test.each([0, 1, 2])('adapter failure at index %i returns 500 with exact ordered partitions and never continues', async failureIndex => {
  const cause = new Error('Dataverse unavailable');
  suggestionAdapter.updateLifecycle.mockImplementation(async id => { if (id === IDS[failureIndex]) throw cause; });
  const { req, res } = call('PATCH', { suggestionIds: IDS, reviewStatus: 'accepted' });
  await handler(req, res);
  expectFailure(res, cause, IDS.slice(0, failureIndex), [IDS[failureIndex]], IDS.slice(failureIndex + 1));
  expect(suggestionAdapter.updateLifecycle.mock.calls.map(([id]) => id)).toEqual(IDS.slice(0, failureIndex + 1));
});

test.each(['single', 'one-element batch'])('%s adapter failure reports the single uncertain ID', async form => {
  const cause = new Error('Dataverse unavailable');
  suggestionAdapter.updateLifecycle.mockRejectedValueOnce(cause);
  const body = form === 'single' ? { suggestionId: IDS[0] } : { suggestionIds: [IDS[0]] };
  const { req, res } = call('PATCH', { ...body, reviewStatus: 'accepted' });
  await handler(req, res);
  expectFailure(res, cause, [], [IDS[0]], []);
  expect(suggestionAdapter.updateLifecycle).toHaveBeenCalledTimes(1);
});

test.each([false, true])('trimmed mixed-case duplicates retain first unique order (failure=%s)', async failing => {
  const suggestionIds = [` ${IDS[1].toUpperCase()} `, IDS[0], IDS[1], ` ${IDS[0]} `, IDS[2]];
  const cause = new Error('second unique target failed');
  suggestionAdapter.updateLifecycle.mockImplementation(async id => { if (failing && id === IDS[0]) throw cause; });
  const { req, res } = call('PATCH', { suggestionIds, reviewStatus: 'accepted' });
  await handler(req, res);
  expect(authorizeReviewerRequestMutation).toHaveBeenCalledWith({ profileId: 42, callerSystemId: ACTING_USER_ID, suggestionIds });
  expect(suggestionAdapter.updateLifecycle.mock.calls.map(([id]) => id)).toEqual(failing ? [IDS[1], IDS[0]] : [IDS[1], IDS[0], IDS[2]]);
  if (failing) expectFailure(res, cause, [IDS[1]], [IDS[0]], [IDS[2]]);
  else {
    expect(res.statusCode).toBe(200);
    expect(res._data).toEqual(success([IDS[1], IDS[0], IDS[2]], 'Updated 3 reviewers'));
  }
});

test.each([
  [{}, 'suggestionId, suggestionIds, or proposalId is required'],
  [null, 'suggestionId, suggestionIds, or proposalId is required'],
  [{ suggestionIds: [] }, 'suggestionId, suggestionIds, or proposalId is required'],
  [{ suggestionIds: 'bad' }, 'suggestionId, suggestionIds, or proposalId is required'],
  [{ suggestionIds: ['invalid'] }, 'reviewStatus required for batch update'],
  [{ suggestionIds: IDS }, 'reviewStatus required for batch update'],
  [{ suggestionIds: [IDS[0], IDS[0], 'invalid'], reviewStatus: 'accepted' }, 'suggestionIds must all be valid GUIDs'],
  [{ suggestionIds: [IDS[0], null], reviewStatus: 'accepted' }, 'suggestionIds must all be valid GUIDs'],
  [{ suggestionIds: [IDS[0], 123], reviewStatus: 'accepted' }, 'suggestionIds must all be valid GUIDs'],
  [{ suggestionId: 'invalid', reviewStatus: 'accepted' }, 'suggestionId is not a valid GUID'],
  [{ suggestionId: 123, reviewStatus: 'accepted' }, 'suggestionId is not a valid GUID'],
  [{ suggestionId: IDS[0] }, 'No supported fields to update'],
  [{ suggestionId: IDS[0], notes: 'looks good' }, 'No supported fields to update'],
])('validation preserves exact error-only envelope for %j', async (body, error) => {
  const { req, res } = call('PATCH', body);
  await handler(req, res);
  expect(res.statusCode).toBe(400);
  expect(res._data).toEqual({ error });
  expect(authorizeReviewerRequestMutation).not.toHaveBeenCalled();
  expectNoMutation();
});

test.each([[], null, 'not-an-array', {}])('selector %j with a valid single ID preserves single fallback', async suggestionIds => {
  const { req, res } = call('PATCH', { suggestionIds, suggestionId: IDS[0], reviewStatus: 'accepted' });
  await handler(req, res);
  expect(res.statusCode).toBe(200);
  expect(res._data).toEqual(success([IDS[0]], 'Reviewer updated'));
  expect(authorizeReviewerRequestMutation).toHaveBeenCalledWith({ profileId: 42, callerSystemId: ACTING_USER_ID, suggestionIds: [IDS[0]] });
  expect(suggestionAdapter.updateLifecycle.mock.calls.map(([id]) => id)).toEqual([IDS[0]]);
});

test('a nonempty batch has priority over even an invalid single selector', async () => {
  const { req, res } = call('PATCH', { suggestionIds: [IDS[1]], suggestionId: 'invalid', reviewStatus: 'accepted' });
  await handler(req, res);
  expect(res.statusCode).toBe(200);
  expect(res._data).toEqual(success([IDS[1]], 'Updated 1 reviewers'));
  expect(authorizeReviewerRequestMutation).toHaveBeenCalledWith({ profileId: 42, callerSystemId: ACTING_USER_ID, suggestionIds: [IDS[1]] });
  expect(suggestionAdapter.updateLifecycle.mock.calls.map(([id]) => id)).toEqual([IDS[1]]);
});

describe.each(['single', 'batch', 'empty-array fallback'])('%s dedicated status policy', form => {
  test.each([
    ['complete', 'Complete requires the dedicated reviewer closeout endpoint'],
    [' Complete ', 'Complete requires the dedicated reviewer closeout endpoint'],
    [REVIEW_STATUS_MAP.complete, 'Complete requires the dedicated reviewer closeout endpoint'],
    ['withdrew', 'Terminal reviewer statuses require the dedicated transition endpoint'],
    [' RELEASED ', 'Terminal reviewer statuses require the dedicated transition endpoint'],
    [TERMINAL_REVIEW_STATUS_VALUES.withdrew, 'Terminal reviewer statuses require the dedicated transition endpoint'],
    [TERMINAL_REVIEW_STATUS_VALUES.released, 'Terminal reviewer statuses require the dedicated transition endpoint'],
  ])('rejects %s before writes without outcomes', async (reviewStatus, error) => {
    const body = form === 'batch' ? { suggestionIds: IDS } : { suggestionId: IDS[0], suggestionIds: form === 'empty-array fallback' ? [] : undefined };
    const { req, res } = call('PATCH', { ...body, reviewStatus });
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res._data).toEqual({ error });
    expect(authorizeReviewerRequestMutation).toHaveBeenCalledTimes(1);
    expectNoMutation();
  });
});

test.each([403, 404, 502, 503])('typed authorization denial %i stays error-only before every write', async httpStatus => {
  authorizeReviewerRequestMutation.mockRejectedValueOnce(new ServiceHttpError('ownership rejected', { httpStatus }));
  const { req, res } = call('PATCH', { suggestionIds: IDS, reviewStatus: 'accepted' });
  await handler(req, res);
  expect(res.statusCode).toBe(httpStatus);
  expect(res._data).toEqual({ error: 'ownership rejected' });
  expectNoMutation();
  expect(console.error).not.toHaveBeenCalled();
});

test('typed pre-write custom body remains exact', async () => {
  const body = { error: 'ownership rejected', code: 'denied' };
  authorizeReviewerRequestMutation.mockRejectedValueOnce(new ServiceHttpError('unused', { httpStatus: 403, body }));
  const { req, res } = call('PATCH', { suggestionId: IDS[0], reviewStatus: 'accepted' });
  await handler(req, res);
  expect(res.statusCode).toBe(403);
  expect(res._data).toEqual(body);
  expectNoMutation();
});

test.each(['development', 'production', 'test'])('attempted failure preserves original log/details sanitation in %s', async nodeEnv => {
  process.env.NODE_ENV = nodeEnv;
  const cause = new Error('private Dataverse diagnostic');
  suggestionAdapter.updateLifecycle.mockRejectedValueOnce(cause);
  const { req, res } = call('PATCH', { suggestionId: IDS[0], reviewStatus: 'accepted' });
  await handler(req, res);
  expectFailure(res, cause, [], [IDS[0]], []);
  if (nodeEnv !== 'development') expect(JSON.stringify(res._data)).not.toContain(cause.message);
});

test.each(['development', 'production', 'test'])('unknown pre-write errors retain the old envelope in %s and cannot spoof the wrapper', async nodeEnv => {
  process.env.NODE_ENV = nodeEnv;
  const error = Object.assign(new Error('original unknown failure'), {
    name: 'ReviewerStatusMutationError', cause: new Error('do not unwrap'),
    savedIds: [IDS[0]], failedIds: [IDS[1]], notAttemptedIds: [IDS[2]],
  });
  authorizeReviewerRequestMutation.mockRejectedValueOnce(error);
  const { req, res } = call('PATCH', { suggestionIds: IDS, reviewStatus: 'accepted' });
  await handler(req, res);
  expect(res.statusCode).toBe(500);
  expect(res._data).toEqual({
    error: 'Failed to update reviewer',
    details: nodeEnv === 'development' ? error.message : undefined,
    timestamp: expect.any(String),
  });
  expect(console.error).toHaveBeenCalledWith('Review Manager PATCH error:', error);
  expectNoMutation();
});

test('raw adapter status 412 remains sanitized HTTP 500 with no retry or continuation', async () => {
  const cause = Object.assign(new Error('precondition failed'), { status: 412 });
  suggestionAdapter.updateLifecycle.mockResolvedValueOnce(undefined).mockRejectedValueOnce(cause);
  const { req, res } = call('PATCH', { suggestionIds: IDS, reviewStatus: 'accepted' });
  await handler(req, res);
  expectFailure(res, cause, [IDS[0]], [IDS[1]], [IDS[2]]);
  expect(suggestionAdapter.updateLifecycle.mock.calls.map(([id]) => id)).toEqual(IDS.slice(0, 2));
});

test('a typed error thrown inside the attempted adapter operation is an outcome failure, not a pre-write status', async () => {
  const cause = new ServiceHttpError('adapter rejected input', { httpStatus: 400 });
  suggestionAdapter.updateLifecycle.mockRejectedValueOnce(cause);
  const { req, res } = call('PATCH', { suggestionId: IDS[0], reviewStatus: 'invalid-picklist' });
  await handler(req, res);
  expectFailure(res, cause, [], [IDS[0]], []);
  expect(suggestionAdapter.updateLifecycle).toHaveBeenCalledTimes(1);
});
