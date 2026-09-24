/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRunLedger } from '../../lib/services/test-requests/run-ledger.js';
import { pgLedgerDb } from '../../lib/services/test-requests/run-ledger-db.js';

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

function basePlan(overrides = {}) {
  const runId = crypto.randomUUID();
  return {
    runId,
    recipe: 'basic',
    sourceDataverseHost: 'source.crm.dynamics.com',
    sourceRequestId: crypto.randomUUID(),
    sourceRequestNumber: 'REQ-0001',
    sourceRevision: 'rev-1',
    bundleSha256: 'a'.repeat(64),
    bundleExportedAt: new Date().toISOString(),
    copyPolicyVersion: '1',
    copyPolicyDigest: 'b'.repeat(64),
    planDigest: 'digest-a',
    createBodySha256: 'c'.repeat(64),
    destinationEnvironment: 'sandbox',
    destinationDataverseHost: 'sandbox.crm.dynamics.com',
    destinationRequestId: crypto.randomUUID(),
    destinationLocationId: crypto.randomUUID(),
    expectedAppUserId: crypto.randomUUID(),
    expectedOrganizationId: crypto.randomUUID(),
    expectedGraphSiteId: 'site-1',
    expectedGraphDriveId: 'drive-1',
    fiscalYear: 'FY26',
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
    if (!rows[0]?.reg) {
      const migrationSql = fs.readFileSync(MIGRATION_PATH, 'utf8');
      await db.query(migrationSql);
    }
    ledger = createRunLedger(db);
  });

  afterAll(async () => {
    if (createdRunIds.length) {
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
    const actorId = `actor-${crypto.randomUUID()}`;
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
      `SELECT count(*)::int AS n FROM test_request_runs WHERE actor_id = $1::text AND idempotency_key = $2::text`,
      [actorId, idempotencyKey],
    );
    expect(rows[0].n).toBe(1);
  });

  it('a differing plan digest on the same key returns 409', async () => {
    const actorId = `actor-${crypto.randomUUID()}`;
    const idempotencyKey = 'key-conflict';
    const plan = basePlan();
    createdRunIds.push(plan.runId);
    await ledger.reserveRun({ actorId, idempotencyKey, plan });

    await expect(ledger.reserveRun({
      actorId,
      idempotencyKey,
      plan: basePlan({ ...plan, runId: crypto.randomUUID(), planDigest: 'digest-different' }),
    })).rejects.toMatchObject({ httpStatus: 409, code: 'test_request_run_conflict' });
  });

  it('claimLease succeeds once; a second claim with the stale version returns null', async () => {
    const actorId = `actor-${crypto.randomUUID()}`;
    const plan = basePlan();
    createdRunIds.push(plan.runId);
    const { run } = await ledger.reserveRun({ actorId, idempotencyKey: 'key-claim', plan });

    const claimed = await ledger.claimLease({ runId: run.runId, expectedVersion: run.version });
    expect(claimed).not.toBeNull();

    const staleClaim = await ledger.claimLease({ runId: run.runId, expectedVersion: run.version });
    expect(staleClaim).toBeNull();
  });

  it('a stale (older generation) token cannot advanceStep or journal a resource', async () => {
    const actorId = `actor-${crypto.randomUUID()}`;
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
    const actorId = `actor-${crypto.randomUUID()}`;
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
    const actorId = `actor-${crypto.randomUUID()}`;
    const plan = basePlan();
    createdRunIds.push(plan.runId);
    const { run } = await ledger.reserveRun({ actorId, idempotencyKey: 'key-sequence', plan });
    const claim = await ledger.claimLease({ runId: run.runId, expectedVersion: run.version });

    const journalOne = () => ledger.journalPlannedResource({
      runId: run.runId,
      leaseToken: claim.leaseToken,
      leaseGeneration: claim.leaseGeneration,
      step: 'provision',
      resourceKind: 'sharepoint_folder',
      system: 'sharepoint',
      plannedIdentity: { folder: `Test/${crypto.randomUUID()}` },
    });

    const results = await Promise.all([journalOne(), journalOne(), journalOne()]);
    const sequences = results.map((r) => r.sequence).sort((a, b) => a - b);
    expect(sequences).toEqual([1, 2, 3]);
  });

  it('a needs_attention run can be re-claimed and resumed; the reason clears on leaving needs_attention', async () => {
    const actorId = `actor-${crypto.randomUUID()}`;
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
      expectedVersion: creating.version, reason: 'ambiguous create outcome',
    });
    expect(stuck.status).toBe('needs_attention');
    await ledger.releaseLease({ runId: run.runId, leaseToken: first.leaseToken, leaseGeneration: first.leaseGeneration });

    const resumed = await ledger.claimLease({ runId: run.runId, expectedVersion: stuck.version });
    expect(resumed).not.toBeNull();
    const advanced = await ledger.advanceStep({
      runId: run.runId, leaseToken: resumed.leaseToken, leaseGeneration: resumed.leaseGeneration,
      expectedVersion: resumed.version, nextStep: 'provision', nextStepIndex: 2, status: 'creating',
    });
    expect(advanced).not.toBeNull();
    expect(advanced.status).toBe('creating');
    expect(advanced.needsAttentionReason).toBeNull();

    // A needs_attention run can also be verified straight to ready after resume.
    const stuckAgain = await ledger.markNeedsAttention({
      runId: run.runId, leaseToken: resumed.leaseToken, leaseGeneration: resumed.leaseGeneration,
      expectedVersion: advanced.version, reason: 'second stall',
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
    const actorId = `actor-${crypto.randomUUID()}`;
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
    const actorId = `actor-${crypto.randomUUID()}`;
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
    const actorId = `actor-${crypto.randomUUID()}`;
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

    await db.query(`UPDATE test_request_runs SET status = 'needs_attention', needs_attention_reason = 'x' WHERE run_id = $1::uuid`, [stuckRun.runId]);
    await db.query(`UPDATE test_request_runs SET status = 'retiring', needs_attention_reason = NULL WHERE run_id = $1::uuid`, [stuckRun.runId]);

    // Still enforced: ready requires completed_at; pre-terminal states forbid it.
    await expect(db.query(`UPDATE test_request_runs SET status = 'ready', completed_at = NULL WHERE run_id = $1::uuid`, [stuckRun.runId])).rejects.toThrow();
    await expect(db.query(`UPDATE test_request_runs SET status = 'creating', completed_at = NOW() WHERE run_id = $1::uuid`, [stuckRun.runId])).rejects.toThrow();
  });

  it('needs_attention requires a reason: the DB constraint rejects a missing one', async () => {
    const actorId = `actor-${crypto.randomUUID()}`;
    const plan = basePlan();
    createdRunIds.push(plan.runId);
    const { run } = await ledger.reserveRun({ actorId, idempotencyKey: 'key-needs-attention', plan });

    await expect(db.query(
      `UPDATE test_request_runs SET status = 'needs_attention', needs_attention_reason = NULL WHERE run_id = $1::uuid`,
      [run.runId],
    )).rejects.toThrow();
  });
});
