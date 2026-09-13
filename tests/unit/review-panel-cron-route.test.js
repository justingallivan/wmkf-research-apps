/** @jest-environment node */

jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: jest.fn(async (_name, fn) => fn()),
}));
jest.mock('../../lib/services/review-panel-worker', () => ({
  drainReviewPanels: jest.fn(async () => ({ claimed: 1 })),
}));
jest.mock('../../lib/services/model-override-loader', () => ({
  loadModelOverrides: jest.fn().mockResolvedValue(undefined),
}));

import { withDalContext } from '../../lib/dataverse/core/context';
import { drainReviewPanels } from '../../lib/services/review-panel-worker';
import { loadModelOverrides } from '../../lib/services/model-override-loader';
import handler from '../../pages/api/cron/drain-review-panels';

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.CRON_SECRET = 'platform-secret';
  process.env.REVIEW_PANEL_ENABLED = 'true';
});

afterEach(() => {
  delete process.env.CRON_SECRET;
  delete process.env.REVIEW_PANEL_ENABLED;
  delete process.env.NODE_ENV;
});

test('requires the platform CRON_SECRET bearer even in development (no dev bypass)', async () => {
  process.env.NODE_ENV = 'development';
  const res = response();
  await handler({ method: 'POST', headers: {} }, res);
  expect(res.statusCode).toBe(401);
  expect(drainReviewPanels).not.toHaveBeenCalled();
});

test('missing platform CRON_SECRET fails closed', async () => {
  delete process.env.CRON_SECRET;
  const res = response();
  await handler({ method: 'POST', headers: {} }, res);
  expect(res.statusCode).toBe(500);
  expect(drainReviewPanels).not.toHaveBeenCalled();
});

test('valid secret warms model overrides and reaches the worker only when enabled', async () => {
  const res = response();
  await handler({ method: 'POST', headers: { authorization: 'Bearer platform-secret' } }, res);
  expect(loadModelOverrides).toHaveBeenCalled();
  expect(withDalContext).toHaveBeenCalledWith('cron-drain-review-panels', expect.any(Function));
  expect(drainReviewPanels).toHaveBeenCalledTimes(1);
  expect(res.body).toEqual({ claimed: 1 });

  process.env.REVIEW_PANEL_ENABLED = 'false';
  const disabled = response();
  await handler({ method: 'POST', headers: { authorization: 'Bearer platform-secret' } }, disabled);
  expect(disabled.body).toEqual({ enabled: false });
  expect(drainReviewPanels).toHaveBeenCalledTimes(1); // still 1 — not called again while disabled
});

test('a worker error is reported as a plain 503, never a raw error message', async () => {
  drainReviewPanels.mockRejectedValueOnce(new Error('boom internal detail'));
  const res = response();
  await handler({ method: 'POST', headers: { authorization: 'Bearer platform-secret' } }, res);
  expect(res.statusCode).toBe(503);
  expect(JSON.stringify(res.body)).not.toContain('boom internal detail');
});

test('rejects a method other than GET/POST', async () => {
  const res = response();
  await handler({ method: 'DELETE', headers: { authorization: 'Bearer platform-secret' } }, res);
  expect(res.statusCode).toBe(405);
  expect(drainReviewPanels).not.toHaveBeenCalled();
});
