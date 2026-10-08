/** @jest-environment node */
jest.mock('../../lib/utils/cron-auth', () => ({ verifyCronSecret: jest.fn(() => true) }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: jest.fn((_name, fn) => fn()) }));
jest.mock('../../lib/services/final-writeup/leadership-digest-service', () => ({
  runLeadershipDigests: jest.fn(),
}));

import { verifyCronSecret } from '../../lib/utils/cron-auth';
import { withDalContext } from '../../lib/dataverse/core/context';
import { runLeadershipDigests } from '../../lib/services/final-writeup/leadership-digest-service';
import handler, { config } from '../../pages/api/cron/final-writeup-leadership-digest.js';

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

test('runs the digest in DAL context and returns only counts, never recipient identities', async () => {
  runLeadershipDigests.mockResolvedValue({
    status: 'ran',
    digestDay: '2026-10-08',
    results: [
      { recipientSystemUserId: 'a', status: 'sent', count: 2 },
      { recipientSystemUserId: 'b', status: 'nothing_new' },
    ],
  });
  const res = response();
  await handler({ method: 'GET', query: {}, headers: {} }, res);
  expect(withDalContext).toHaveBeenCalledWith('cron-final-writeup-leadership-digest', expect.any(Function));
  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({ ok: true, status: 'ran', digestDay: '2026-10-08', counts: { sent: 1, nothing_new: 1 } });
  expect(config.maxDuration).toBe(300);
});

test('an unauthenticated call does nothing', async () => {
  verifyCronSecret.mockReturnValue(false);
  await handler({ method: 'GET', query: {}, headers: {} }, response());
  expect(runLeadershipDigests).not.toHaveBeenCalled();
});

test('unsupported methods are rejected before authentication', async () => {
  const res = response();
  await handler({ method: 'DELETE', query: {}, headers: {} }, res);
  expect(res.statusCode).toBe(405);
  expect(verifyCronSecret).not.toHaveBeenCalled();
});

test('a failing run returns a stable error code', async () => {
  runLeadershipDigests.mockRejectedValue(Object.assign(new Error('scan'), { code: 'leadership_digest_request_scan_capped' }));
  const res = response();
  await handler({ method: 'POST', query: {}, headers: {} }, res);
  expect(res.statusCode).toBe(500);
  expect(res.body).toEqual({ ok: false, error: 'Leadership digest run failed.', code: 'final_writeup_leadership_digest_failed' });
});
