/**
 * @jest-environment node
 */

import { createMockReq, createMockRes } from '../helpers/auth-mock';
import { verifyCronSecret } from '../../lib/utils/cron-auth';
import { drainReviewSynthesisJobs } from '../../lib/services/review-synthesis-drain';
import MaintenanceService from '../../lib/services/maintenance-service';

jest.mock('../../lib/utils/cron-auth', () => ({
  verifyCronSecret: jest.fn(),
}));
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: jest.fn((_label, fn) => fn()),
}));
jest.mock('../../lib/services/review-synthesis-drain', () => ({
  drainReviewSynthesisJobs: jest.fn(),
}));
jest.mock('../../lib/services/maintenance-service', () => ({
  __esModule: true,
  default: {
    startRun: jest.fn(),
    completeRun: jest.fn(),
  },
}));

let handler;

beforeAll(async () => {
  handler = (await import('../../pages/api/cron/drain-review-syntheses')).default;
});

beforeEach(() => {
  jest.clearAllMocks();
  verifyCronSecret.mockReturnValue(true);
  MaintenanceService.startRun.mockResolvedValue(10);
  MaintenanceService.completeRun.mockResolvedValue();
  drainReviewSynthesisJobs.mockResolvedValue({
    scannedRequests: 4,
    eligible: 1,
    enqueued: 1,
    alreadyTracked: 0,
    claimed: 1,
    completed: 1,
    cancelled: 0,
    failed: 0,
  });
  delete process.env.REVIEW_SYNTHESIS_AUTOMATION_ENABLED;
});

test('is inert by default even for an authenticated cron request', async () => {
  const req = createMockReq({ method: 'GET', query: {} });
  const res = createMockRes();
  await handler(req, res);
  expect(res.statusCode).toBe(200);
  expect(res._data).toEqual({
    ok: true,
    enabled: false,
    reason: 'automation_disabled',
  });
  expect(drainReviewSynthesisJobs).not.toHaveBeenCalled();
  expect(MaintenanceService.startRun).not.toHaveBeenCalled();
});

test('enabled cron clamps inputs, drains under DAL context, and records the run', async () => {
  process.env.REVIEW_SYNTHESIS_AUTOMATION_ENABLED = 'true';
  const req = createMockReq({
    method: 'GET',
    query: { scanLimit: '500', claimLimit: '2', lockSeconds: '30' },
  });
  const res = createMockRes();
  await handler(req, res);
  expect(res.statusCode).toBe(200);
  expect(drainReviewSynthesisJobs).toHaveBeenCalledWith({
    scanLimit: 100,
    claimLimit: 2,
    lockSeconds: 300,
  });
  expect(res._data).toMatchObject({
    ok: true,
    enabled: true,
    claimed: 1,
    completed: 1,
  });
  expect(MaintenanceService.completeRun).toHaveBeenCalledWith(
    10,
    expect.objectContaining({ status: 'completed', recordsProcessed: 1 }),
  );
});

test('rejects an unauthenticated cron before the feature flag check', async () => {
  verifyCronSecret.mockReturnValueOnce(false);
  const req = createMockReq({ method: 'GET', query: {} });
  const res = createMockRes();
  await handler(req, res);
  expect(drainReviewSynthesisJobs).not.toHaveBeenCalled();
  expect(res.status).not.toHaveBeenCalled();
});
