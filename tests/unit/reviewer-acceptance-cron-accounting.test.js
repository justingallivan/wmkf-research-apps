/** @jest-environment node */
import handler from '../../pages/api/cron/drain-reviewer-acceptances';
import { drainReviewerAcceptanceJobs } from '../../lib/services/reviewer-acceptance-drain';
import MaintenanceService from '../../lib/services/maintenance-service';
import { createMockReq, createMockRes } from '../helpers/auth-mock';
jest.mock('../../lib/utils/cron-auth', () => ({ verifyCronSecret: () => true }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: async (_label, fn) => fn() }));
jest.mock('../../lib/services/reviewer-acceptance-drain', () => ({ drainReviewerAcceptanceJobs: jest.fn() }));
jest.mock('../../lib/services/maintenance-service', () => ({ __esModule: true, default: { startRun: jest.fn(async () => 1), completeRun: jest.fn() } }));
test.each([[1, 0, 0, 'completed'], [0, 1, 0, 'failed'], [0, 0, 1, 'failed']])('Maintenance accurately reports retried=%s failed=%s lost=%s as %s', async (retried, failed, leaseLost, status) => {
  jest.clearAllMocks(); const result = { claimed: 1, completed: 0, cancelled: 0, retried, failed, leaseLost, retriedJobIds: retried ? [7] : [], errors: [{ jobId: 7, message: 'preparation refused' }] }; drainReviewerAcceptanceJobs.mockResolvedValue(result);
  const res = createMockRes(); await handler(createMockReq({ method: 'GET', query: {} }), res);
  expect(res._data).toMatchObject({ ok: true, ...result }); expect(MaintenanceService.completeRun).toHaveBeenCalledWith(1, expect.objectContaining({ status, details: expect.objectContaining(result) }));
});
