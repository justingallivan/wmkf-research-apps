/**
 * POST /api/review-manager/send-review-reminder discriminator contract.
 */

import { createMockReq, createMockRes } from '../helpers/auth-mock';
import { requireAppAccess } from '../../lib/utils/auth';
import { withDalContext } from '../../lib/dataverse/core/context';
import {
  previewManualRespondReminder,
  sendManualRespondReminder,
  sendManualReviewDueReminder,
} from '../../lib/services/reviewer-manual-reminder';

jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: jest.fn(async (_label, fn) => fn()),
}));
jest.mock('../../lib/services/reviewer-manual-reminder', () => ({
  previewManualRespondReminder: jest.fn(),
  sendManualRespondReminder: jest.fn(),
  sendManualReviewDueReminder: jest.fn(),
}));

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const SUGGESTION_ID = '22222222-2222-4222-8222-222222222222';
const SENDER_ID = '33333333-3333-4333-8333-333333333333';
const REVIEWED = {
  subject: 'Edited subject',
  bodyText: 'Edited body',
  to: 'reviewer@example.org',
  from: 'pd@keck.org',
  senderId: SENDER_ID,
};

let handler;
beforeAll(async () => {
  handler = (await import('../../pages/api/review-manager/send-review-reminder')).default;
});

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ session: { user: { dynamicsSystemuserId: 'user-1' } } });
  previewManualRespondReminder.mockResolvedValue({ ok: true, draft: { subject: 'Preview' } });
  sendManualRespondReminder.mockResolvedValue({ ok: true });
  sendManualReviewDueReminder.mockResolvedValue({ ok: true });
});

function post(body) {
  return {
    req: createMockReq({ method: 'POST', body }),
    res: createMockRes(),
  };
}

test('omitted kind preserves the existing review-due behavior', async () => {
  const { req, res } = post({ requestId: REQUEST_ID, suggestionId: SUGGESTION_ID });
  await handler(req, res);

  expect(sendManualReviewDueReminder).toHaveBeenCalledWith({
    requestId: REQUEST_ID,
    suggestionId: SUGGESTION_ID,
    actingUserSystemId: 'user-1',
  });
  expect(sendManualRespondReminder).not.toHaveBeenCalled();
  expect(res.statusCode).toBe(200);
});

test('respond send dispatches the complete reviewed copy inside the existing DAL context', async () => {
  const { req, res } = post({ requestId: REQUEST_ID, suggestionId: SUGGESTION_ID, kind: 'respond', action: 'send', reviewed: REVIEWED });
  await handler(req, res);

  expect(withDalContext).toHaveBeenCalledWith('review-manager-send-review-reminder', expect.any(Function));
  expect(sendManualRespondReminder).toHaveBeenCalledWith({
    requestId: REQUEST_ID,
    suggestionId: SUGGESTION_ID,
    actingUserSystemId: 'user-1',
    reviewed: REVIEWED,
  });
  expect(sendManualReviewDueReminder).not.toHaveBeenCalled();
  expect(res.statusCode).toBe(200);
});

test('respond preview dispatches read-only rendering and returns the draft', async () => {
  const { req, res } = post({ requestId: REQUEST_ID, suggestionId: SUGGESTION_ID, kind: 'respond', action: 'preview' });
  await handler(req, res);

  expect(previewManualRespondReminder).toHaveBeenCalledWith({
    requestId: REQUEST_ID,
    suggestionId: SUGGESTION_ID,
    actingUserSystemId: 'user-1',
  });
  expect(sendManualRespondReminder).not.toHaveBeenCalled();
  expect(res.statusCode).toBe(200);
  expect(res._data).toEqual({ ok: true, draft: { subject: 'Preview' } });
});

test('respond send without a complete reviewed copy fails closed before the service', async () => {
  const { req, res } = post({ requestId: REQUEST_ID, suggestionId: SUGGESTION_ID, kind: 'respond' });
  await handler(req, res);

  expect(res.statusCode).toBe(400);
  expect(res._data).toEqual({ ok: false, reason: 'invalid_preview' });
  expect(withDalContext).not.toHaveBeenCalled();
});

test.each(['other', '', null, 1])('unknown action %p fails closed', async (action) => {
  const { req, res } = post({ requestId: REQUEST_ID, suggestionId: SUGGESTION_ID, kind: 'respond', action });
  await handler(req, res);

  expect(res.statusCode).toBe(400);
  expect(withDalContext).not.toHaveBeenCalled();
});

test('review-due preview is rejected and does not change the existing send path', async () => {
  const { req, res } = post({ requestId: REQUEST_ID, suggestionId: SUGGESTION_ID, action: 'preview' });
  await handler(req, res);

  expect(res.statusCode).toBe(400);
  expect(previewManualRespondReminder).not.toHaveBeenCalled();
  expect(sendManualReviewDueReminder).not.toHaveBeenCalled();
});

test.each(['other', '', null, 1])('unknown kind %p fails closed before either service', async (kind) => {
  const { req, res } = post({ requestId: REQUEST_ID, suggestionId: SUGGESTION_ID, kind });
  await handler(req, res);

  expect(res.statusCode).toBe(400);
  expect(res._data).toMatchObject({ ok: false, reason: 'validation' });
  expect(withDalContext).not.toHaveBeenCalled();
  expect(sendManualRespondReminder).not.toHaveBeenCalled();
  expect(sendManualReviewDueReminder).not.toHaveBeenCalled();
});

test.each(['removed', 'revoked', 'conflict'])('%s refusal remains a typed 409 response', async (reason) => {
  sendManualRespondReminder.mockResolvedValueOnce({ ok: false, reason });
  const { req, res } = post({ requestId: REQUEST_ID, suggestionId: SUGGESTION_ID, kind: 'respond', reviewed: REVIEWED });
  await handler(req, res);

  expect(res.statusCode).toBe(409);
  expect(res._data).toMatchObject({ ok: false, reason });
});

test.each([
  'token_revoked',
  'token_not_minted',
  'token_invalid_data',
  'token_expired',
  'token_insufficient_window',
  'due_date_missing',
])('%s liveness refusal is a typed 409 response', async (reason) => {
  sendManualReviewDueReminder.mockResolvedValueOnce({ ok: false, reason });
  const { req, res } = post({ requestId: REQUEST_ID, suggestionId: SUGGESTION_ID });
  await handler(req, res);

  expect(res.statusCode).toBe(409);
  expect(res._data).toMatchObject({ ok: false, reason });
});

test.each(['read_failed', 'prepare_failed', 'send_failed'])('%s remains a typed 502 response', async (reason) => {
  sendManualRespondReminder.mockResolvedValueOnce({ ok: false, reason });
  const { req, res } = post({ requestId: REQUEST_ID, suggestionId: SUGGESTION_ID, kind: 'respond', reviewed: REVIEWED });
  await handler(req, res);

  expect(res.statusCode).toBe(502);
  expect(res._data).toMatchObject({ ok: false, reason });
});
