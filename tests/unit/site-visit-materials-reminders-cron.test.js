/** @jest-environment node */
jest.mock('../../lib/utils/cron-auth', () => ({ verifyCronSecret: jest.fn(() => true) }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: jest.fn((_label, fn) => fn()) }));
jest.mock('../../lib/services/maintenance-service', () => ({
  __esModule: true,
  default: { startRun: jest.fn(async () => 7), completeRun: jest.fn(async () => {}) },
}));
jest.mock('../../lib/services/site-visit-materials/reminder-sweep', () => ({ sweepMaterialsReminders: jest.fn() }));

import { verifyCronSecret } from '../../lib/utils/cron-auth';
import { withDalContext } from '../../lib/dataverse/core/context';
import MaintenanceService from '../../lib/services/maintenance-service';
import { sweepMaterialsReminders } from '../../lib/services/site-visit-materials/reminder-sweep';
import handler from '../../pages/api/cron/site-visit-materials-reminders';

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  return res;
}
const clean = { dryRun: false, scanned: 2, eligible: 1, sent: 1, skippedNothingMissing: 1, skippedNoSender: 0, claimLost: 0, sendFailed: 0, errors: [] };

beforeEach(() => {
  jest.clearAllMocks();
  sweepMaterialsReminders.mockImplementation(async ({ dryRun }) => ({ ...clean, dryRun }));
});

test('rejects other methods and unauthenticated calls before any work', async () => {
  const res = mockRes();
  await handler({ method: 'DELETE', query: {} }, res);
  expect(res.statusCode).toBe(405);
  verifyCronSecret.mockImplementationOnce((_req, r) => { r.status(401).json({ error: 'no' }); return false; });
  const denied = mockRes();
  await handler({ method: 'GET', query: {} }, denied);
  expect(denied.statusCode).toBe(401);
  expect(sweepMaterialsReminders).not.toHaveBeenCalled();
  expect(MaintenanceService.startRun).not.toHaveBeenCalled();
});

test('runs the sweep inside a DAL context with clamped knobs and records a completed run', async () => {
  const res = mockRes();
  await handler({ method: 'GET', query: { maxBatch: '9999', dryRun: '1' } }, res);
  expect(withDalContext).toHaveBeenCalledWith('cron-site-visit-materials-reminders', expect.any(Function));
  expect(sweepMaterialsReminders).toHaveBeenCalledWith({ maxBatch: 500, dryRun: true });
  expect(MaintenanceService.startRun).toHaveBeenCalledWith('site-visit-materials-reminders');
  expect(MaintenanceService.completeRun).toHaveBeenCalledWith(7, expect.objectContaining({ status: 'completed', recordsProcessed: 2, recordsDeleted: 1 }));
  expect(res.body).toMatchObject({ ok: true, maxBatch: 500, dryRun: true, sent: 1 });
});

test('row errors mark the run failed; a thrown sweep is a 500 with a failed run', async () => {
  sweepMaterialsReminders.mockResolvedValueOnce({ ...clean, errors: [{ id: 'c1', error: 'smtp' }] });
  const res = mockRes();
  await handler({ method: 'POST', query: {} }, res);
  expect(MaintenanceService.completeRun).toHaveBeenCalledWith(7, expect.objectContaining({ status: 'failed', errorMessage: '1 error(s)' }));
  expect(res.statusCode).toBe(200);
  sweepMaterialsReminders.mockRejectedValueOnce(new Error('boom'));
  const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const failed = mockRes();
  await handler({ method: 'POST', query: {} }, failed);
  expect(failed.statusCode).toBe(500);
  expect(failed.body).toEqual({ ok: false, error: 'Automatic materials reminders failed.' });
  expect(MaintenanceService.completeRun).toHaveBeenLastCalledWith(7, expect.objectContaining({ status: 'failed' }));
  log.mockRestore();
});
