/**
 * Integration-ish coverage for the daily maintenance cron handler's wiring of
 * the maintenance_runs retention step (eval #3 follow-up). The service method
 * is unit-tested in maintenance-cleanup-maintenance-runs.test.js; this asserts
 * the cron step is actually wired: its count contributes to totalDeleted, and
 * a failure surfaces via the failedSubtasks mechanism + marks the run failed.
 * (Codex flagged the wiring as otherwise untested.)
 *
 * @jest-environment node
 */

jest.mock('../../lib/utils/cron-auth', () => ({ verifyCronSecret: jest.fn(() => true) }));
jest.mock('../../lib/services/alert-service', () => ({
  __esModule: true,
  default: { cleanupOldAlerts: jest.fn(async () => 0) },
}));
jest.mock('../../lib/services/feedback-service', () => ({
  __esModule: true,
  default: { cleanupOldFeedback: jest.fn(async () => 0) },
}));
jest.mock('../../lib/services/notification-service', () => ({
  __esModule: true,
  default: { notify: jest.fn(async () => {}) },
}));
jest.mock('../../lib/services/review-draft-service', () => ({
  deleteExpired: jest.fn(async () => 0),
}));
jest.mock('../../lib/services/maintenance-service', () => ({
  __esModule: true,
  default: {
    startRun: jest.fn(async () => 1),
    completeRun: jest.fn(async () => {}),
    getRetentionConfig: jest.fn(async () => ({
      usage_log_days: 90, query_log_days: 365, blob_days: 90,
      health_history_days: 30, alert_days: 90, intake_audit_days: 730,
      bill_webhook_events_days: 7, maintenance_runs_days: 90,
      reviewer_identity_shadow_log_days: 90,
    })),
    cleanupUsageLog: jest.fn(async () => 0),
    cleanupQueryLog: jest.fn(async () => 0),
    cleanupReviewerIdentityShadowLog: jest.fn(async () => 0),
    cleanupOperationalEvents: jest.fn(async () => 0),
    cleanupExpiredCache: jest.fn(async () => 0),
    cleanupHealthHistory: jest.fn(async () => 0),
    cleanupIntakeAudit: jest.fn(async () => 0),
    cleanupBillWebhookEvents: jest.fn(async () => 0),
    cleanupMaintenanceRuns: jest.fn(async () => 0),
    sweepBillOnboarding: jest.fn(async () => ({ resumed: 0, scanned: 0, errors: 0, failedClosed: 0 })),
    cleanupBillOnboardingState: jest.fn(async () => 0),
    sweepIntakePending: jest.fn(async () => ({ deleted: 0 })),
    cleanupBlobs: jest.fn(async () => ({ deleted: 0, skipped: 0, errors: 0, details: [] })),
    cleanupIntakePrivateBlobs: jest.fn(async () => ({ deleted: 0 })),
  },
}));

import handler from '../../pages/api/cron/maintenance';
import MaintenanceService from '../../lib/services/maintenance-service';
import FeedbackService from '../../lib/services/feedback-service';

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; return this; },
  };
}

beforeEach(() => { jest.clearAllMocks(); });

describe('maintenance cron — maintenance_runs retention step wiring', () => {
  it('runs Dynamics feedback cleanup with the fixed 20-day ACK retention', async () => {
    FeedbackService.cleanupOldFeedback.mockResolvedValueOnce(5);
    const res = makeRes();
    await handler({ method: 'POST', headers: {} }, res);

    expect(FeedbackService.cleanupOldFeedback).toHaveBeenCalledWith(20);
    expect(res.body.results.feedback).toBe(5);
    expect(res.body.totalDeleted).toBe(5);
  });

  it('reports Dynamics feedback cleanup failure instead of false zero-deletion success', async () => {
    FeedbackService.cleanupOldFeedback.mockRejectedValueOnce(new Error('feedback delete failed'));
    const res = makeRes();
    await handler({ method: 'POST', headers: {} }, res);

    expect(res.body.ok).toBe(false);
    expect(res.body.results.feedback).toEqual({ error: 'feedback delete failed' });
    expect(res.body.failedSubtasks).toContain('feedback');
    expect(MaintenanceService.completeRun).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ status: 'failed' }),
    );
  });

  it('runs reviewer identity shadow retention and folds its count into totalDeleted', async () => {
    MaintenanceService.cleanupReviewerIdentityShadowLog.mockResolvedValueOnce(6);
    const res = makeRes();
    await handler({ method: 'POST', headers: {} }, res);

    expect(MaintenanceService.cleanupReviewerIdentityShadowLog).toHaveBeenCalledWith(90);
    expect(res.statusCode).toBe(200);
    expect(res.body.results.reviewerIdentityShadowLog).toBe(6);
    expect(res.body.totalDeleted).toBe(6);
    expect(res.body.failedSubtasks).not.toContain('reviewerIdentityShadowLog');
  });

  it('surfaces reviewer identity shadow cleanup failure without skipping later steps', async () => {
    MaintenanceService.cleanupReviewerIdentityShadowLog
      .mockRejectedValueOnce(new Error('shadow cleanup failed'));
    const res = makeRes();
    await handler({ method: 'POST', headers: {} }, res);

    expect(res.body.ok).toBe(false);
    expect(res.body.results.reviewerIdentityShadowLog)
      .toEqual({ error: 'shadow cleanup failed' });
    expect(res.body.failedSubtasks).toContain('reviewerIdentityShadowLog');
    expect(MaintenanceService.cleanupExpiredCache).toHaveBeenCalled();
  });

  it('passes the configured retention and folds the deleted count into totalDeleted', async () => {
    MaintenanceService.cleanupMaintenanceRuns.mockResolvedValueOnce(17);
    const res = makeRes();
    await handler({ method: 'POST', headers: {} }, res);

    expect(MaintenanceService.cleanupMaintenanceRuns).toHaveBeenCalledWith(90);
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.results.maintenanceRuns).toBe(17);
    // All other steps return 0 here, so totalDeleted is exactly this step's count.
    expect(res.body.totalDeleted).toBe(17);
    expect(res.body.failedSubtasks).not.toContain('maintenanceRuns');
  });

  it('wires the reviewer review-draft GC step (90d) into the run and totalDeleted', async () => {
    const ReviewDraftService = require('../../lib/services/review-draft-service');
    ReviewDraftService.deleteExpired.mockResolvedValueOnce(4);
    const res = makeRes();
    await handler({ method: 'POST', headers: {} }, res);

    expect(ReviewDraftService.deleteExpired).toHaveBeenCalledWith({ olderThanDays: 90 });
    expect(res.body.ok).toBe(true);
    expect(res.body.results.reviewDrafts).toBe(4);
    // All other steps return 0 here, so the GC count is folded into totalDeleted.
    expect(res.body.totalDeleted).toBe(4);
    expect(res.body.failedSubtasks).not.toContain('reviewDrafts');
  });

  it('a thrown review-draft GC is caught, surfaced in failedSubtasks, and marks the run failed', async () => {
    const ReviewDraftService = require('../../lib/services/review-draft-service');
    ReviewDraftService.deleteExpired.mockRejectedValueOnce(new Error('pg down'));
    const res = makeRes();
    await handler({ method: 'POST', headers: {} }, res);

    expect(res.body.ok).toBe(false);
    expect(res.body.results.reviewDrafts).toEqual({ error: 'pg down' });
    expect(res.body.failedSubtasks).toContain('reviewDrafts');
  });

  it('a thrown cleanup is caught, surfaced in failedSubtasks, and marks the run failed', async () => {
    MaintenanceService.cleanupMaintenanceRuns.mockRejectedValueOnce(new Error('pg down'));
    const res = makeRes();
    await handler({ method: 'POST', headers: {} }, res);

    expect(res.body.ok).toBe(false);
    expect(res.body.results.maintenanceRuns).toEqual({ error: 'pg down' });
    expect(res.body.failedSubtasks).toContain('maintenanceRuns');
    // The audit row is closed as failed.
    expect(MaintenanceService.completeRun).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ status: 'failed' }),
    );
  });
});
