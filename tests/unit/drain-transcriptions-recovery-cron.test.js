jest.mock('../../lib/utils/cron-auth', () => ({ verifyTranscriptionCronSecret: jest.fn(() => true) }));
jest.mock('../../lib/services/transcription-pilot/preflight', () => ({ runTranscriptionPreflight: jest.fn() }));
jest.mock('../../lib/services/alert-service', () => ({ __esModule: true, default: { autoResolve: jest.fn(async () => {}) } }));
jest.mock('../../lib/services/notification-service', () => ({ __esModule: true, default: { notify: jest.fn(async () => {}) } }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: (_name, fn) => fn() }));
jest.mock('../../lib/services/transcription-pilot/workflow-dispatch', () => ({
  drainTranscriptionWorkflowDispatches: jest.fn(),
}));
jest.mock('../../lib/services/meeting-tracker-transcription/alignment-service', () => ({
  recoverPendingAlignments: jest.fn(),
}));

import { verifyTranscriptionCronSecret } from '../../lib/utils/cron-auth';
import { drainTranscriptionWorkflowDispatches } from '../../lib/services/transcription-pilot/workflow-dispatch';
import { recoverPendingAlignments } from '../../lib/services/meeting-tracker-transcription/alignment-service';
import handler from '../../pages/api/cron/drain-transcriptions.js';

function response() {
  return { status: jest.fn(function status(value) { this.statusCode = value; return this; }),
    json: jest.fn(function json(value) { this.body = value; return this; }), setHeader: jest.fn() };
}
const request = { method: 'GET', query: { recovery: '1' }, headers: {} };

let errorSpy;
beforeEach(() => {
  jest.resetAllMocks();
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  verifyTranscriptionCronSecret.mockReturnValue(true);
  drainTranscriptionWorkflowDispatches.mockResolvedValue({ incomplete: false, dispatched: 2 });
});
afterEach(() => errorSpy.mockRestore());

test('recovery runs alignment recovery after the dispatch drain and reports both', async () => {
  recoverPendingAlignments.mockResolvedValue({ expired: 1, attempted: 2, outcomes: { applied: 2 } });
  const before = Date.now();
  const res = response();
  await handler(request, res);
  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({ ok: true, recovery: { incomplete: false, dispatched: 2 },
    alignment: { expired: 1, attempted: 2, outcomes: { applied: 2 } } });
  expect(drainTranscriptionWorkflowDispatches.mock.invocationCallOrder[0])
    .toBeLessThan(recoverPendingAlignments.mock.invocationCallOrder[0]);
  const call = recoverPendingAlignments.mock.calls[0][0];
  expect(call.limit).toBe(5);
  expect(call.deadlineMs).toBeLessThanOrEqual(before + 240_000 + 1_000);
  expect(call.deadlineMs).toBeGreaterThan(before + 200_000);
});

test('an alignment recovery failure does not mask the dispatch result', async () => {
  recoverPendingAlignments.mockRejectedValue(new Error('private transcript detail'));
  const res = response();
  await handler(request, res);
  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({ ok: true, recovery: { incomplete: false, dispatched: 2 }, alignment: { failed: true } });
  expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('private');
});
