/**
 * @jest-environment node
 */

jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(),
}));
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: jest.fn(async (_label, fn) => fn()),
}));
jest.mock('../../lib/services/reviewer-due-extension', () => ({
  saveReviewerDueDateExtension: jest.fn(),
  retryReviewerDueDateNotification: jest.fn(),
}));

import handler from '../../pages/api/review-manager/review-due-extension';
import { requireAppAccess } from '../../lib/utils/auth';
import { withDalContext } from '../../lib/dataverse/core/context';
import {
  retryReviewerDueDateNotification,
  saveReviewerDueDateExtension,
} from '../../lib/services/reviewer-due-extension';

const SUGGESTION_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';

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
    session: { user: { dynamicsSystemuserId: ACTOR_ID } },
  });
});

test('save validates the selector and dispatches inside the review-manager DAL context', async () => {
  saveReviewerDueDateExtension.mockResolvedValue({
    ok: true,
    saved: true,
    notified: true,
    effectiveReviewDeadline: '2099-09-15',
  });
  const res = response();

  await handler({
    method: 'POST',
    body: { action: 'save', suggestionId: SUGGESTION_ID, reviewDueDateOverride: '2099-09-15' },
  }, res);

  expect(requireAppAccess).toHaveBeenCalledWith(expect.anything(), res, 'review-manager', 'reviewers');
  expect(withDalContext).toHaveBeenCalledWith('review-manager-review-due-extension', expect.any(Function));
  expect(saveReviewerDueDateExtension).toHaveBeenCalledWith({
    suggestionId: SUGGESTION_ID,
    reviewDueDateOverride: '2099-09-15',
    actingUserSystemId: ACTOR_ID,
  });
  expect(res.statusCode).toBe(200);
});

test('partial notification failure returns 502 while preserving saved=true for retry UI', async () => {
  saveReviewerDueDateExtension.mockResolvedValue({
    ok: false,
    saved: true,
    notified: false,
    retryable: true,
    reason: 'send_failed',
  });
  const res = response();

  await handler({
    method: 'POST',
    body: { action: 'save', suggestionId: SUGGESTION_ID, reviewDueDateOverride: '2099-09-15' },
  }, res);

  expect(res.statusCode).toBe(502);
  expect(res.body).toMatchObject({ saved: true, notified: false, retryable: true });
});

test('retry sends from freshly stored state and does not accept a client deadline', async () => {
  retryReviewerDueDateNotification.mockResolvedValue({ ok: true, saved: true, notified: true });
  const res = response();

  await handler({
    method: 'POST',
    body: { action: 'retry', suggestionId: SUGGESTION_ID, reviewDueDateOverride: '1900-01-01' },
  }, res);

  expect(retryReviewerDueDateNotification).toHaveBeenCalledWith({ suggestionId: SUGGESTION_ID });
  expect(saveReviewerDueDateExtension).not.toHaveBeenCalled();
  expect(res.statusCode).toBe(200);
});

test('rejects malformed ids and unknown actions before any service call', async () => {
  const badId = response();
  await handler({ method: 'POST', body: { action: 'save', suggestionId: 'bad', reviewDueDateOverride: null } }, badId);
  expect(badId.statusCode).toBe(400);

  const badAction = response();
  await handler({ method: 'POST', body: { action: 'send', suggestionId: SUGGESTION_ID } }, badAction);
  expect(badAction.statusCode).toBe(400);
  expect(saveReviewerDueDateExtension).not.toHaveBeenCalled();
  expect(retryReviewerDueDateNotification).not.toHaveBeenCalled();
});
