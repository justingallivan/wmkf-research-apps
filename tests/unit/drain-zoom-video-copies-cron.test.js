/** @jest-environment node */
// Stage 3b S6: the every-minute Zoom video copy cron. The tick itself is covered by zoom-video-copy-worker*.test.js.
import fs from 'fs';
import path from 'path';

jest.mock('../../lib/utils/cron-auth', () => ({ verifyCronSecret: jest.fn(() => true) }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: jest.fn((_name, fn) => fn()) }));
jest.mock('../../lib/services/maintenance-service', () => ({
  __esModule: true, default: { startRun: jest.fn(async () => 7), completeRun: jest.fn(async () => {}) },
}));
jest.mock('../../lib/services/meeting-tracker-recordings/video-copy-worker.js', () => ({
  TICK_WORK_MS: 270_000, runZoomVideoCopyTick: jest.fn(),
}));

import { verifyCronSecret } from '../../lib/utils/cron-auth';
import { withDalContext } from '../../lib/dataverse/core/context';
import MaintenanceService from '../../lib/services/maintenance-service';
import { runZoomVideoCopyTick } from '../../lib/services/meeting-tracker-recordings/video-copy-worker.js';
import handler, { config } from '../../pages/api/cron/drain-zoom-video-copies.js';

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

test('runs exactly one tick inside the DAL context with a work deadline 270 s after entry and returns counts only', async () => {
  runZoomVideoCopyTick.mockResolvedValue({ outcome: 'copied', code: null, copyId: '11111111-1111-4111-8111-111111111111' });
  const before = Date.now();
  const res = response();
  await handler({ method: 'GET', headers: {} }, res);
  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({ ok: true, outcome: 'copied', code: null, worked: 1 });
  expect(JSON.stringify(res.body)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  expect(runZoomVideoCopyTick).toHaveBeenCalledTimes(1);
  expect(withDalContext).toHaveBeenCalledWith('cron-drain-zoom-video-copies', expect.any(Function));
  const { deadlineMs } = runZoomVideoCopyTick.mock.calls[0][0];
  expect(deadlineMs).toBeGreaterThanOrEqual(before + 270_000);
  expect(deadlineMs).toBeLessThanOrEqual(Date.now() + 270_000);
  expect(MaintenanceService.completeRun).toHaveBeenCalledWith(7, expect.objectContaining({ status: 'completed', recordsProcessed: 1 }));
});

test('an idle tick reports zero work; a rejected cron secret runs nothing; other methods are 405', async () => {
  runZoomVideoCopyTick.mockResolvedValue({ outcome: 'idle' });
  const idle = response();
  await handler({ method: 'POST', headers: {} }, idle);
  expect(idle.body).toEqual({ ok: true, outcome: 'idle', code: null, worked: 0 });

  runZoomVideoCopyTick.mockClear();
  verifyCronSecret.mockReturnValue(false);
  await handler({ method: 'GET', headers: {} }, response());
  expect(runZoomVideoCopyTick).not.toHaveBeenCalled();
  expect(MaintenanceService.startRun).toHaveBeenCalledTimes(1);

  verifyCronSecret.mockReturnValue(true);
  const put = response();
  await handler({ method: 'PUT', headers: {} }, put);
  expect(put.statusCode).toBe(405);
  expect(runZoomVideoCopyTick).not.toHaveBeenCalled();
});

test('a thrown tick is a 500 with a fixed message and no detail', async () => {
  runZoomVideoCopyTick.mockRejectedValue(new Error('private https://zoom.example/secret detail'));
  const res = response();
  await handler({ method: 'GET', headers: {} }, res);
  expect(res.statusCode).toBe(500);
  expect(res.body).toEqual({ ok: false, error: 'Zoom video copy tick failed.' });
  expect(JSON.stringify(MaintenanceService.completeRun.mock.calls)).not.toContain('private');
});

test('the route and vercel.json carry the 300 s entry that overrides the 120 s cron glob, and an every-minute schedule', () => {
  expect(config).toEqual({ maxDuration: 300 });
  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  expect(vercel.functions['pages/api/cron/*.js']).toEqual({ maxDuration: 120 });
  expect(vercel.functions['pages/api/cron/drain-zoom-video-copies.js']).toEqual({ maxDuration: 300 });
  expect(vercel.crons.filter(cron => cron.path === '/api/cron/drain-zoom-video-copies')).toEqual([
    { path: '/api/cron/drain-zoom-video-copies', schedule: '* * * * *' },
  ]);
});
