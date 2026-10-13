/** @jest-environment node */
// Site Visit C1: the every-minute transcript regeneration cron. The tick itself is covered by presentation-transcript-regeneration-worker.test.js.
import fs from 'fs';
import path from 'path';

jest.mock('../../lib/utils/cron-auth', () => ({ verifyCronSecret: jest.fn(() => true) }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: jest.fn((_name, fn) => fn()) }));
jest.mock('../../lib/services/maintenance-service', () => ({
  __esModule: true, default: { startRun: jest.fn(async () => 7), completeRun: jest.fn(async () => {}) },
}));
jest.mock('../../lib/services/meeting-tracker-transcription/presentation-transcript-regeneration-worker.js', () => ({
  TICK_WORK_MS: 270_000, runPresentationTranscriptRegenerationTick: jest.fn(),
}));

import { verifyCronSecret } from '../../lib/utils/cron-auth';
import { withDalContext } from '../../lib/dataverse/core/context';
import MaintenanceService from '../../lib/services/maintenance-service';
import { runPresentationTranscriptRegenerationTick } from '../../lib/services/meeting-tracker-transcription/presentation-transcript-regeneration-worker.js';
import handler, { config } from '../../pages/api/cron/drain-presentation-transcript-regenerations.js';

const ROOT = path.resolve(__dirname, '../..');
const response = () => ({
  status: jest.fn(function status(value) { this.statusCode = value; return this; }),
  json: jest.fn(function json(value) { this.body = value; return this; }),
  setHeader: jest.fn(),
});
let errorSpy;
beforeEach(() => {
  jest.clearAllMocks();
  verifyCronSecret.mockReturnValue(true);
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => errorSpy.mockRestore());

test('runs one tick inside the DAL context with a deadline 270 s after entry and returns counts only', async () => {
  runPresentationTranscriptRegenerationTick.mockResolvedValue({ outcome: 'worked', worked: 2, results: [{ outcome: 'done', code: null }] });
  const before = Date.now();
  const res = response();
  await handler({ method: 'GET', headers: {} }, res);
  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({ ok: true, outcome: 'worked', worked: 2 });
  expect(withDalContext).toHaveBeenCalledWith('cron-drain-presentation-transcript-regenerations', expect.any(Function));
  const { deadlineMs } = runPresentationTranscriptRegenerationTick.mock.calls[0][0];
  expect(deadlineMs).toBeGreaterThanOrEqual(before + 270_000);
  expect(deadlineMs).toBeLessThanOrEqual(Date.now() + 270_000);
  expect(MaintenanceService.startRun).toHaveBeenCalledWith('drain-presentation-transcript-regenerations');
  expect(MaintenanceService.completeRun).toHaveBeenCalledWith(7, expect.objectContaining({ status: 'completed', recordsProcessed: 2 }));
});

test('a missing table reports schema_not_ready as a normal run, not a failure', async () => {
  runPresentationTranscriptRegenerationTick.mockResolvedValue({ outcome: 'schema_not_ready', worked: 0, results: [] });
  const res = response();
  await handler({ method: 'POST', headers: {} }, res);
  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({ ok: true, outcome: 'schema_not_ready', worked: 0 });
  expect(errorSpy).not.toHaveBeenCalled();
});

test('a rejected cron secret runs nothing; other methods are 405', async () => {
  verifyCronSecret.mockReturnValue(false);
  await handler({ method: 'GET', headers: {} }, response());
  expect(runPresentationTranscriptRegenerationTick).not.toHaveBeenCalled();
  expect(MaintenanceService.startRun).not.toHaveBeenCalled();
  verifyCronSecret.mockReturnValue(true);
  const put = response();
  await handler({ method: 'PUT', headers: {} }, put);
  expect(put.statusCode).toBe(405);
  expect(runPresentationTranscriptRegenerationTick).not.toHaveBeenCalled();
});

test('a thrown tick is a 500 with a fixed message and no detail', async () => {
  runPresentationTranscriptRegenerationTick.mockRejectedValue(new Error('private detail 11111111-1111-4111-8111-111111111111'));
  const res = response();
  await handler({ method: 'GET', headers: {} }, res);
  expect(res.statusCode).toBe(500);
  expect(res.body).toEqual({ ok: false, error: 'Presentation transcript regeneration tick failed.' });
  expect(JSON.stringify(MaintenanceService.completeRun.mock.calls)).not.toContain('private');
});

test('the route and vercel.json carry the 300 s entry that overrides the 120 s cron glob, and an every-minute schedule', () => {
  expect(config).toEqual({ maxDuration: 300 });
  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  expect(vercel.functions['pages/api/cron/drain-presentation-transcript-regenerations.js']).toEqual({ maxDuration: 300 });
  expect(vercel.crons.filter(cron => cron.path === '/api/cron/drain-presentation-transcript-regenerations')).toEqual([
    { path: '/api/cron/drain-presentation-transcript-regenerations', schedule: '* * * * *' },
  ]);
});
