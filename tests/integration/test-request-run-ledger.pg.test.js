/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  assertLedgerReceipt, cliActorId, createRunLedger, idempotencyKeyDigest, reviewerAddressSha256,
} from '../../lib/services/test-requests/run-ledger.js';
import { pgLedgerDb } from '../../lib/services/test-requests/run-ledger-db.js';

// A GitHub-token-shaped fixture assembled at runtime so no token-shaped
// literal sits in the tracked tree (check:secret-scan); the value is unchanged.
const FAKE_GITHUB_TOKEN = ['ghp', '0123456789abcdefghijklmnopqrstuvwxyz'].join('_');

/**
 * Live-Postgres proof for the run ledger's concurrency/fencing contract.
 *
 * SKIPPED by default. Set TEST_REQUEST_LEDGER_TEST_URL to a scratch/local
 * Postgres database (NEVER the shared Production/Preview POSTGRES_URL) to
 * run it. This never touches Dataverse, Graph, Vercel, or the repo's
 * POSTGRES_URL.
 */
const TEST_URL = process.env.TEST_REQUEST_LEDGER_TEST_URL || '';
if (!TEST_URL && process.env.TEST_REQUEST_LEDGER_REQUIRE === '1') {
  // CI runs this suite against a PostgreSQL service and must never skip it.
  throw new Error('TEST_REQUEST_LEDGER_REQUIRE=1 but TEST_REQUEST_LEDGER_TEST_URL is unset.');
}
if (/neon\.tech/i.test(TEST_URL) || (process.env.POSTGRES_URL && TEST_URL === process.env.POSTGRES_URL)) {
  throw new Error('Refusing to run the ledger proof against the shared Production/Preview database.');
}
const describeIf = TEST_URL ? describe : describe.skip;

const MIGRATION_PATH = path.join(process.cwd(), 'lib/db/migrations/054_test_request_runs.sql');

/** Fail loudly when the throwaway ledger schema predates the migration file (constraints are created only with the tables). */
async function assertLedgerSchemaCurrent(db, migrationSql) {
  const expected = [...migrationSql.matchAll(/CONSTRAINT\s+(\w+)/g)].map((m) => m[1]);
  const { rows } = await db.query(
    `SELECT c.conname FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
       WHERE t.relname IN ('test_request_runs', 'test_request_run_resources', 'test_request_run_reviewer_assignments')`,
  );
  const present = new Set(rows.map((row) => row.conname));
  const missing = expected.filter((name) => !present.has(name));
  const fn = await db.query(`SELECT prosrc FROM pg_proc WHERE proname = 'test_request_receipt_ok'`);
  const normalize = (text) => String(text || '').replace(/\s+/g, ' ').trim();
  const expectedBody = normalize(migrationSql.slice(migrationSql.indexOf('$receipt$') + 9, migrationSql.indexOf('$receipt$;')));
  const liveBody = normalize(fn.rows[0]?.prosrc);
  if (liveBody !== expectedBody) missing.push('test_request_receipt_ok(jsonb) body differs from the migration');
  if (missing.length) {
    throw new Error(`Throwaway ledger schema is stale (${missing.join(', ')}); drop test_request_run_reviewer_assignments, test_request_run_resources, test_request_runs and test_request_receipt_ok(jsonb), then rerun.`);
  }
}

function basePlan(overrides = {}) {
  const runId = crypto.randomUUID();
  return {
    runId,
    recipe: 'basic',
    sourceDataverseHost: 'source.crm.dynamics.com',
    sourceRequestId: crypto.randomUUID(),
    sourceRequestNumber: '1003222',
    sourceRevision: 'rev-1',
    bundleSha256: 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb',
    bundleExportedAt: new Date().toISOString(),
    copyPolicyVersion: '1',
    copyPolicyDigest: '3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d',
    planDigest: '0649f282d35bcb0d7688e39055d04af4c9ee54ea8ec0c7758ec63f04844a39a8',
    createBodySha256: '2e7d2c03a9507ae265ecf5b5356885a53393a2029d241394997265a1a25aefc6',
    destinationEnvironment: 'sandbox',
    destinationDataverseHost: 'sandbox.crm.dynamics.com',
    destinationRequestId: crypto.randomUUID(),
    destinationLocationId: crypto.randomUUID(),
    expectedAppUserId: crypto.randomUUID(),
    expectedOrganizationId: crypto.randomUUID(),
    expectedGraphSiteId: 'appriver3651007194.sharepoint.com,48930e19-0000-4000-8000-000000000000,11111111-1111-4111-8111-111111111111',
    expectedGraphDriveId: 'b!GQ6TSC-650adweD3-KAAAAAAAAAAAA',
    fiscalYear: 'December 2026',
    meetingDate: '2026-10-01',
    testLabel: 'ZZTEST',
    ...overrides,
  };
}

describeIf('test_request_runs ledger (live Postgres proof)', () => {
  let db;
  let ledger;
  const createdRunIds = [];

  beforeAll(async () => {
    db = pgLedgerDb(TEST_URL);
    const { rows } = await db.query(
      `SELECT to_regclass('public.test_request_runs') AS reg`,
    );
    const migrationSql = fs.readFileSync(MIGRATION_PATH, 'utf8');
    if (!rows[0]?.reg) await db.query(migrationSql);
    await assertLedgerSchemaCurrent(db, migrationSql);
    ledger = createRunLedger(db);
  });

  afterAll(async () => {
    if (createdRunIds.length) {
      await db.query(
        `DELETE FROM test_request_run_reviewer_assignments WHERE run_id = ANY($1::uuid[])`,
        [createdRunIds],
      );
      await db.query(
        `DELETE FROM test_request_run_resources WHERE run_id = ANY($1::uuid[])`,
        [createdRunIds],
      );
      await db.query(
        `DELETE FROM test_request_runs WHERE run_id = ANY($1::uuid[])`,
        [createdRunIds],
      );
    }
    if (db.end) await db.end();
  });

  it('two concurrent reserveRun calls with the same key yield one row and the same destination GUIDs', async () => {
    const actorId = cliActorId(`actor-${crypto.randomUUID()}`);
    const idempotencyKey = 'key-concurrent';
    const plan = basePlan();
    createdRunIds.push(plan.runId);

    const [a, b] = await Promise.all([
      ledger.reserveRun({ actorId, idempotencyKey, plan }),
      ledger.reserveRun({ actorId, idempotencyKey, plan }),
    ]);

    expect(a.run.destinationRequestId).toBe(b.run.destinationRequestId);
    expect(a.run.destinationLocationId).toBe(b.run.destinationLocationId);
    expect([a.created, b.created].filter(Boolean)).toHaveLength(1);

    const { rows } = await db.query(
      `SELECT count(*)::int AS n, bool_and(idempotency_key = $2::text) AS hashed FROM test_request_runs WHERE actor_id = $1::text AND idempotency_key = $2::text`,
      [actorId, idempotencyKeyDigest(idempotencyKey)],
    );
    expect(rows[0].n).toBe(1);
    // The raw key text is never stored; only its SHA-256.
    const raw = await db.query(`SELECT count(*)::int AS n FROM test_request_runs WHERE idempotency_key = $1::text`, [idempotencyKey]);
    expect(raw.rows[0].n).toBe(0);
  });

  it('a differing plan digest on the same key returns 409', async () => {
    const actorId = cliActorId(`actor-${crypto.randomUUID()}`);
    const idempotencyKey = 'key-conflict';
    const plan = basePlan();
    createdRunIds.push(plan.runId);
    await ledger.reserveRun({ actorId, idempotencyKey, plan });

    await expect(ledger.reserveRun({
      actorId,
      idempotencyKey,
      plan: basePlan({ ...plan, runId: crypto.randomUUID(), planDigest: '933da5bc7f45ad93424e42d19e38986cc333b102d612b5849909517b4af073a3' }),
    })).rejects.toMatchObject({ httpStatus: 409, code: 'test_request_run_conflict' });
  });

  it('slice 6a: reserves both basic and initial_assessment runs', async () => {
    const actorId = cliActorId(`actor-${crypto.randomUUID()}`);
    const basicPlan = basePlan({ recipe: 'basic' });
    const iaPlan = basePlan({ recipe: 'initial_assessment' });
    createdRunIds.push(basicPlan.runId, iaPlan.runId);

    const { run: basicRun } = await ledger.reserveRun({ actorId, idempotencyKey: 'key-recipe-basic', plan: basicPlan });
    const { run: iaRun } = await ledger.reserveRun({ actorId, idempotencyKey: 'key-recipe-ia', plan: iaPlan });

    expect(basicRun.recipe).toBe('basic');
    expect(iaRun.recipe).toBe('initial_assessment');
  });

  it("slice 6a: a same idempotency key reserved under a different recipe is a conflict, not a return of the first run (mirrors runReserve's planDigest, which includes recipe)", async () => {
    const actorId = cliActorId(`actor-${crypto.randomUUID()}`);
    const idempotencyKey = 'key-cross-recipe';
    const shared = basePlan();
    const basicPlan = { ...shared, recipe: 'basic', planDigest: '1'.repeat(64) };
    const iaPlan = { ...shared, recipe: 'initial_assessment', planDigest: '2'.repeat(64) };
    createdRunIds.push(shared.runId);

    const { run: firstRun, created } = await ledger.reserveRun({ actorId, idempotencyKey, plan: basicPlan });
    expect(created).toBe(true);
    expect(firstRun.recipe).toBe('basic');

    await expect(ledger.reserveRun({ actorId, idempotencyKey, plan: iaPlan }))
      .rejects.toMatchObject({ httpStatus: 409, code: 'test_request_run_conflict' });

    // The stored row is unchanged: still the first (basic) reservation.
    const stillBasic = await ledger.getRun(firstRun.runId);
    expect(stillBasic.recipe).toBe('basic');
  });

  it('slice 6c-i: reserves a reviews run with real reviewer assignment rows, and inspect never reads back the plaintext address', async () => {
    const actorId = cliActorId(`actor-${crypto.randomUUID()}`);
    const plan = basePlan({ recipe: 'reviews', planDigest: crypto.randomUUID().replace(/-/g, '').padEnd(64, '0') });
    createdRunIds.push(plan.runId);
    const reviewerAssignments = [
      { sourcePersonId: crypto.randomUUID(), destinationPersonId: crypto.randomUUID(), reused: false, address: 'Reviewer.One@Example.Test' },
      { sourcePersonId: crypto.randomUUID(), destinationPersonId: crypto.randomUUID(), reused: false, address: 'reviewer.two@example.test' },
    ];

    const { run, created } = await ledger.reserveRun({ actorId, idempotencyKey: `key-reviews-${plan.runId}`, plan, reviewerAssignments });
    expect(created).toBe(true);
    expect(run.recipe).toBe('reviews');

    const assignments = await ledger.listRunReviewerAssignments(run.runId);
    expect(assignments).toHaveLength(2);
    expect(assignments.map((a) => a.sequence)).toEqual([1, 2]);
    expect(assignments[0].addressSha256).toBe(reviewerAddressSha256('reviewer.one@example.test').addressSha256);
    for (const assignment of assignments) {
      expect(assignment).not.toHaveProperty('address');
    }

    // A same-key retry never re-inserts (immutable, no update path).
    const retry = await ledger.reserveRun({ actorId, idempotencyKey: `key-reviews-${plan.runId}`, plan, reviewerAssignments });
    expect(retry.created).toBe(false);
    expect(await ledger.listRunReviewerAssignments(run.runId)).toHaveLength(2);
  });

  it('slice 6c-i: the DB UNIQUE constraint on (run, address) rejects a direct duplicate insert bypassing the JS validator', async () => {
    const actorId = cliActorId(`actor-${crypto.randomUUID()}`);
    const plan = basePlan({ recipe: 'reviews', planDigest: crypto.randomUUID().replace(/-/g, '').padEnd(64, '1') });
    createdRunIds.push(plan.runId);
    await ledger.reserveRun({
      actorId, idempotencyKey: `key-reviews-dup-${plan.runId}`, plan,
      reviewerAssignments: [{ sourcePersonId: crypto.randomUUID(), destinationPersonId: crypto.randomUUID(), reused: false, address: 'dup@example.test' }],
    });
    await expect(db.query(
      `INSERT INTO test_request_run_reviewer_assignments (run_id, sequence, source_person_id, destination_person_id, reused, address, address_sha256)
       VALUES ($1::uuid, 2, $2::uuid, $3::uuid, false, 'dup@example.test', $4::text)`,
      [plan.runId, crypto.randomUUID(), crypto.randomUUID(), reviewerAddressSha256('dup@example.test').addressSha256],
    )).rejects.toThrow();
  });

  it('P3: the DB CHECK ties address_sha256 to address -- a mismatched digest is rejected even though both columns are independently well-shaped', async () => {
    const actorId = cliActorId(`actor-${crypto.randomUUID()}`);
    const plan = basePlan({ recipe: 'reviews', planDigest: crypto.randomUUID().replace(/-/g, '').padEnd(64, '2') });
    createdRunIds.push(plan.runId);
    await ledger.reserveRun({
      actorId, idempotencyKey: `key-reviews-digest-mismatch-${plan.runId}`, plan,
      reviewerAssignments: [{ sourcePersonId: crypto.randomUUID(), destinationPersonId: crypto.randomUUID(), reused: false, address: 'mismatch@example.test' }],
    });
    await expect(db.query(
      `INSERT INTO test_request_run_reviewer_assignments (run_id, sequence, source_person_id, destination_person_id, reused, address, address_sha256)
       VALUES ($1::uuid, 2, $2::uuid, $3::uuid, false, 'a-second-address@example.test', $4::text)`,
      // A well-shaped 64-hex digest that is simply the WRONG hash of the address.
      [plan.runId, crypto.randomUUID(), crypto.randomUUID(), reviewerAddressSha256('someone-else@example.test').addressSha256],
    )).rejects.toThrow();
  });

  it('claimLease succeeds once; a second claim with the stale version returns null', async () => {
    const actorId = cliActorId(`actor-${crypto.randomUUID()}`);
    const plan = basePlan();
    createdRunIds.push(plan.runId);
    const { run } = await ledger.reserveRun({ actorId, idempotencyKey: 'key-claim', plan });

    const claimed = await ledger.claimLease({ runId: run.runId, expectedVersion: run.version });
    expect(claimed).not.toBeNull();

    const staleClaim = await ledger.claimLease({ runId: run.runId, expectedVersion: run.version });
    expect(staleClaim).toBeNull();
  });

  it('a stale (older generation) token cannot advanceStep or journal a resource', async () => {
    const actorId = cliActorId(`actor-${crypto.randomUUID()}`);
    const plan = basePlan();
    createdRunIds.push(plan.runId);
    const { run } = await ledger.reserveRun({ actorId, idempotencyKey: 'key-stale-gen', plan });

    const firstClaim = await ledger.claimLease({ runId: run.runId, expectedVersion: run.version });
    // Force the lease to look expired so a second worker can reclaim it and bump the generation.
    await db.query(
      `UPDATE test_request_runs SET locked_until = NOW() - interval '1 minute' WHERE run_id = $1::uuid`,
      [run.runId],
    );
    const secondClaim = await ledger.claimLease({ runId: run.runId, expectedVersion: firstClaim.version });
    expect(secondClaim.leaseGeneration).toBeGreaterThan(firstClaim.leaseGeneration);

    const staleAdvance = await ledger.advanceStep({
      runId: run.runId,
      leaseToken: firstClaim.leaseToken,
      leaseGeneration: firstClaim.leaseGeneration,
      expectedVersion: secondClaim.version,
      nextStep: 'create_request',
      nextStepIndex: 1,
    });
    expect(staleAdvance).toBeNull();

    await expect(ledger.journalPlannedResource({
      runId: run.runId,
      leaseToken: firstClaim.leaseToken,
      leaseGeneration: firstClaim.leaseGeneration,
      step: 'create_request',
      resourceKind: 'dataverse_request',
      system: 'dataverse',
      plannedIdentity: { requestId: plan.destinationRequestId },
    })).rejects.toMatchObject({ code: 'test_request_run_fenced' });
  });

  it('an expired lease can be re-claimed, and the new generation fences the old worker', async () => {
    const actorId = cliActorId(`actor-${crypto.randomUUID()}`);
    const plan = basePlan();
    createdRunIds.push(plan.runId);
    const { run } = await ledger.reserveRun({ actorId, idempotencyKey: 'key-expiry', plan });

    const claim = await ledger.claimLease({ runId: run.runId, expectedVersion: run.version, leaseSeconds: 30 });
    await db.query(
      `UPDATE test_request_runs SET locked_until = NOW() - interval '1 second' WHERE run_id = $1::uuid`,
      [run.runId],
    );
    const reclaim = await ledger.claimLease({ runId: run.runId, expectedVersion: claim.version });
    expect(reclaim).not.toBeNull();
    expect(reclaim.leaseGeneration).toBe(claim.leaseGeneration + 1);
  });

  it('resource sequence is gapless and unique under concurrent journal calls', async () => {
    const actorId = cliActorId(`actor-${crypto.randomUUID()}`);
    const plan = basePlan();
    createdRunIds.push(plan.runId);
    const { run } = await ledger.reserveRun({ actorId, idempotencyKey: 'key-sequence', plan });
    const claim = await ledger.claimLease({ runId: run.runId, expectedVersion: run.version });

    const journalOne = () => ledger.journalPlannedResource({
      runId: run.runId,
      leaseToken: claim.leaseToken,
      leaseGeneration: claim.leaseGeneration,
      step: 'provision_location',
      resourceKind: 'sharepoint_folder',
      system: 'sharepoint',
      plannedIdentity: { folder: `1000999_${crypto.randomUUID().replace(/-/g, '').toUpperCase()}` },
    });

    const results = await Promise.all([journalOne(), journalOne(), journalOne()]);
    const sequences = results.map((r) => r.sequence).sort((a, b) => a - b);
    expect(sequences).toEqual([1, 2, 3]);
  });

  it('a needs_attention run can be re-claimed and resumed; the reason clears on leaving needs_attention', async () => {
    const actorId = cliActorId(`actor-${crypto.randomUUID()}`);
    const plan = basePlan();
    createdRunIds.push(plan.runId);
    const { run } = await ledger.reserveRun({ actorId, idempotencyKey: 'key-resume', plan });

    const first = await ledger.claimLease({ runId: run.runId, expectedVersion: run.version });
    const creating = await ledger.advanceStep({
      runId: run.runId, leaseToken: first.leaseToken, leaseGeneration: first.leaseGeneration,
      expectedVersion: first.version, nextStep: 'create_request', nextStepIndex: 1, status: 'creating',
    });
    const stuck = await ledger.markNeedsAttention({
      runId: run.runId, leaseToken: first.leaseToken, leaseGeneration: first.leaseGeneration,
      expectedVersion: creating.version, reason: 'ambiguous_create_outcome',
    });
    expect(stuck.status).toBe('needs_attention');
    await ledger.releaseLease({ runId: run.runId, leaseToken: first.leaseToken, leaseGeneration: first.leaseGeneration });

    const resumed = await ledger.claimLease({ runId: run.runId, expectedVersion: stuck.version });
    expect(resumed).not.toBeNull();
    const advanced = await ledger.advanceStep({
      runId: run.runId, leaseToken: resumed.leaseToken, leaseGeneration: resumed.leaseGeneration,
      expectedVersion: resumed.version, nextStep: 'create_request', nextStepIndex: 2, status: 'creating',
    });
    expect(advanced).not.toBeNull();
    expect(advanced.status).toBe('creating');
    expect(advanced.needsAttentionReason).toBeNull();

    // A needs_attention run can also be verified straight to ready after resume.
    const stuckAgain = await ledger.markNeedsAttention({
      runId: run.runId, leaseToken: resumed.leaseToken, leaseGeneration: resumed.leaseGeneration,
      expectedVersion: advanced.version, reason: 'step_failed',
    });
    // markNeedsAttention releases the lease so Resume is not held to expiry;
    // the old token is now a fence miss and a new claim is required.
    expect(stuckAgain.leaseToken).toBeNull();
    expect(stuckAgain.lockedUntil).toBeNull();
    expect(await ledger.markReady({
      runId: run.runId, leaseToken: resumed.leaseToken, leaseGeneration: resumed.leaseGeneration,
      expectedVersion: stuckAgain.version, destinationRequestNumber: '1000999',
    })).toBeNull();
    const reclaimed = await ledger.claimLease({ runId: run.runId, expectedVersion: stuckAgain.version });
    expect(reclaimed).not.toBeNull();
    const ready = await ledger.markReady({
      runId: run.runId, leaseToken: reclaimed.leaseToken, leaseGeneration: reclaimed.leaseGeneration,
      expectedVersion: reclaimed.version, destinationRequestNumber: '1000999',
    });
    expect(ready).not.toBeNull();
    expect(ready.status).toBe('ready');
    expect(ready.needsAttentionReason).toBeNull();
    expect(ready.completedAt).not.toBeNull();
    // Terminal transition clears the lease (scheduled-email-store convention),
    // so the finished worker can no longer mutate the run.
    expect(ready.leaseToken).toBeNull();
    expect(ready.lockedUntil).toBeNull();
    const lateAdvance = await ledger.advanceStep({
      runId: run.runId, leaseToken: resumed.leaseToken, leaseGeneration: resumed.leaseGeneration,
      expectedVersion: ready.version, nextStep: 'verify', nextStepIndex: 3,
    });
    expect(lateAdvance).toBeNull();
  });

  it('the generation fence alone rejects a worker whose token still matches but generation is stale', async () => {
    const actorId = cliActorId(`actor-${crypto.randomUUID()}`);
    const plan = basePlan();
    createdRunIds.push(plan.runId);
    const { run } = await ledger.reserveRun({ actorId, idempotencyKey: 'key-generation-only', plan });
    const claim = await ledger.claimLease({ runId: run.runId, expectedVersion: run.version });
    // Same token, bumped generation: only lease_generation can discriminate.
    await db.query(
      `UPDATE test_request_runs SET lease_generation = lease_generation + 1 WHERE run_id = $1::uuid`,
      [run.runId],
    );

    const advance = await ledger.advanceStep({
      runId: run.runId, leaseToken: claim.leaseToken, leaseGeneration: claim.leaseGeneration,
      expectedVersion: claim.version, nextStep: 'create_request', nextStepIndex: 1,
    });
    expect(advance).toBeNull();
    const renew = await ledger.renewLease({
      runId: run.runId, leaseToken: claim.leaseToken, leaseGeneration: claim.leaseGeneration,
    });
    expect(renew).toBeNull();
    await expect(ledger.journalPlannedResource({
      runId: run.runId, leaseToken: claim.leaseToken, leaseGeneration: claim.leaseGeneration,
      step: 'create_request', resourceKind: 'dataverse_request', system: 'dataverse',
      plannedIdentity: { requestId: plan.destinationRequestId },
    })).rejects.toMatchObject({ code: 'test_request_run_fenced' });
  });

  it('an expired lease (same token and generation, nobody reclaimed) cannot journal a resource', async () => {
    const actorId = cliActorId(`actor-${crypto.randomUUID()}`);
    const plan = basePlan();
    createdRunIds.push(plan.runId);
    const { run } = await ledger.reserveRun({ actorId, idempotencyKey: 'key-expired-journal', plan });
    const claim = await ledger.claimLease({ runId: run.runId, expectedVersion: run.version });
    await db.query(
      `UPDATE test_request_runs SET locked_until = NOW() - interval '1 second' WHERE run_id = $1::uuid`,
      [run.runId],
    );
    await expect(ledger.journalPlannedResource({
      runId: run.runId, leaseToken: claim.leaseToken, leaseGeneration: claim.leaseGeneration,
      step: 'create_request', resourceKind: 'dataverse_request', system: 'dataverse',
      plannedIdentity: { requestId: plan.destinationRequestId },
    })).rejects.toMatchObject({ code: 'test_request_run_fenced' });
  });

  it('the completed_at constraint admits ready -> retiring -> retired and needs_attention -> retiring', async () => {
    const actorId = cliActorId(`actor-${crypto.randomUUID()}`);
    const readyPlan = basePlan();
    const stuckPlan = basePlan();
    createdRunIds.push(readyPlan.runId, stuckPlan.runId);
    const { run: readyRun } = await ledger.reserveRun({ actorId, idempotencyKey: 'key-retire-ready', plan: readyPlan });
    const { run: stuckRun } = await ledger.reserveRun({ actorId, idempotencyKey: 'key-retire-stuck', plan: stuckPlan });

    // ready requires a well-formed destination number (CHECKs test_request_runs_ready_request_number / _request_number_shape).
    await expect(db.query(`UPDATE test_request_runs SET status = 'ready', completed_at = NOW() WHERE run_id = $1::uuid`, [readyRun.runId])).rejects.toThrow();
    await expect(db.query(`UPDATE test_request_runs SET destination_request_number = 'abc' WHERE run_id = $1::uuid`, [readyRun.runId])).rejects.toThrow();
    await expect(db.query(`UPDATE test_request_runs SET destination_request_number = '' WHERE run_id = $1::uuid`, [readyRun.runId])).rejects.toThrow();
    await db.query(`UPDATE test_request_runs SET status = 'ready', completed_at = NOW(), destination_request_number = '1000999' WHERE run_id = $1::uuid`, [readyRun.runId]);
    await db.query(`UPDATE test_request_runs SET status = 'retiring' WHERE run_id = $1::uuid`, [readyRun.runId]);
    await db.query(`UPDATE test_request_runs SET status = 'retired' WHERE run_id = $1::uuid`, [readyRun.runId]);

    await db.query(`UPDATE test_request_runs SET status = 'needs_attention', needs_attention_reason = 'operator_stop' WHERE run_id = $1::uuid`, [stuckRun.runId]);
    await db.query(`UPDATE test_request_runs SET status = 'retiring', needs_attention_reason = NULL WHERE run_id = $1::uuid`, [stuckRun.runId]);

    // Still enforced: ready requires completed_at; pre-terminal states forbid it.
    await expect(db.query(`UPDATE test_request_runs SET status = 'ready', completed_at = NULL WHERE run_id = $1::uuid`, [stuckRun.runId])).rejects.toThrow();
    await expect(db.query(`UPDATE test_request_runs SET status = 'creating', completed_at = NOW() WHERE run_id = $1::uuid`, [stuckRun.runId])).rejects.toThrow();
  });

  it('direct SQL writes that bypass the JS validators are rejected by the CHECK constraints', async () => {
    const actorId = cliActorId(`actor-${crypto.randomUUID()}`);
    const plan = basePlan();
    createdRunIds.push(plan.runId);
    await ledger.reserveRun({ actorId, idempotencyKey: 'key-sql-check', plan });
    const attempts = [
      [`UPDATE test_request_runs SET expected_graph_drive_id = $2 WHERE run_id = $1`, 'https://contoso.sharepoint.com/sites/x'],
      [`UPDATE test_request_runs SET expected_graph_site_id = $2 WHERE run_id = $1`, FAKE_GITHUB_TOKEN],
      [`UPDATE test_request_runs SET expected_graph_drive_id = $2 WHERE run_id = $1`, 'b!AAAAAAAAAAAAAAAAgithub_pat_11AAAAAAA0123456789'],
      [`UPDATE test_request_runs SET actor_id = $2 WHERE run_id = $1`, 'cli:hunter2'],
      [`UPDATE test_request_runs SET idempotency_key = $2 WHERE run_id = $1`, 'my-secret-codename'],
      [`UPDATE test_request_runs SET last_error = $2 WHERE run_id = $1`, 'Authorization: Bearer abc'],
      [`UPDATE test_request_runs SET test_label = $2 WHERE run_id = $1`, 'Confidential proposal for Acme'],
      [`UPDATE test_request_runs SET current_step = $2 WHERE run_id = $1`, 'exfiltrate'],
      [`UPDATE test_request_runs SET source_dataverse_host = $2 WHERE run_id = $1`, 'https://wmkf.crm.dynamics.com/'],
    ];
    for (const [sql, value] of attempts) {
      await expect(db.query(sql, [plan.runId, value])).rejects.toMatchObject({ code: '23514' });
    }
    await expect(db.query(
      `INSERT INTO test_request_run_resources (run_id, sequence, step, resource_kind, system, planned_identity, error)
       VALUES ($1, 999, 'copy_file', 'sharepoint_file', 'sharepoint', '{}'::jsonb, $2)`,
      [plan.runId, 'ECONNRESET while uploading Proposal_1003222.pdf'],
    )).rejects.toMatchObject({ code: '23514' });
    await expect(db.query(
      `INSERT INTO test_request_run_resources (run_id, sequence, step, resource_kind, system, planned_identity)
       VALUES ($1, 999, 'not_a_step', 'sharepoint_file', 'sharepoint', '{}'::jsonb)`,
      [plan.runId],
    )).rejects.toMatchObject({ code: '23514' });
  });

  it('slice 6a: the IA folder and DOCX filename families are accepted, and look-alikes rejected, identically by JS and SQL', async () => {
    const accepted = [
      { folder: '1000400_5D54ABC57F744D23B4BE39599147E674/Artifacts/Initial Assessment' },
      { folder: '1000400_5D54ABC57F744D23B4BE39599147E674/Artifacts/Initial Assessment/Board Milestones' },
      { folder: 'Artifacts/Initial Assessment' },
      { filename: '1000400 Initial Assessment 0a1b2c3d-9f8e7d6c.docx' },
      { filename: '1000400 Initial Assessment Board v1.0 0a1b2c3d.docx' },
      { name: '1000400 Initial Assessment Board v3 0a1b2c3d.docx' },
    ];
    for (const receipt of accepted) {
      expect(assertLedgerReceipt(receipt, 'fixture')).toBe(receipt);
      const { rows } = await db.query(`SELECT test_request_receipt_ok($1::jsonb) AS ok`, [JSON.stringify(receipt)]);
      expect(rows[0].ok).toBe(true);
    }
    const rejected = [
      { folder: '1000400_5D54ABC57F744D23B4BE39599147E674/Artifacts/Initial Assessment/Extra' },
      { folder: '1000400_5D54ABC57F744D23B4BE39599147E674/Artifacts/Pre-Site Visit' },
      { filename: '1000400 Initial Assessment Secret Notes.docx' },
      { filename: '1000400 Initial Assessment 0A1B2C3D-9f8e7d6c.docx' },
      { filename: '1000400 Initial Assessment 0a1b2c3d-9f8e7d6c.pdf' },
      { filename: `1000400 Initial Assessment Board v${FAKE_GITHUB_TOKEN.slice(0, 20)} 0a1b2c3d.docx` },
      { filename: 'Confidential Initial Assessment 0a1b2c3d-9f8e7d6c.docx' },
    ];
    for (const receipt of rejected) {
      expect(() => assertLedgerReceipt(receipt, 'fixture')).toThrow();
      const { rows } = await db.query(`SELECT test_request_receipt_ok($1::jsonb) AS ok`, [JSON.stringify(receipt)]);
      expect(rows[0].ok).toBe(false);
    }
  });

  it('P2-b: the Reviews recipe folder/filename grammars and receipt keys are accepted/rejected identically by JS and SQL', async () => {
    const accepted = [
      // Reviewer_Uploads as a request-folder child (both subfolder compositions
      // SUBFOLDER supports: <prefix>_<8hex> and bare <8hex>).
      { folder: `1000400_5D54ABC57F744D23B4BE39599147E674/Reviewer_Uploads/jones_1a2b3c4d/attempt_${'a'.repeat(32)}` },
      { folder: `1000400_5D54ABC57F744D23B4BE39599147E674/Reviewer_Uploads/1a2b3c4d/attempt_${'a'.repeat(32)}` },
      // Reviewer_Uploads as a bare subfolder (matches how SUBFOLDER is composed today).
      { folder: `Reviewer_Uploads/jones_1a2b3c4d/attempt_${'a'.repeat(32)}` },
      { folder: `Reviewer_Uploads/1a2b3c4d/attempt_${'a'.repeat(32)}` },
      // A 30-character alphanumeric prefix is the boundary; exactly 30 is accepted.
      { folder: `Reviewer_Uploads/${'a'.repeat(30)}_1a2b3c4d/attempt_${'a'.repeat(32)}` },
      { filename: 'Review_1.pdf' },
      { filename: 'Review_5.docx' },
      { filename: 'Review_1.doc' },
      { name: 'Review_1.pdf' },
      { sourcePersonId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', destinationPersonId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', suggestionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
      { addressSha256: 'a'.repeat(64), attestedDigest: 'b'.repeat(64) },
      { answerCount: 12 },
      { eTagBefore: '"12345"', eTagAfter: '"12346"' },
      { reviewForm: 'uploaded' },
      { reviewForm: 'received_no_file' },
      { reviewForm: 'unreceived' },
    ];
    for (const receipt of accepted) {
      expect(assertLedgerReceipt(receipt, 'fixture')).toBe(receipt);
      const { rows } = await db.query(`SELECT test_request_receipt_ok($1::jsonb) AS ok`, [JSON.stringify(receipt)]);
      expect(rows[0].ok).toBe(true);
    }
    const rejected = [
      // A 31-character prefix is one over the {1,30} bound.
      { folder: `Reviewer_Uploads/${'a'.repeat(31)}_1a2b3c4d/attempt_${'a'.repeat(32)}` },
      // Uppercase hex in either the 8-hex subfolder id or the 32-hex attempt id.
      { folder: `Reviewer_Uploads/jones_1A2B3C4D/attempt_${'a'.repeat(32)}` },
      { folder: `Reviewer_Uploads/jones_1a2b3c4d/attempt_${'A'.repeat(32)}` },
      // A per-review cap of 5 (Review_[1-5]): 0, 6 and 100 are rejected, so a
      // looser Review_[0-9]{1,2} SQL rule cannot pass these fixtures (Opus round 2).
      { filename: 'Review_0.pdf' },
      { filename: 'Review_6.docx' },
      { filename: 'Review_100.pdf' },
      { filename: 'Review_1.PDF' },
      { filename: 'Review_1.docm' },
      { sourcePersonId: 'not-a-guid' },
      { addressSha256: 'not-hex' },
      { attestedDigest: `sk-${FAKE_GITHUB_TOKEN}` },
      { answerCount: '12' }, // must be a JSON number, not a numeric string
      { eTagBefore: 'not-an-etag' },
      { reviewForm: 'in_progress' },
    ];
    for (const receipt of rejected) {
      expect(() => assertLedgerReceipt(receipt, 'fixture')).toThrow();
      const { rows } = await db.query(`SELECT test_request_receipt_ok($1::jsonb) AS ok`, [JSON.stringify(receipt)]);
      expect(rows[0].ok).toBe(false);
    }
  });

  it('the PostgreSQL receipt function accepts every receipt the live run 1000341 stored and rejects what the JS validator rejects', async () => {
    const evidence = JSON.parse(fs.readFileSync(
      path.join(process.cwd(), 'docs/plans/evidence/test-request-factory/ledger-run-1000341-2026-09-24.json'), 'utf8',
    ));
    const stored = (evidence.resources || []).flatMap((row) => [row.plannedIdentity, row.sourceProvenance, row.readback]).filter(Boolean);
    expect(stored.length).toBeGreaterThanOrEqual(6);
    for (const receipt of stored) {
      expect(assertLedgerReceipt(receipt, 'fixture')).toBe(receipt);
      const { rows } = await db.query(`SELECT test_request_receipt_ok($1::jsonb) AS ok`, [JSON.stringify(receipt)]);
      expect(rows[0].ok).toBe(true);
    }
    const rejected = [
      { body: 'x' },
      { requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', purpose: 'confidential' },
      { folder: 'https://contoso.sharepoint.com/sites/x' },
      { driveId: `b!${FAKE_GITHUB_TOKEN}` },
      { itemId: FAKE_GITHUB_TOKEN },
      { readbackAt: 'Authorization: Bearer abc' },
      { nested: { a: 1 } },
      { requestIds: ['not-a-guid'] },
      { filename: 'Confidential proposal.pdf' },
      { size: '12' },
      { restored: 'yes' },
      { eTag: '"glpat-ABCDEFGHIJKLMNOPQRST"' },
      { eTag: 'W/"ghp_0123456789abcdefghijklmnop"' },
      { driveId: 'b!AAAAAAAAAAAAAAAA-ghp_0123456789abcdefghij' },
      { driveId: 'b!AAAAAAAAAAAAAAAAgithub_pat_11AAAAAAA0123456789' },
      { versionId: 'v1glpat-ABCDEFGHIJKLMNOPQRST' },
    ];
    for (const receipt of rejected) {
      expect(() => assertLedgerReceipt(receipt, 'fixture')).toThrow();
      const { rows } = await db.query(`SELECT test_request_receipt_ok($1::jsonb) AS ok`, [JSON.stringify(receipt)]);
      expect(rows[0].ok).toBe(false);
    }
    // And a direct INSERT that bypasses the JS validator is refused by the CHECK.
    const actorId = cliActorId(`actor-${crypto.randomUUID()}`);
    const plan = basePlan();
    createdRunIds.push(plan.runId);
    await ledger.reserveRun({ actorId, idempotencyKey: 'key-receipt-check', plan });
    await expect(db.query(
      `INSERT INTO test_request_run_resources (run_id, sequence, step, resource_kind, system, planned_identity)
       VALUES ($1, 998, 'copy_file', 'sharepoint_file', 'sharepoint', $2::jsonb)`,
      [plan.runId, JSON.stringify({ downloadUrl: 'https://graph.microsoft.com/x?tempauth=abc' })],
    )).rejects.toMatchObject({ code: '23514' });
  });

  it('a later readback merges into the earlier one, so a dispatch marker is never erased', async () => {
    const actorId = cliActorId(`actor-${crypto.randomUUID()}`);
    const plan = basePlan();
    createdRunIds.push(plan.runId);
    const { run } = await ledger.reserveRun({ actorId, idempotencyKey: 'key-readback-merge', plan });
    const claimed = await ledger.claimLease({ runId: run.runId, expectedVersion: run.version, leaseSeconds: 60 });
    const resource = await ledger.journalPlannedResource({
      runId: run.runId, leaseToken: claimed.leaseToken, leaseGeneration: claimed.leaseGeneration,
      step: 'create_request', resourceKind: 'dataverse_request', system: 'dataverse', plannedIdentity: { requestId: plan.destinationRequestId },
    });
    const attemptedAt = '2026-09-24T07:54:00.000Z';
    await ledger.recordResourceReadback({
      resourceId: resource.resourceId, runId: run.runId, leaseToken: claimed.leaseToken, leaseGeneration: claimed.leaseGeneration,
      responseStatus: null, readback: { createAttemptedAt: attemptedAt }, outcome: 'planned',
    });
    const after = await ledger.recordResourceReadback({
      resourceId: resource.resourceId, runId: run.runId, leaseToken: claimed.leaseToken, leaseGeneration: claimed.leaseGeneration,
      responseStatus: 500, readback: { createResponseReceivedAt: '2026-09-24T07:54:01.000Z' }, outcome: 'dispatched',
    });
    expect(after.readback).toMatchObject({ createAttemptedAt: attemptedAt, createResponseReceivedAt: '2026-09-24T07:54:01.000Z' });
    expect(after.responseStatus).toBe(500);
  });

  it('needs_attention requires a reason: the DB constraint rejects a missing one', async () => {
    const actorId = cliActorId(`actor-${crypto.randomUUID()}`);
    const plan = basePlan();
    createdRunIds.push(plan.runId);
    const { run } = await ledger.reserveRun({ actorId, idempotencyKey: 'key-needs-attention', plan });

    await expect(db.query(
      `UPDATE test_request_runs SET status = 'needs_attention', needs_attention_reason = NULL WHERE run_id = $1::uuid`,
      [run.runId],
    )).rejects.toThrow();
  });
});
