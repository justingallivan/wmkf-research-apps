import {
  IA_ATTEMPT_MARKER_KEYS,
  LEDGER_REASON_CODES,
  LEDGER_RECEIPT_KEYS,
  LEDGER_RECIPES,
  LEDGER_STEPS,
  assertLedgerReceipt,
  assertReservePlan,
  cliActorId,
  createRunLedger,
  reviewerAddressSha256,
  sanitizeErrorMessage,
  stepOrThrow,
} from '../../lib/services/test-requests/run-ledger.js';

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
  sourceRequestNumber: '1003222',
  sourceRevision: 'rev-1',
  bundleSha256: 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb',
  bundleExportedAt: '2026-09-23T00:00:00.000Z',
  copyPolicyVersion: '1',
  copyPolicyDigest: '3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d',
  planDigest: '0649f282d35bcb0d7688e39055d04af4c9ee54ea8ec0c7758ec63f04844a39a8',
  createBodySha256: '2e7d2c03a9507ae265ecf5b5356885a53393a2029d241394997265a1a25aefc6',
  destinationEnvironment: 'sandbox',
  destinationDataverseHost: 'sandbox.crm.dynamics.com',
  destinationRequestId: '33333333-3333-3333-3333-333333333333',
  destinationLocationId: '44444444-4444-4444-4444-444444444444',
  expectedAppUserId: '55555555-5555-5555-5555-555555555555',
  expectedOrganizationId: '66666666-6666-6666-6666-666666666666',
  expectedGraphSiteId: 'appriver3651007194.sharepoint.com,48930e19-0000-4000-8000-000000000000,11111111-1111-4111-8111-111111111111',
  expectedGraphDriveId: 'b!GQ6TSC-650adweD3-KAAAAAAAAAAAA',
  fiscalYear: 'December 2026',
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

    const { run, created } = await ledger.reserveRun({ actorId: cliActorId('actor-1'), idempotencyKey: 'key-1', plan: BASE_PLAN });

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
    const { run, created } = await ledger.reserveRun({ actorId: cliActorId('actor-1'), idempotencyKey: 'key-1', plan: retryPlan });

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
      actorId: cliActorId('actor-1'),
      idempotencyKey: 'key-1',
      plan: { ...BASE_PLAN, planDigest: 'd921855e42ae1f28d6a612394ac4cf6902fde039bb6714ff3ea34e09a5ee84ce' },
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
      runId: BASE_PLAN.runId, leaseToken: 'tok-1', leaseGeneration: 1, expectedVersion: 2, reason: 'step_failed',
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
        nextStep: 'create_request', nextStepIndex: 1, status,
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
      nextStep: 'create_request', nextStepIndex: 2, status: 'creating',
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

describe('slice 6a: initial_assessment recipe token', () => {
  it('assertReservePlan accepts both basic and initial_assessment', () => {
    expect(assertReservePlan({
      actorId: cliActorId('actor-1'), idempotencyKey: 'key-1', plan: { ...BASE_PLAN, recipe: 'basic' },
    })).toBeTruthy();
    expect(assertReservePlan({
      actorId: cliActorId('actor-1'), idempotencyKey: 'key-1', plan: { ...BASE_PLAN, recipe: 'initial_assessment' },
    })).toBeTruthy();
  });

  it('rejects an unlisted recipe token', () => {
    expect(() => assertReservePlan({
      actorId: cliActorId('actor-1'), idempotencyKey: 'key-1', plan: { ...BASE_PLAN, recipe: 'initial_assessment_v2' },
    })).toThrow(/recipe is not an allowlisted value/);
  });
});

describe('slice 6a: new LEDGER_STEPS accepted, unknown steps still rejected', () => {
  it('accepts the three Initial Assessment steps', () => {
    for (const step of ['seed_initial_assessment', 'seed_initial_assessment_snapshot', 'verify_initial_assessment']) {
      expect(stepOrThrow(step)).toBe(step);
    }
  });

  it('rejects a step outside LEDGER_STEPS', () => {
    expect(() => stepOrThrow('seed_final_writeup')).toThrow(/not a member of LEDGER_STEPS/);
  });
});

describe('slice 6a: new resource kinds dataverse_request_document and foundation_baseline', () => {
  it.each(['dataverse_request_document', 'foundation_baseline'])('journals a %s resource once the fence holds', async (kind) => {
    const { db, calls, queueRows } = createFakeDb();
    queueRows([runRow({ recipe: 'initial_assessment', current_step: 'verify', lease_token: 'tok-1', lease_generation: 1, locked_until: new Date(Date.now() + 60000).toISOString(), lease_live: true })]);
    queueRows([{ next_sequence: 1 }]);
    queueRows([{ resource_id: 1, run_id: BASE_PLAN.runId, sequence: 1, step: 'verify', resource_kind: kind, system: 'dataverse', planned_identity: {}, outcome: 'planned' }]);
    const ledger = createRunLedger(db);

    const resource = await ledger.journalPlannedResource({
      runId: BASE_PLAN.runId, leaseToken: 'tok-1', leaseGeneration: 1,
      step: 'verify', resourceKind: kind, system: 'dataverse', plannedIdentity: {},
    });
    expect(resource.resourceKind).toBe(kind);
    expect(calls[2].text).toContain('INSERT INTO test_request_run_resources');
  });

  it('rejects an unlisted resource kind', async () => {
    const { db, queueRows } = createFakeDb();
    queueRows([runRow({ lease_token: 'tok-1', lease_generation: 1, locked_until: new Date(Date.now() + 60000).toISOString(), lease_live: true })]);
    const ledger = createRunLedger(db);
    await expect(ledger.journalPlannedResource({
      runId: BASE_PLAN.runId, leaseToken: 'tok-1', leaseGeneration: 1,
      step: 'verify', resourceKind: 'dataverse_request_document_v2', system: 'dataverse', plannedIdentity: {},
    })).rejects.toMatchObject({ code: 'test_request_ledger_unsafe_value' });
  });
});

describe('slice 6a: new reason codes accepted, malformed reasons still rejected', () => {
  it.each(['ia_claim_lost', 'ia_pointer_mismatch', 'ia_upload_ambiguous', 'ia_snapshot_stale', 'ia_verification_failed', 'recipe_step_not_built'])(
    'markNeedsAttention accepts %s as a reason before any SQL',
    async (reason) => {
      const { db, calls, queueRows } = createFakeDb();
      queueRows([runRow({ lease_token: 'tok-1', lease_generation: 1, locked_until: new Date(Date.now() + 60000).toISOString() })]);
      const ledger = createRunLedger(db);
      await ledger.markNeedsAttention({
        runId: BASE_PLAN.runId, leaseToken: 'tok-1', leaseGeneration: 1, expectedVersion: 1, reason,
      });
      expect(calls[0].params).toContain(reason);
    },
  );

  it('LEDGER_REASON_CODES contains every new Initial Assessment code', () => {
    for (const code of ['ia_claim_lost', 'ia_pointer_mismatch', 'ia_upload_ambiguous', 'ia_snapshot_stale', 'ia_verification_failed', 'recipe_step_not_built']) {
      expect(LEDGER_REASON_CODES).toContain(code);
    }
  });
});

describe('slice 6a: new receipt keys and their grammars', () => {
  it('accepts valid values for every new receipt key', () => {
    expect(assertLedgerReceipt({
      requestDocumentId: '11111111-1111-4111-8111-111111111111',
      sourceVersionId: '3.0',
      generationKey: 'a'.repeat(64),
      claimTokenSha256: 'b'.repeat(64),
      foundationBaselineSha256: 'c'.repeat(64),
    })).toBeTruthy();
  });

  it('rejects malformed or text-bearing values for every new receipt key', () => {
    const badValues = {
      requestDocumentId: 'not-a-guid',
      sourceVersionId: 'https://example.com/v1',
      generationKey: 'not-hex',
      claimTokenSha256: 'ghp_1234567890123456789012345678901234',
      foundationBaselineSha256: 'CONFIDENTIAL text value',
    };
    for (const [key, value] of Object.entries(badValues)) {
      expect(() => assertLedgerReceipt({ [key]: value })).toThrow(/Ledger receipt rejected/);
    }
  });

  it('LEDGER_RECEIPT_KEYS contains every new key', () => {
    for (const key of ['requestDocumentId', 'sourceVersionId', 'generationKey', 'claimTokenSha256', 'foundationBaselineSha256', 'bytesSha256']) {
      expect(LEDGER_RECEIPT_KEYS).toContain(key);
    }
  });
});

describe('slice 6a: IA attempt-marker timestamp keys', () => {
  it('each marker key is accepted as a generic <stem>At timestamp, and a non-timestamp value is rejected', () => {
    for (const key of IA_ATTEMPT_MARKER_KEYS) {
      expect(assertLedgerReceipt({ [key]: '2026-09-24T00:00:00.000Z' })).toBeTruthy();
      expect(() => assertLedgerReceipt({ [key]: 'not a timestamp' })).toThrow(/Ledger receipt rejected/);
    }
  });

  it('none of the marker keys needed a dedicated KEY_RULES entry (they are not in LEDGER_RECEIPT_KEYS)', () => {
    for (const key of IA_ATTEMPT_MARKER_KEYS) {
      expect(LEDGER_RECEIPT_KEYS).not.toContain(key);
    }
  });
});

describe('slice 6c-i: reviews recipe token', () => {
  it('LEDGER_RECIPES includes reviews alongside basic and initial_assessment', () => {
    expect(LEDGER_RECIPES).toEqual(['basic', 'initial_assessment', 'reviews']);
  });

  it('assertReservePlan accepts the reviews recipe', () => {
    expect(assertReservePlan({
      actorId: cliActorId('actor-1'), idempotencyKey: 'key-1', plan: { ...BASE_PLAN, recipe: 'reviews' },
    })).toBeTruthy();
  });
});

describe('slice 6c-i: new LEDGER_STEPS accepted', () => {
  it('accepts the four Reviews steps', () => {
    for (const step of ['seed_reviewers', 'copy_review_file', 'seed_review_answers', 'verify_reviews']) {
      expect(stepOrThrow(step)).toBe(step);
    }
  });
});

describe('slice 6c-i: new resource kinds', () => {
  it.each(['dataverse_potential_reviewer', 'dataverse_reviewer_suggestion', 'dataverse_review_answer_set'])(
    'journals a %s resource once the fence holds',
    async (kind) => {
      const { db, calls, queueRows } = createFakeDb();
      queueRows([runRow({ recipe: 'reviews', current_step: 'seed_reviewers', lease_token: 'tok-1', lease_generation: 1, locked_until: new Date(Date.now() + 60000).toISOString(), lease_live: true })]);
      queueRows([{ next_sequence: 1 }]);
      queueRows([{ resource_id: 1, run_id: BASE_PLAN.runId, sequence: 1, step: 'seed_reviewers', resource_kind: kind, system: 'dataverse', planned_identity: {}, outcome: 'planned' }]);
      const ledger = createRunLedger(db);
      const resource = await ledger.journalPlannedResource({
        runId: BASE_PLAN.runId, leaseToken: 'tok-1', leaseGeneration: 1,
        step: 'seed_reviewers', resourceKind: kind, system: 'dataverse', plannedIdentity: {},
      });
      expect(resource.resourceKind).toBe(kind);
      expect(calls[2].text).toContain('INSERT INTO test_request_run_resources');
    },
  );
});

describe('slice 6c-i: new reason codes accepted', () => {
  it.each([
    'reviewer_person_not_synthetic', 'reviewer_person_conflict', 'reviewer_person_provenance_mismatch',
    'reviewer_person_projection_drift', 'synthetic_reviewer_not_bindable', 'reviewer_suggestion_present_not_owned',
    'reviewer_answers_ambiguous', 'reviewer_source_changed', 'reviews_verification_failed',
  ])('markNeedsAttention accepts %s as a reason before any SQL', async (reason) => {
    const { db, calls, queueRows } = createFakeDb();
    queueRows([runRow({ lease_token: 'tok-1', lease_generation: 1, locked_until: new Date(Date.now() + 60000).toISOString() })]);
    const ledger = createRunLedger(db);
    await ledger.markNeedsAttention({
      runId: BASE_PLAN.runId, leaseToken: 'tok-1', leaseGeneration: 1, expectedVersion: 1, reason,
    });
    expect(calls[0].params).toContain(reason);
  });
});

describe('slice 6c-i: new receipt keys and their grammars', () => {
  it('accepts valid values for every new receipt key', () => {
    expect(assertLedgerReceipt({
      sourcePersonId: '11111111-1111-4111-8111-111111111111',
      destinationPersonId: '22222222-2222-4222-8222-222222222222',
      suggestionId: '33333333-3333-4333-8333-333333333333',
      addressSha256: 'a'.repeat(64),
      attestedDigest: 'b'.repeat(64),
      answerCount: 12,
      eTagBefore: '"12345"', eTagAfter: '"12346"',
      reviewForm: 'uploaded',
      folder: '1000340_5D54ABC57F744D23B4BE39599147E674/Reviewer_Uploads/jones_1a2b3c4d/attempt_' + 'a'.repeat(32),
      filename: 'Review_1.pdf',
    })).toBeTruthy();
    expect(assertLedgerReceipt({ filename: 'Review_2.docx' })).toBeTruthy();
    expect(assertLedgerReceipt({ filename: 'Review_1.doc' })).toBeTruthy();
    expect(assertLedgerReceipt({ folder: 'Reviewer_Uploads/1a2b3c4d/attempt_' + 'f'.repeat(32) })).toBeTruthy();
  });

  it('rejects malformed or unlisted values for every new receipt key', () => {
    const badValues = {
      sourcePersonId: 'not-a-guid',
      addressSha256: 'not-hex',
      attestedDigest: 'CONFIDENTIAL text value',
      reviewForm: 'in_progress',
      filename: 'Review_100.pdf',
      folder: 'Reviewer_Uploads/not-hex/attempt_' + 'g'.repeat(32),
    };
    for (const [key, value] of Object.entries(badValues)) {
      expect(() => assertLedgerReceipt({ [key]: value })).toThrow(/Ledger receipt rejected/);
    }
  });

  it('LEDGER_RECEIPT_KEYS contains every new key', () => {
    for (const key of [
      'sourcePersonId', 'destinationPersonId', 'suggestionId', 'addressSha256', 'attestedDigest',
      'answerCount', 'eTagBefore', 'eTagAfter', 'reviewForm',
    ]) {
      expect(LEDGER_RECEIPT_KEYS).toContain(key);
    }
  });
});

describe('slice 6c-i: reviewerAddressSha256', () => {
  it('normalizes (trim + lowercase) before hashing', () => {
    const a = reviewerAddressSha256('  Alice@Example.Test  ');
    const b = reviewerAddressSha256('alice@example.test');
    expect(a.address).toBe('alice@example.test');
    expect(a.addressSha256).toBe(b.addressSha256);
    expect(a.addressSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects a non-email-shaped or credential-shaped address', () => {
    expect(() => reviewerAddressSha256('not-an-email')).toThrow(/Ledger receipt rejected/);
    expect(() => reviewerAddressSha256('ghp_1234567890123456789012345678901234')).toThrow(/Ledger receipt rejected/);
  });
});

describe('slice 6c-i: reserveRun reviewer assignments (D-R2)', () => {
  const REVIEWS_PLAN = { ...BASE_PLAN, recipe: 'reviews' };
  const ASSIGNMENT_A = {
    sourcePersonId: '77777777-7777-4777-8777-777777777771',
    destinationPersonId: '88888888-8888-4888-8888-888888888881',
    reused: false,
    address: 'Reviewer.One@Example.Test',
  };
  const ASSIGNMENT_B = {
    sourcePersonId: '77777777-7777-4777-8777-777777777772',
    destinationPersonId: '88888888-8888-4888-8888-888888888882',
    reused: false,
    address: 'reviewer.two@example.test',
  };

  it('writes each assignment in the reservation transaction, normalized, on first reservation only', async () => {
    const { db, calls, queueRows } = createFakeDb();
    queueRows([{ run_id: REVIEWS_PLAN.runId }]); // INSERT run
    queueRows([runRow({ recipe: 'reviews', plan_digest: REVIEWS_PLAN.planDigest })]); // SELECT run
    queueRows([]); // INSERT assignment A
    queueRows([]); // INSERT assignment B
    const ledger = createRunLedger(db);

    const { created } = await ledger.reserveRun({
      actorId: cliActorId('actor-1'), idempotencyKey: 'key-1', plan: REVIEWS_PLAN,
      reviewerAssignments: [ASSIGNMENT_A, ASSIGNMENT_B],
    });

    expect(created).toBe(true);
    expect(calls).toHaveLength(4);
    expect(calls[2].text).toContain('INSERT INTO test_request_run_reviewer_assignments');
    expect(calls[2].params).toEqual([
      REVIEWS_PLAN.runId, 1, ASSIGNMENT_A.sourcePersonId.toLowerCase(), ASSIGNMENT_A.destinationPersonId.toLowerCase(),
      false, 'reviewer.one@example.test', expect.stringMatching(/^[0-9a-f]{64}$/),
    ]);
    expect(calls[3].params[1]).toBe(2); // sequence gapless in array order
  });

  it('a same-key retry never re-inserts assignments (immutable, no update path)', async () => {
    const { db, calls, queueRows } = createFakeDb();
    queueRows([]); // INSERT no-op (already reserved)
    queueRows([runRow({ recipe: 'reviews', plan_digest: REVIEWS_PLAN.planDigest })]); // SELECT existing row
    // SELECT stored assignments (P1-a): identical to the retry's own input,
    // so the independent ledger-side check passes.
    queueRows([{
      sequence: 1, source_person_id: ASSIGNMENT_A.sourcePersonId.toLowerCase(),
      address_sha256: reviewerAddressSha256(ASSIGNMENT_A.address).addressSha256,
    }]);
    const ledger = createRunLedger(db);

    const { created } = await ledger.reserveRun({
      actorId: cliActorId('actor-1'), idempotencyKey: 'key-1', plan: REVIEWS_PLAN,
      reviewerAssignments: [ASSIGNMENT_A],
    });

    expect(created).toBe(false);
    expect(calls).toHaveLength(3); // INSERT (no-op), SELECT run, SELECT stored assignments -- no INSERT INTO test_request_run_reviewer_assignments
  });

  it('P1-a: a same-key retry with a DIFFERENT address for the same source reviewer conflicts (ledger-side check, independent of plan_digest)', async () => {
    const { db, queueRows } = createFakeDb();
    queueRows([]); // INSERT no-op
    queueRows([runRow({ recipe: 'reviews', plan_digest: REVIEWS_PLAN.planDigest })]); // SELECT existing row
    queueRows([{
      sequence: 1, source_person_id: ASSIGNMENT_A.sourcePersonId.toLowerCase(),
      address_sha256: reviewerAddressSha256('a-different-address@example.test').addressSha256,
    }]);
    const ledger = createRunLedger(db);

    await expect(ledger.reserveRun({
      actorId: cliActorId('actor-1'), idempotencyKey: 'key-1', plan: REVIEWS_PLAN,
      reviewerAssignments: [ASSIGNMENT_A],
    })).rejects.toMatchObject({ httpStatus: 409, code: 'test_request_run_conflict' });
  });

  it('P1-a: a same-key retry with the pairing SWAPPED between two sources conflicts', async () => {
    const { db, queueRows } = createFakeDb();
    queueRows([]); // INSERT no-op
    queueRows([runRow({ recipe: 'reviews', plan_digest: REVIEWS_PLAN.planDigest })]);
    // Stored: A -> addr(A), B -> addr(B). Retry proposes A -> addr(B), B -> addr(A).
    queueRows([
      { sequence: 1, source_person_id: ASSIGNMENT_A.sourcePersonId.toLowerCase(), address_sha256: reviewerAddressSha256(ASSIGNMENT_A.address).addressSha256 },
      { sequence: 2, source_person_id: ASSIGNMENT_B.sourcePersonId.toLowerCase(), address_sha256: reviewerAddressSha256(ASSIGNMENT_B.address).addressSha256 },
    ]);
    const ledger = createRunLedger(db);

    await expect(ledger.reserveRun({
      actorId: cliActorId('actor-1'), idempotencyKey: 'key-1', plan: REVIEWS_PLAN,
      reviewerAssignments: [
        { ...ASSIGNMENT_A, address: ASSIGNMENT_B.address },
        { ...ASSIGNMENT_B, address: ASSIGNMENT_A.address },
      ],
    })).rejects.toMatchObject({ httpStatus: 409, code: 'test_request_run_conflict' });
  });

  it('P1-a: a same-key retry with a DIFFERENT assignment count conflicts', async () => {
    const { db, queueRows } = createFakeDb();
    queueRows([]); // INSERT no-op
    queueRows([runRow({ recipe: 'reviews', plan_digest: REVIEWS_PLAN.planDigest })]);
    queueRows([{
      sequence: 1, source_person_id: ASSIGNMENT_A.sourcePersonId.toLowerCase(),
      address_sha256: reviewerAddressSha256(ASSIGNMENT_A.address).addressSha256,
    }]);
    const ledger = createRunLedger(db);

    await expect(ledger.reserveRun({
      actorId: cliActorId('actor-1'), idempotencyKey: 'key-1', plan: REVIEWS_PLAN,
      reviewerAssignments: [ASSIGNMENT_A, ASSIGNMENT_B],
    })).rejects.toMatchObject({ httpStatus: 409, code: 'test_request_run_conflict' });
  });

  it('refuses a reviews reservation with zero assignments', async () => {
    const { db } = createFakeDb();
    const ledger = createRunLedger(db);
    await expect(ledger.reserveRun({
      actorId: cliActorId('actor-1'), idempotencyKey: 'key-1', plan: REVIEWS_PLAN, reviewerAssignments: [],
    })).rejects.toMatchObject({ code: 'test_request_ledger_unsafe_value' });
  });

  it('refuses two assignments that share the same (normalized) address', async () => {
    const { db } = createFakeDb();
    const ledger = createRunLedger(db);
    await expect(ledger.reserveRun({
      actorId: cliActorId('actor-1'), idempotencyKey: 'key-1', plan: REVIEWS_PLAN,
      reviewerAssignments: [ASSIGNMENT_A, { ...ASSIGNMENT_B, address: 'Reviewer.One@example.test' }],
    })).rejects.toMatchObject({ code: 'test_request_ledger_unsafe_value' });
  });

  it('refuses two assignments naming the same source reviewer', async () => {
    const { db } = createFakeDb();
    const ledger = createRunLedger(db);
    await expect(ledger.reserveRun({
      actorId: cliActorId('actor-1'), idempotencyKey: 'key-1', plan: REVIEWS_PLAN,
      reviewerAssignments: [ASSIGNMENT_A, { ...ASSIGNMENT_B, sourcePersonId: ASSIGNMENT_A.sourcePersonId }],
    })).rejects.toMatchObject({ code: 'test_request_ledger_unsafe_value' });
  });

  it('refuses an assignment with a missing/malformed address', async () => {
    const { db } = createFakeDb();
    const ledger = createRunLedger(db);
    await expect(ledger.reserveRun({
      actorId: cliActorId('actor-1'), idempotencyKey: 'key-1', plan: REVIEWS_PLAN,
      reviewerAssignments: [{ ...ASSIGNMENT_A, address: '' }],
    })).rejects.toMatchObject({ code: 'test_request_ledger_unsafe_value' });
  });

  it('refuses reviewerAssignments for a non-reviews recipe', async () => {
    const { db } = createFakeDb();
    const ledger = createRunLedger(db);
    await expect(ledger.reserveRun({
      actorId: cliActorId('actor-1'), idempotencyKey: 'key-1', plan: BASE_PLAN,
      reviewerAssignments: [ASSIGNMENT_A],
    })).rejects.toMatchObject({ code: 'test_request_ledger_unsafe_value' });
  });

  it('P2-c: refuses reused: true (the cross-run provenance check is not built until 6c-ii)', async () => {
    const { db } = createFakeDb();
    const ledger = createRunLedger(db);
    await expect(ledger.reserveRun({
      actorId: cliActorId('actor-1'), idempotencyKey: 'key-1', plan: REVIEWS_PLAN,
      reviewerAssignments: [{ ...ASSIGNMENT_A, reused: true }],
    })).rejects.toMatchObject({ code: 'test_request_ledger_unsafe_value', message: expect.stringContaining('6c-ii') });
  });
});

describe('slice 6c-i: listRunReviewerAssignments never selects the plaintext address (redaction)', () => {
  it('SELECTs only the digest column, never address, and the returned rows never carry it', async () => {
    const { db, calls, queueRows } = createFakeDb();
    queueRows([{
      sequence: 1, source_person_id: '77777777-7777-4777-8777-777777777771',
      destination_person_id: '88888888-8888-4888-8888-888888888881',
      reused: false, address_sha256: 'a'.repeat(64), created_at: '2026-09-25T00:00:00.000Z',
    }]);
    const ledger = createRunLedger(db);

    const rows = await ledger.listRunReviewerAssignments(BASE_PLAN.runId);

    expect(calls[0].text).toContain('SELECT sequence, source_person_id, destination_person_id, reused, address_sha256, created_at');
    expect(calls[0].text).not.toMatch(/,\s*address\s*,/);
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty('address');
    expect(rows[0].addressSha256).toBe('a'.repeat(64));
  });
});
