/** @jest-environment node */
jest.mock('../../lib/utils/cron-auth', () => ({ verifyCronSecret: jest.fn(() => true) }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: jest.fn((_name, fn) => fn()) }));
jest.mock('../../lib/services/final-writeup/handoff-email-service', () => ({
  recoverPendingHandoffEmails: jest.fn(),
}));

import { verifyCronSecret } from '../../lib/utils/cron-auth';
import { withDalContext } from '../../lib/dataverse/core/context';
import { recoverPendingHandoffEmails } from '../../lib/services/final-writeup/handoff-email-service';
import handler, { config } from '../../pages/api/cron/final-writeup-handoff-emails.js';

function response() {
  return {
    status: jest.fn(function status(value) { this.statusCode = value; return this; }),
    json: jest.fn(function json(value) { this.body = value; return this; }),
    setHeader: jest.fn(),
  };
}

let errorSpy;
beforeEach(() => {
  jest.clearAllMocks();
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  verifyCronSecret.mockReturnValue(true);
});
afterEach(() => errorSpy.mockRestore());

test('retries a bounded batch in DAL context and returns only counts', async () => {
  recoverPendingHandoffEmails.mockResolvedValue([
    { sourceDocumentId: 'a', status: 'sent' },
    { sourceDocumentId: 'b', status: 'sent' },
    { sourceDocumentId: 'c', status: 'awaiting_transition' },
  ]);
  const res = response();
  await handler({ method: 'GET', query: {}, headers: {} }, res);
  expect(withDalContext).toHaveBeenCalledWith('cron-final-writeup-handoff-emails', expect.any(Function));
  expect(recoverPendingHandoffEmails).toHaveBeenCalledWith({ limit: 25 });
  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({ ok: true, attempted: 3, counts: { sent: 2, awaiting_transition: 1 } });
  expect(config.maxDuration).toBe(300);
});

test('an unauthenticated call does nothing', async () => {
  verifyCronSecret.mockReturnValue(false);
  await handler({ method: 'GET', query: {}, headers: {} }, response());
  expect(recoverPendingHandoffEmails).not.toHaveBeenCalled();
});

test('unsupported methods are rejected before authentication', async () => {
  const res = response();
  await handler({ method: 'DELETE', query: {}, headers: {} }, res);
  expect(res.statusCode).toBe(405);
  expect(verifyCronSecret).not.toHaveBeenCalled();
});

test('a failing pass returns a stable error code', async () => {
  recoverPendingHandoffEmails.mockRejectedValue(Object.assign(new Error('db down'), { code: 'db' }));
  const res = response();
  await handler({ method: 'POST', query: {}, headers: {} }, res);
  expect(res.statusCode).toBe(500);
  expect(res.body).toEqual({
    ok: false, error: 'Group review email retry pass failed.', code: 'final_writeup_handoff_email_retry_failed',
  });
});
