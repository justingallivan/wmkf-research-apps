/**
 * POST /api/review-manager/send-review-reminder discriminator contract.
 */

import { createMockReq, createMockRes } from '../helpers/auth-mock';
import { requireAppAccess } from '../../lib/utils/auth';
import { withDalContext } from '../../lib/dataverse/core/context';
import {
  sendManualRespondReminder,
  sendManualReviewDueReminder,
} from '../../lib/services/reviewer-manual-reminder';

jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: jest.fn(async (_label, fn) => fn()),
}));
jest.mock('../../lib/services/reviewer-manual-reminder', () => ({
  sendManualRespondReminder: jest.fn(),
  sendManualReviewDueReminder: jest.fn(),
}));

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const SUGGESTION_ID = '22222222-2222-4222-8222-222222222222';

let handler;
beforeAll(async () => {
  handler = (await import('../../pages/api/review-manager/send-review-reminder')).default;
});

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ session: { user: { dynamicsSystemuserId: 'user-1' } } });
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

test('respond kind dispatches the respond reminder inside the existing DAL context', async () => {
  const { req, res } = post({ requestId: REQUEST_ID, suggestionId: SUGGESTION_ID, kind: 'respond' });
  await handler(req, res);

  expect(withDalContext).toHaveBeenCalledWith('review-manager-send-review-reminder', expect.any(Function));
  expect(sendManualRespondReminder).toHaveBeenCalledWith({
    requestId: REQUEST_ID,
    suggestionId: SUGGESTION_ID,
    actingUserSystemId: 'user-1',
  });
  expect(sendManualReviewDueReminder).not.toHaveBeenCalled();
  expect(res.statusCode).toBe(200);
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
  const { req, res } = post({ requestId: REQUEST_ID, suggestionId: SUGGESTION_ID, kind: 'respond' });
  await handler(req, res);

  expect(res.statusCode).toBe(409);
  expect(res._data).toMatchObject({ ok: false, reason });
});

test.each(['read_failed', 'prepare_failed', 'send_failed'])('%s remains a typed 502 response', async (reason) => {
  sendManualRespondReminder.mockResolvedValueOnce({ ok: false, reason });
  const { req, res } = post({ requestId: REQUEST_ID, suggestionId: SUGGESTION_ID, kind: 'respond' });
  await handler(req, res);

  expect(res.statusCode).toBe(502);
  expect(res._data).toMatchObject({ ok: false, reason });
});
