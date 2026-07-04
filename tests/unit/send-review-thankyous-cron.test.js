/**
 * /api/cron/send-review-thankyous — cron-secret auth + sweep wiring.
 *
 * Uses the REAL cron-auth so the rejection path is genuinely exercised.
 *
 * @jest-environment node
 */

jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: (_label, fn) => Promise.resolve().then(fn),
}));
const sweepReviewThankYous = jest.fn();
jest.mock('../../lib/services/reviewer-thankyou-sweep', () => ({
  sweepReviewThankYous: (...a) => sweepReviewThankYous(...a),
}));
jest.mock('../../lib/services/maintenance-service', () => ({
  __esModule: true,
  default: {
    startRun: jest.fn(async () => 'run-1'),
    completeRun: jest.fn(async () => {}),
  },
}));

import handler from '../../pages/api/cron/send-review-thankyous';

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  return res;
}

const OLD_ENV = process.env;
beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...OLD_ENV, NODE_ENV: 'production', CRON_SECRET: 'topsecret' };
  sweepReviewThankYous.mockResolvedValue({
    scanned: 0, eligible: 0, sent: 0, skipped: 0, skippedMisconfigured: 0,
    claimFailed: 0, sendFailed: 0, attachmentFailed: 0, errors: [], dryRun: false,
  });
});
afterEach(() => { process.env = OLD_ENV; });

test('rejects with 401 when no bearer secret is present', async () => {
  const res = mockRes();
  await handler({ method: 'GET', query: {}, headers: {} }, res);
  expect(res.statusCode).toBe(401);
  expect(sweepReviewThankYous).not.toHaveBeenCalled();
});

test('rejects with 401 on a wrong bearer secret', async () => {
  const res = mockRes();
  await handler({ method: 'GET', query: {}, headers: { authorization: 'Bearer nope' } }, res);
  expect(res.statusCode).toBe(401);
  expect(sweepReviewThankYous).not.toHaveBeenCalled();
});

test('rejects non-GET/POST methods with 405', async () => {
  const res = mockRes();
  await handler({ method: 'DELETE', query: {}, headers: {} }, res);
  expect(res.statusCode).toBe(405);
  expect(sweepReviewThankYous).not.toHaveBeenCalled();
});

test('runs the sweep with a valid bearer secret and returns its result', async () => {
  const res = mockRes();
  await handler({ method: 'GET', query: { maxBatch: '50', dryRun: '1' }, headers: { authorization: 'Bearer topsecret' } }, res);
  expect(res.statusCode).toBe(200);
  expect(sweepReviewThankYous).toHaveBeenCalledWith({ maxBatch: 50, dryRun: true });
  expect(res.body.ok).toBe(true);
});
