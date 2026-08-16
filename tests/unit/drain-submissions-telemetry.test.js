/**
 * Drain telemetry — maintenance_runs audit-trail wiring for the submission drain.
 *
 * Codebase eval 2026-05-29 #3: /api/cron/drain-submissions had NO run telemetry,
 * so a silent drain failure was invisible to the cron audit trail. The fix adds
 * MaintenanceService.startRun/completeRun, but with a deliberate divergence from
 * cron/maintenance.js: the drain ticks every 2 minutes, so idle ticks
 * (claimed:0) must NOT open a maintenance_runs row (no retention sweep exists on
 * that table — ~720 rows/day of noise otherwise). Fatal failures are ALWAYS
 * recorded.
 *
 * These tests pin the two branches that the design hinges on and that are
 * robustly testable without reaching into processJob internals:
 *   - idle tick (claimBatch → []) opens NO run row
 *   - a fatal drain error (claimBatch throws) records a 'failed' run row + 500
 *
 * The success / per-job-error completeRun mapping is simple branching over
 * `stats` and is verified by inspection; exercising it would require driving
 * processJob's internal queries, which would couple this test to unrelated
 * state-machine logic.
 */

// pg Pool → a controllable fake client. `import pkg from 'pg'; const { Pool } = pkg`.
const mockQuery = jest.fn();
const mockRelease = jest.fn();
const mockConnect = jest.fn(async () => ({ query: mockQuery, release: mockRelease }));
jest.mock('pg', () => ({ Pool: jest.fn(() => ({ connect: mockConnect })) }));

// The cron module imports blob / dynamics / graph / audit at top level; none
// are exercised by the telemetry paths under test, but stubbing them keeps the
// module load light (notably @vercel/blob → undici needs TextEncoder, absent
// in jsdom). MaintenanceService is left real and spied per-test.
jest.mock('@vercel/blob', () => ({ get: jest.fn() }));
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { createRecord: jest.fn(), getRecord: jest.fn() },
}));
jest.mock('../../lib/services/graph-service', () => ({
  GraphService: { uploadFile: jest.fn() },
}));
jest.mock('../../lib/services/intake-audit-service', () => ({ __esModule: true, default: {} }));
jest.mock('../../lib/services/alert-service', () => ({
  __esModule: true,
  default: { createAlert: jest.fn().mockResolvedValue(undefined) },
}));

import handler from '../../pages/api/cron/drain-submissions';
import MaintenanceService from '../../lib/services/maintenance-service';

const CRON_SECRET = 'test-cron-secret';
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

let startRunSpy;
let completeRunSpy;

beforeEach(() => {
  mockQuery.mockReset();
  mockRelease.mockReset();
  mockConnect.mockClear();
  process.env.CRON_SECRET = CRON_SECRET;
  process.env.POSTGRES_URL = 'postgres://test';
  // Spy on telemetry so the real (postgres-backed) writes never fire.
  startRunSpy = jest.spyOn(MaintenanceService, 'startRun').mockResolvedValue(4242);
  completeRunSpy = jest.spyOn(MaintenanceService, 'completeRun').mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_CRON_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
});

function makeReq(authorization = `Bearer ${CRON_SECRET}`) {
  return { method: 'GET', headers: authorization ? { authorization } : {} };
}
function makeRes() {
  const res = {
    statusCode: 200,
    body: null,
    status: jest.fn(function (code) { this.statusCode = code; return this; }),
    json: jest.fn(function (data) { this.body = data; return this; }),
  };
  return res;
}

describe('drain cron auth — strict policy with shared constant-time compare', () => {
  test('rejects a wrong-length secret before opening a database connection', async () => {
    const res = makeRes();

    await handler(makeReq(`Bearer ${CRON_SECRET}-extra`), res);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
    expect(mockConnect).not.toHaveBeenCalled();
  });

  test('keeps rejecting in development rather than inheriting the shared verifier bypass', async () => {
    process.env.NODE_ENV = 'development';
    const res = makeRes();

    await handler(makeReq('Bearer wrong'), res);

    expect(res.statusCode).toBe(401);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  test('preserves the missing-secret 500', async () => {
    delete process.env.CRON_SECRET;
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = makeRes();

    await handler(makeReq(), res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'CRON_SECRET not configured' });
    expect(mockConnect).not.toHaveBeenCalled();
  });
});

describe('drain telemetry — maintenance_runs wiring', () => {
  test('idle tick (no jobs claimed) opens NO maintenance_runs row', async () => {
    // claimBatch's UPDATE ... RETURNING yields zero rows.
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = makeRes();
    await handler(makeReq(), res);

    expect(startRunSpy).not.toHaveBeenCalled();
    expect(completeRunSpy).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, claimed: 0, processed: 0, errors: 0 });
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  test('a fatal drain error (claimBatch throws) records a failed run row and returns 500', async () => {
    const boom = new Error('connection terminated');
    mockQuery.mockRejectedValueOnce(boom);

    const res = makeRes();
    await handler(makeReq(), res);

    // The fatal path opens a row even though claimBatch threw before any
    // work, so the failure is never silent.
    expect(startRunSpy).toHaveBeenCalledWith('drain-submissions');
    expect(completeRunSpy).toHaveBeenCalledTimes(1);
    const [runId, payload] = completeRunSpy.mock.calls[0];
    expect(runId).toBe(4242);
    expect(payload.status).toBe('failed');
    expect(payload.errorMessage).toBe('connection terminated');
    expect(payload.details).toMatchObject({ phase: 'fatal', claimed: 0 });

    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ error: 'drain fatal', message: 'Internal error' });
    // The pooled client is still released on the fatal path.
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  test('an unauthorized request never touches telemetry', async () => {
    const res = makeRes();
    await handler({ method: 'GET', headers: { authorization: 'Bearer wrong' } }, res);

    expect(res.statusCode).toBe(401);
    expect(startRunSpy).not.toHaveBeenCalled();
    expect(completeRunSpy).not.toHaveBeenCalled();
    expect(mockConnect).not.toHaveBeenCalled();
  });
});
