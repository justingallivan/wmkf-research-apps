/**
 * drain-record-failure.test.js
 *
 * Covers the S187 rewrite of `recordFailure` in
 * `pages/api/cron/drain-submissions.js`:
 *   - Per-category `maxAttempts` from the classifier drives cap-exhaustion.
 *   - Exponential backoff: 60 * 2^priorAttempts capped at 3600s (no jitter).
 *   - Cap-exhausted terminals emit `intake_drain_retry_exhausted` alerts
 *     AFTER the UPDATE/audit/COMMIT succeed.
 *   - Inherently-terminal categories (retryable=false) do NOT emit the
 *     retry-exhausted alert (call sites own those bespoke alerts).
 *   - Lease-lost (UPDATE rowCount=0) returns false and rolls back without
 *     alerting.
 *   - Misuse: `retryable=true` without finite `maxAttempts` throws.
 */

jest.mock('../../lib/services/alert-service', () => ({
  __esModule: true,
  default: { createAlert: jest.fn().mockResolvedValue(undefined) },
}));

// pg / blob / dynamics / graph aren't exercised by recordFailure but the
// cron module imports them at top level. Stub them so the module loads.
jest.mock('pg', () => ({ Pool: jest.fn() }), { virtual: false });
jest.mock('@vercel/blob', () => ({ get: jest.fn() }), { virtual: false });
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { createRecord: jest.fn(), getRecord: jest.fn() },
}));
jest.mock('../../lib/services/graph-service', () => ({
  GraphService: { uploadFile: jest.fn() },
}));
jest.mock('../../lib/services/intake-audit-service', () => ({
  __esModule: true,
  default: {},
}));

const AlertService = require('../../lib/services/alert-service').default;
// Stage 5 extraction (plumbing-only retarget): the drain engine incl.
// recordFailure moved to the cron service; assertions unchanged.
const cronModule = require('../../lib/services/cron/drain-submissions-service');
const { _testing } = cronModule;
const { recordFailure } = _testing;

function mockClient({ updateRowCount = 1 } = {}) {
  const calls = [];
  const query = jest.fn(async (sql, params) => {
    calls.push({ sql, params });
    const trimmed = sql.trim();
    if (trimmed === 'BEGIN' || trimmed === 'COMMIT' || trimmed === 'ROLLBACK') {
      return { rowCount: 0, rows: [] };
    }
    if (trimmed.startsWith('UPDATE submission_jobs')) {
      return { rowCount: updateRowCount, rows: [] };
    }
    if (trimmed.startsWith('INSERT INTO intake_audit')) {
      return { rowCount: 1, rows: [] };
    }
    return { rowCount: 0, rows: [] };
  });
  return { query, calls };
}

function makeJob({ id = 42, attempts = 0, requestId = 'req-uuid' } = {}) {
  return { id, attempts, request_id: requestId };
}

function findUpdateCall(client) {
  return client.calls.find((c) => c.sql.trim().startsWith('UPDATE submission_jobs'));
}

beforeEach(() => {
  AlertService.createAlert.mockClear();
});

describe('recordFailure — exponential backoff (no jitter)', () => {
  test('priorAttempts=0 retryable → backoff = 60s, not terminal', async () => {
    const client = mockClient();
    const job = makeJob({ attempts: 0 });
    const result = await recordFailure(client, {
      job,
      leaseToken: 'lease-1',
      category: 'transient_5xx',
      errorMessage: 'upstream 503',
      retryable: true,
      maxAttempts: 10,
    });
    expect(result).toBe(true);
    const upd = findUpdateCall(client);
    expect(upd.sql).toContain('next_attempt_at = now() +');
    expect(upd.sql).not.toContain(`status = `);
    // last_error is $1, backoff seconds is $2, jobId is $3, leaseToken is $4.
    expect(upd.params[1]).toBe(60);
    expect(AlertService.createAlert).not.toHaveBeenCalled();
  });

  test('priorAttempts=5 retryable → backoff = 1920s, not terminal', async () => {
    const client = mockClient();
    const job = makeJob({ attempts: 5 });
    await recordFailure(client, {
      job,
      leaseToken: 'lease-1',
      category: 'transient_5xx',
      errorMessage: 'upstream 503',
      retryable: true,
      maxAttempts: 10,
    });
    const upd = findUpdateCall(client);
    expect(upd.params[1]).toBe(1920); // 60 * 2^5
    expect(AlertService.createAlert).not.toHaveBeenCalled();
  });

  test('priorAttempts=6 retryable → backoff capped at 3600s', async () => {
    const client = mockClient();
    const job = makeJob({ attempts: 6 });
    await recordFailure(client, {
      job,
      leaseToken: 'lease-1',
      category: 'transient_5xx',
      errorMessage: 'upstream 503',
      retryable: true,
      maxAttempts: 10,
    });
    const upd = findUpdateCall(client);
    expect(upd.params[1]).toBe(3600); // 60 * 2^6 = 3840 → capped
  });

  test('priorAttempts=20 retryable → backoff still capped at 3600s', async () => {
    const client = mockClient();
    // Synthetic: maxAttempts huge so we don't exhaust before testing the cap.
    const job = makeJob({ attempts: 20 });
    await recordFailure(client, {
      job,
      leaseToken: 'lease-1',
      category: 'transient_5xx',
      errorMessage: 'upstream 503',
      retryable: true,
      maxAttempts: 999,
    });
    const upd = findUpdateCall(client);
    expect(upd.params[1]).toBe(3600);
  });
});

describe('recordFailure — cap exhaustion', () => {
  test('retryable + nextAttempts >= maxAttempts → terminal failed + retry-exhausted alert', async () => {
    const client = mockClient();
    const job = makeJob({ id: 99, attempts: 9 });
    const result = await recordFailure(client, {
      job,
      leaseToken: 'lease-1',
      category: 'transient_5xx',
      errorMessage: 'upstream 503 #10',
      retryable: true,
      maxAttempts: 10,
    });
    expect(result).toBe(true);
    const upd = findUpdateCall(client);
    expect(upd.sql).toContain(`status = `);
    expect(upd.sql).toContain('completed_at = now()');
    expect(upd.sql).not.toContain('next_attempt_at');
    // status param is 'failed'; backoff param NOT present.
    expect(upd.params).toContain('failed');

    expect(AlertService.createAlert).toHaveBeenCalledTimes(1);
    const alertArg = AlertService.createAlert.mock.calls[0][0];
    expect(alertArg.type).toBe('intake_drain_retry_exhausted');
    expect(alertArg.severity).toBe('error');
    expect(alertArg.autoResolveKey).toBe('intake-drain-retry-exhausted-transient_5xx');
    expect(alertArg.metadata).toMatchObject({
      jobId: 99,
      requestId: 'req-uuid',
      category: 'transient_5xx',
      attempts: 10,
      maxAttempts: 10,
    });
  });

  test('scan_error category (maxAttempts=3) exhausts at priorAttempts=2', async () => {
    const client = mockClient();
    const job = makeJob({ attempts: 2 });
    await recordFailure(client, {
      job,
      leaseToken: 'lease-1',
      category: 'scan_error',
      errorMessage: 'scanner 503',
      retryable: true,
      maxAttempts: 3,
    });
    expect(AlertService.createAlert).toHaveBeenCalledTimes(1);
    expect(AlertService.createAlert.mock.calls[0][0].autoResolveKey)
      .toBe('intake-drain-retry-exhausted-scan_error');
  });
});

describe('recordFailure — inherently terminal categories', () => {
  test('retryable=false → terminal failed, NO retry-exhausted alert', async () => {
    const client = mockClient();
    const job = makeJob({ attempts: 0 });
    await recordFailure(client, {
      job,
      leaseToken: 'lease-1',
      category: 'validation_400',
      errorMessage: 'malformed attachment',
      retryable: false,
      maxAttempts: 0,
    });
    const upd = findUpdateCall(client);
    expect(upd.sql).toContain(`status = `);
    expect(upd.params).toContain('failed');
    expect(AlertService.createAlert).not.toHaveBeenCalled();
  });
});

describe('recordFailure — lease lost (rowCount=0)', () => {
  test('UPDATE matches 0 rows → returns false, rolls back, no alert', async () => {
    const client = mockClient({ updateRowCount: 0 });
    const job = makeJob({ attempts: 9 });
    const result = await recordFailure(client, {
      job,
      leaseToken: 'lease-stale',
      category: 'transient_5xx',
      errorMessage: 'upstream 503',
      retryable: true,
      maxAttempts: 10, // would otherwise be cap-exhausted
    });
    expect(result).toBe(false);
    // Should have BEGIN + UPDATE + ROLLBACK, no INSERT, no COMMIT.
    const sqls = client.calls.map((c) => c.sql.trim().split(/\s+/)[0]);
    expect(sqls).toContain('BEGIN');
    expect(sqls).toContain('UPDATE');
    expect(sqls).toContain('ROLLBACK');
    expect(sqls).not.toContain('INSERT');
    expect(sqls).not.toContain('COMMIT');
    expect(AlertService.createAlert).not.toHaveBeenCalled();
  });
});

describe('recordFailure — misuse guard', () => {
  test('retryable=true without finite maxAttempts → throws', async () => {
    const client = mockClient();
    const job = makeJob();
    await expect(
      recordFailure(client, {
        job,
        leaseToken: 'lease-1',
        category: 'transient_5xx',
        errorMessage: 'oops',
        retryable: true,
        maxAttempts: undefined,
      }),
    ).rejects.toThrow(/recordFailure misuse/);
    // No UPDATE attempted before the guard fires.
    expect(client.query).not.toHaveBeenCalled();
  });

  test('retryable=true with maxAttempts=NaN → throws', async () => {
    const client = mockClient();
    await expect(
      recordFailure(client, {
        job: makeJob(),
        leaseToken: 'lease-1',
        category: 'transient_5xx',
        errorMessage: 'oops',
        retryable: true,
        maxAttempts: NaN,
      }),
    ).rejects.toThrow(/recordFailure misuse/);
  });
});

describe('processJob — safety-net handles recordFailure misuse as terminal', () => {
  const { processJob } = _testing;

  test('misuse-shaped throw from handler routes through safety net as terminal failed', async () => {
    const client = mockClient();
    // Drive handleQueued down its alert-then-recordFailure branch by feeding
    // an attachment that fails shape validation. We then make the in-handler
    // AlertService.createAlert throw a misuse-shaped Error to simulate a
    // recordFailure call site that forgot maxAttempts (Patch-B regression).
    // The throw escapes handleQueued and reaches the safety net.
    AlertService.createAlert.mockImplementationOnce(() => {
      throw new Error('recordFailure misuse: retryable=true requires finite maxAttempts (got undefined) for job 7 category transient_5xx');
    });

    const job = {
      id: 7,
      status: 'queued',
      attempts: 0,
      lease_token: 'lease-1',
      request_id: 'req-uuid',
      // Malformed attachment → validateAttachmentShape throws → handler's
      // catch block alerts + calls recordFailure. Our mock makes the alert
      // throw, which bubbles past the catch (it's not nested in another try).
      payload: { attachments: [{ /* missing required fields */ }] },
    };

    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await processJob(client, job);
    } finally {
      errSpy.mockRestore();
    }

    // Safety net must have routed the misuse-shaped error as TERMINAL — the
    // UPDATE should set status='failed', NOT bump next_attempt_at (which is
    // what would happen if the safety net classified the throw as 'unknown'
    // → retryable=true → 9 more retries).
    const upd = findUpdateCall(client);
    expect(upd).toBeDefined();
    expect(upd.sql).toContain(`status = `);
    expect(upd.sql).toContain('completed_at = now()');
    expect(upd.sql).not.toContain('next_attempt_at');
    expect(upd.params).toContain('failed');
    // No retry-exhausted alert: terminal here is via retryable=false (the
    // misuse classification), not via cap exhaustion.
    // Note: AlertService.createAlert was called once (and threw); no further
    // calls expected.
    expect(AlertService.createAlert).toHaveBeenCalledTimes(1);
  });
});
