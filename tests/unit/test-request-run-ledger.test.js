import { createRunLedger, sanitizeErrorMessage } from '../../lib/services/test-requests/run-ledger.js';

/**
 * Recording fake db: satisfies the `{ query, transaction }` interface
 * run-ledger.js expects, records every SQL text + param list, and returns
 * canned rows from a queue (FIFO, one entry per `query` call in the order
 * the store is expected to issue them). This intentionally does NOT
 * interpret SQL -- it is a contract-shape fake, asserting on the SQL text
 * and parameter list/types the store sends, not simulating Postgres.
 */
function createFakeDb() {
  const calls = [];
  const queue = [];
  const db = {
    async query(text, params = []) {
      calls.push({ text, params });
      const next = queue.shift();
      return { rows: next ?? [] };
    },
    async transaction(fn) {
      return fn(db);
    },
  };
  return { db, calls, queueRows: (rows) => queue.push(rows) };
}

const BASE_PLAN = {
  runId: '11111111-1111-1111-1111-111111111111',
  recipe: 'basic',
  sourceDataverseHost: 'source.crm.dynamics.com',
  sourceRequestId: '22222222-2222-2222-2222-222222222222',
  sourceRequestNumber: 'REQ-0001',
  sourceRevision: 'rev-1',
  bundleSha256: 'a'.repeat(64),
  bundleExportedAt: '2026-09-23T00:00:00.000Z',
  copyPolicyVersion: '1',
  copyPolicyDigest: 'b'.repeat(64),
  planDigest: 'digest-a',
  createBodySha256: 'c'.repeat(64),
  destinationEnvironment: 'sandbox',
  destinationDataverseHost: 'sandbox.crm.dynamics.com',
  destinationRequestId: '33333333-3333-3333-3333-333333333333',
  destinationLocationId: '44444444-4444-4444-4444-444444444444',
  expectedAppUserId: '55555555-5555-5555-5555-555555555555',
  expectedOrganizationId: '66666666-6666-6666-6666-666666666666',
  expectedGraphSiteId: 'site-1',
  expectedGraphDriveId: 'drive-1',
  fiscalYear: 'FY26',
  meetingDate: '2026-10-01',
  testLabel: 'ZZTEST',
};

function runRow(overrides = {}) {
  return {
    run_id: BASE_PLAN.runId,
    actor_id: 'actor-1',
    idempotency_key: 'key-1',
    status: 'prepared',
    current_step: 'fence_source',
    step_index: 0,
    recipe: 'basic',
    plan_digest: BASE_PLAN.planDigest,
    destination_request_id: BASE_PLAN.destinationRequestId,
    destination_location_id: BASE_PLAN.destinationLocationId,
    version: 1,
    lease_token: null,
    lease_generation: 0,
    locked_until: null,
    attempt_count: 0,
    created_at: '2026-09-23T00:00:00.000Z',
    updated_at: '2026-09-23T00:00:00.000Z',
    completed_at: null,
    ...overrides,
  };
}

describe('sanitizeErrorMessage', () => {
  it('redacts a bearer token', () => {
    expect(sanitizeErrorMessage('failed: Bearer abc123.def456')).toBe('failed: Bearer [redacted]');
  });

  it('caps length at 500 chars', () => {
    const long = 'x'.repeat(1000);
    expect(sanitizeErrorMessage(long)).toHaveLength(500);
  });

  it('handles null/undefined', () => {
    expect(sanitizeErrorMessage(null)).toBe('');
    expect(sanitizeErrorMessage(undefined)).toBe('');
  });
});

describe('reserveRun', () => {
  it('creates a new run: INSERT ... ON CONFLICT DO NOTHING then SELECT, inside one transaction', async () => {
    const { db, calls, queueRows } = createFakeDb();
    queueRows([{ run_id: BASE_PLAN.runId }]); // INSERT ... RETURNING run_id
    queueRows([runRow()]); // SELECT
    const ledger = createRunLedger(db);

    const { run, created } = await ledger.reserveRun({ actorId: 'actor-1', idempotencyKey: 'key-1', plan: BASE_PLAN });

    expect(created).toBe(true);
    expect(run.runId).toBe(BASE_PLAN.runId);
    expect(calls).toHaveLength(2);
    expect(calls[0].text).toContain('INSERT INTO test_request_runs');
    expect(calls[0].text).toContain('ON CONFLICT (actor_id, idempotency_key) DO NOTHING');
    expect(calls[0].text).toContain('$1::uuid');
    expect(calls[1].text).toContain('SELECT * FROM test_request_runs WHERE actor_id');
  });

  it('a same-key retry returns the SAME destination GUIDs as the first reservation, not the retry payload', async () => {
    const { db, queueRows } = createFakeDb();
    // Retry: INSERT is a no-op (ON CONFLICT DO NOTHING => no rows returned).
    queueRows([]);
    // SELECT reads back the FIRST attempt's row, with its own destination GUIDs.
    const firstAttemptDestinationRequestId = '99999999-9999-9999-9999-999999999999';
    const firstAttemptDestinationLocationId = '88888888-8888-8888-8888-888888888888';
    queueRows([runRow({
      destination_request_id: firstAttemptDestinationRequestId,
      destination_location_id: firstAttemptDestinationLocationId,
    })]);
    const ledger = createRunLedger(db);

    // Retry payload claims DIFFERENT destination GUIDs than the stored row
    // (simulating a caller bug in deterministic derivation); the ledger must
    // still return the stored ones, never the retry's.
    const retryPlan = {
      ...BASE_PLAN,
      destinationRequestId: '00000000-0000-0000-0000-000000000001',
      destinationLocationId: '00000000-0000-0000-0000-000000000002',
    };
    const { run, created } = await ledger.reserveRun({ actorId: 'actor-1', idempotencyKey: 'key-1', plan: retryPlan });

    expect(created).toBe(false);
    expect(run.destinationRequestId).toBe(firstAttemptDestinationRequestId);
    expect(run.destinationLocationId).toBe(firstAttemptDestinationLocationId);
  });

  it('throws a 409 test_request_run_conflict when a differing plan digest reuses the key', async () => {
    const { db, queueRows } = createFakeDb();
    queueRows([]); // INSERT no-op
    queueRows([runRow({ plan_digest: 'digest-a' })]); // stored row has a different digest
    const ledger = createRunLedger(db);

    await expect(ledger.reserveRun({
      actorId: 'actor-1',
      idempotencyKey: 'key-1',
      plan: { ...BASE_PLAN, planDigest: 'digest-b' },
    })).rejects.toMatchObject({ httpStatus: 409, code: 'test_request_run_conflict' });
  });
});

describe('claimLease', () => {
  it('returns null on zero rows without throwing (fence miss)', async () => {
    const { db, queueRows } = createFakeDb();
    queueRows([]);
    const ledger = createRunLedger(db);
    const result = await ledger.claimLease({ runId: BASE_PLAN.runId, expectedVersion: 1 });
    expect(result).toBeNull();
  });

  it('carries the version fence predicate and generates its own lease token', async () => {
    const { db, calls, queueRows } = createFakeDb();
    queueRows([runRow({ lease_token: 'tok-1', lease_generation: 1, version: 2 })]);
    const ledger = createRunLedger(db);
    const result = await ledger.claimLease({ runId: BASE_PLAN.runId, expectedVersion: 1 });

    expect(result).not.toBeNull();
    expect(calls[0].text).toContain('version = $4::integer');
    expect(calls[0].text).toContain('lease_token = $2::uuid');
    expect(calls[0].text).toContain('lease_generation = lease_generation + 1');
    expect(calls[0].text).toContain('locked_until IS NULL OR locked_until < NOW()');
    // A fresh v4 UUID was generated for this claim.
    expect(calls[0].params[1]).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('renewLease / releaseLease fence predicates', () => {
  it('renewLease is fenced on lease_token AND lease_generation', async () => {
    const { db, calls, queueRows } = createFakeDb();
    queueRows([runRow()]);
    const ledger = createRunLedger(db);
    await ledger.renewLease({ runId: BASE_PLAN.runId, leaseToken: 'tok-1', leaseGeneration: 1 });
    expect(calls[0].text).toContain('lease_token = $2::uuid');
    expect(calls[0].text).toContain('lease_generation = $3::integer');
  });

  it('releaseLease is fenced on lease_token AND lease_generation', async () => {
    const { db, calls, queueRows } = createFakeDb();
    queueRows([runRow()]);
    const ledger = createRunLedger(db);
    await ledger.releaseLease({ runId: BASE_PLAN.runId, leaseToken: 'tok-1', leaseGeneration: 1 });
    expect(calls[0].text).toContain('lease_token = $2::uuid');
    expect(calls[0].text).toContain('lease_generation = $3::integer');
  });
});

describe('advanceStep / markReady / markNeedsAttention / recordError share the full fence', () => {
  const ops = [
    ['advanceStep', (ledger) => ledger.advanceStep({
      runId: BASE_PLAN.runId, leaseToken: 'tok-1', leaseGeneration: 1, expectedVersion: 2,
      nextStep: 'create_request', nextStepIndex: 1,
    })],
    ['markReady', (ledger) => ledger.markReady({
      runId: BASE_PLAN.runId, leaseToken: 'tok-1', leaseGeneration: 1, expectedVersion: 2,
    })],
    ['markNeedsAttention', (ledger) => ledger.markNeedsAttention({
      runId: BASE_PLAN.runId, leaseToken: 'tok-1', leaseGeneration: 1, expectedVersion: 2, reason: 'stuck',
    })],
    ['recordError', (ledger) => ledger.recordError({
      runId: BASE_PLAN.runId, leaseToken: 'tok-1', leaseGeneration: 1, expectedVersion: 2, error: new Error('boom'),
    })],
  ];

  it.each(ops)('%s carries version, lease_token, lease_generation, and locked_until predicates', async (_name, invoke) => {
    const { db, calls, queueRows } = createFakeDb();
    queueRows([runRow()]);
    const ledger = createRunLedger(db);
    await invoke(ledger);
    expect(calls[0].text).toContain('version = $4::integer');
    expect(calls[0].text).toContain('lease_token = $2::uuid');
    expect(calls[0].text).toContain('lease_generation = $3::integer');
    expect(calls[0].text).toContain('locked_until > NOW()');
  });

  it('returns null (no throw) on a fence miss', async () => {
    const { db, queueRows } = createFakeDb();
    queueRows([]);
    const ledger = createRunLedger(db);
    const result = await ledger.advanceStep({
      runId: BASE_PLAN.runId, leaseToken: 'tok-1', leaseGeneration: 1, expectedVersion: 2,
      nextStep: 'create_request', nextStepIndex: 1,
    });
    expect(result).toBeNull();
  });
});

describe('advanceStep status guard and markReady terminal clearing', () => {
  it.each(['ready', 'needs_attention', 'retiring', 'retired', 'prepared'])(
    'advanceStep refuses status %s without issuing SQL',
    async (status) => {
      const { db, calls } = createFakeDb();
      const ledger = createRunLedger(db);
      await expect(ledger.advanceStep({
        runId: BASE_PLAN.runId, leaseToken: 'tok-1', leaseGeneration: 1, expectedVersion: 2,
        nextStep: 'x', nextStepIndex: 1, status,
      })).rejects.toMatchObject({ httpStatus: 400, code: 'test_request_run_invalid_status' });
      expect(calls).toHaveLength(0);
    },
  );

  it('advanceStep clears needs_attention_reason when the resulting status is not needs_attention', async () => {
    const { db, calls, queueRows } = createFakeDb();
    queueRows([runRow()]);
    const ledger = createRunLedger(db);
    await ledger.advanceStep({
      runId: BASE_PLAN.runId, leaseToken: 'tok-1', leaseGeneration: 1, expectedVersion: 2,
      nextStep: 'provision', nextStepIndex: 2, status: 'creating',
    });
    expect(calls[0].text).toMatch(/needs_attention_reason = CASE\s+WHEN COALESCE\(\$7::text, status\) = 'needs_attention' THEN needs_attention_reason\s+ELSE NULL/);
    expect(calls[0].params[6]).toBe('creating');
  });

  it('markReady clears needs_attention_reason and the lease (terminal transition)', async () => {
    const { db, calls, queueRows } = createFakeDb();
    queueRows([runRow()]);
    const ledger = createRunLedger(db);
    await ledger.markReady({ runId: BASE_PLAN.runId, leaseToken: 'tok-1', leaseGeneration: 1, expectedVersion: 2 });
    expect(calls[0].text).toContain('needs_attention_reason = NULL');
    expect(calls[0].text).toContain('lease_token = NULL');
    expect(calls[0].text).toContain('locked_until = NULL');
  });
});

describe('journalPlannedResource', () => {
  it('refuses when the run-row fence check returns no row', async () => {
    const { db, queueRows } = createFakeDb();
    queueRows([]); // SELECT ... FOR UPDATE finds nothing
    const ledger = createRunLedger(db);

    await expect(ledger.journalPlannedResource({
      runId: BASE_PLAN.runId, leaseToken: 'tok-1', leaseGeneration: 1,
      step: 'create_request', resourceKind: 'dataverse_request', system: 'dataverse',
      plannedIdentity: { requestId: BASE_PLAN.destinationRequestId },
    })).rejects.toMatchObject({ code: 'test_request_run_not_found', httpStatus: 404 });
  });

  it('refuses when the fenced run row has a stale lease token/generation', async () => {
    const { db, queueRows } = createFakeDb();
    queueRows([runRow({ lease_token: 'tok-OLD', lease_generation: 1, locked_until: new Date(Date.now() + 60000).toISOString(), lease_live: true })]);
    const ledger = createRunLedger(db);

    await expect(ledger.journalPlannedResource({
      runId: BASE_PLAN.runId, leaseToken: 'tok-NEW', leaseGeneration: 2,
      step: 'create_request', resourceKind: 'dataverse_request', system: 'dataverse',
      plannedIdentity: { requestId: BASE_PLAN.destinationRequestId },
    })).rejects.toMatchObject({ code: 'test_request_run_fenced', httpStatus: 409 });
  });

  it('refuses when the database reports the lease expired even if the token matches', async () => {
    const { db, calls, queueRows } = createFakeDb();
    queueRows([runRow({ lease_token: 'tok-1', lease_generation: 1, locked_until: new Date(Date.now() + 60000).toISOString(), lease_live: false })]);
    const ledger = createRunLedger(db);

    await expect(ledger.journalPlannedResource({
      runId: BASE_PLAN.runId, leaseToken: 'tok-1', leaseGeneration: 1,
      step: 'create_request', resourceKind: 'dataverse_request', system: 'dataverse',
      plannedIdentity: { requestId: BASE_PLAN.destinationRequestId },
    })).rejects.toMatchObject({ code: 'test_request_run_fenced', httpStatus: 409 });
    expect(calls[0].text).toContain('locked_until > NOW()) AS lease_live');
  });

  it('computes the next sequence and inserts once the fence holds', async () => {
    const { db, calls, queueRows } = createFakeDb();
    queueRows([runRow({ lease_token: 'tok-1', lease_generation: 1, locked_until: new Date(Date.now() + 60000).toISOString(), lease_live: true })]);
    queueRows([{ next_sequence: 3 }]);
    queueRows([{ resource_id: 7, run_id: BASE_PLAN.runId, sequence: 3, step: 'create_request', resource_kind: 'dataverse_request', system: 'dataverse', planned_identity: {}, outcome: 'planned' }]);
    const ledger = createRunLedger(db);

    const resource = await ledger.journalPlannedResource({
      runId: BASE_PLAN.runId, leaseToken: 'tok-1', leaseGeneration: 1,
      step: 'create_request', resourceKind: 'dataverse_request', system: 'dataverse',
      plannedIdentity: { requestId: BASE_PLAN.destinationRequestId },
    });

    expect(resource.sequence).toBe(3);
    expect(calls[0].text).toContain('FOR UPDATE');
    expect(calls[1].text).not.toContain('FOR UPDATE'); // aggregate cannot lock; run row lock in calls[0] serializes
    expect(calls[2].text).toContain('INSERT INTO test_request_run_resources');
    expect(calls[2].params[1]).toBe(3);
  });
});
