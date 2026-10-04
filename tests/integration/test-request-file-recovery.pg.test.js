/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { cliActorId, createRunLedger, derivedTestLabel } from '../../lib/services/test-requests/run-ledger.js';
import { pgLedgerDb } from '../../lib/services/test-requests/run-ledger-db.js';
import { expectedRequestFolder } from '../../lib/services/test-requests/sandbox-clone.js';

const TEST_URL = process.env.TEST_REQUEST_LEDGER_TEST_URL || '';
if (!TEST_URL && process.env.TEST_REQUEST_LEDGER_REQUIRE === '1') {
  throw new Error('TEST_REQUEST_LEDGER_REQUIRE=1 but TEST_REQUEST_LEDGER_TEST_URL is unset.');
}
if (/neon\.tech/i.test(TEST_URL) || (process.env.POSTGRES_URL && TEST_URL === process.env.POSTGRES_URL)) {
  throw new Error('Refusing to run the file recovery proof against the shared Production/Preview database.');
}
const describeIf = TEST_URL ? describe : describe.skip;
const MIGRATION_PATH = path.join(process.cwd(), 'lib/db/migrations/054_test_request_runs.sql');
const HASH = 'a'.repeat(64);
const ITEM_ID = `01${'A'.repeat(32)}`;
const DEST_ITEM_ID = `01${'B'.repeat(32)}`;

function plan(overrides = {}) {
  const result = {
    runId: crypto.randomUUID(), recipe: 'basic',
    sourceDataverseHost: 'source.crm.dynamics.com', sourceRequestId: crypto.randomUUID(),
    sourceRequestNumber: '1003222', sourceRevision: 'rev-1', bundleSha256: HASH,
    bundleExportedAt: new Date().toISOString(), copyPolicyVersion: '1', copyPolicyDigest: HASH,
    planDigest: HASH, createBodySha256: HASH, destinationEnvironment: 'sandbox',
    destinationDataverseHost: 'orgd9e66399.crm.dynamics.com',
    destinationRequestId: crypto.randomUUID(), destinationLocationId: crypto.randomUUID(),
    expectedAppUserId: crypto.randomUUID(), expectedOrganizationId: crypto.randomUUID(),
    expectedGraphSiteId: 'appriver3651007194.sharepoint.com,48930e19-0000-4000-8000-000000000000,11111111-1111-4111-8111-111111111111',
    expectedGraphDriveId: `b!${'B'.repeat(32)}`, fiscalYear: 'December 2026',
    meetingDate: '2026-10-01', ...overrides,
  };
  result.testLabel = derivedTestLabel(result);
  return result;
}

describeIf('Basic file readback recovery ledger CAS (local Postgres only)', () => {
  let db;
  let ledger;
  const createdRunIds = [];

  beforeAll(async () => {
    db = pgLedgerDb(TEST_URL);
    const { rows } = await db.query(`SELECT to_regclass('public.test_request_runs') AS reg`);
    if (!rows[0]?.reg) await db.query(fs.readFileSync(MIGRATION_PATH, 'utf8'));
    ledger = createRunLedger(db);
  });

  afterAll(async () => {
    if (createdRunIds.length) {
      await db.query(`DELETE FROM test_request_run_resources WHERE run_id = ANY($1::uuid[])`, [createdRunIds]);
      await db.query(`DELETE FROM test_request_runs WHERE run_id = ANY($1::uuid[])`, [createdRunIds]);
    }
    await db?.end?.();
  });

  async function candidate({ exportedAt = new Date().toISOString() } = {}) {
    const actorId = cliActorId(`recovery-${crypto.randomUUID()}`);
    const p = plan({ bundleExportedAt: exportedAt });
    createdRunIds.push(p.runId);
    const { run } = await ledger.reserveRun({ actorId, idempotencyKey: `recovery-${crypto.randomUUID()}`, plan: p });
    const claim = await ledger.claimLease({ runId: run.runId, expectedVersion: run.version });
    const copying = await ledger.advanceStep({
      runId: run.runId, leaseToken: claim.leaseToken, leaseGeneration: claim.leaseGeneration,
      expectedVersion: claim.version, nextStep: 'copy_file', nextStepIndex: 4,
      status: 'creating', destinationRequestNumber: '9000001',
    });
    const resource = await ledger.journalPlannedResource({
      runId: run.runId, leaseToken: claim.leaseToken, leaseGeneration: claim.leaseGeneration,
      step: 'copy_file', resourceKind: 'sharepoint_file', system: 'sharepoint',
      plannedIdentity: { index: 0, filename: 'ProposalNarrative_1003222.pdf' },
    });
    await ledger.recordResourceDispatched({ runId: run.runId, resourceId: resource.resourceId, leaseToken: claim.leaseToken, leaseGeneration: claim.leaseGeneration });
    const readback = {
      index: 0, filename: 'ProposalNarrative_1003222.pdf', folder: `${expectedRequestFolder('9000001', p.destinationRequestId)}/Phase I`, library: 'akoya_request',
      size: 12, contentHash: HASH, sourceGraphItemId: ITEM_ID, driveId: `b!${'B'.repeat(32)}`,
      sourceDriveId: `b!${'C'.repeat(32)}`, itemId: DEST_ITEM_ID, eTag: '"e1"', versionId: '1.0',
      itemSize: 12, eTagBefore: '"s1"', sourceVersionId: '1.0', uploadAttemptedAt: new Date().toISOString(),
    };
    await ledger.recordResourceReadback({ runId: run.runId, resourceId: resource.resourceId,
      leaseToken: claim.leaseToken, leaseGeneration: claim.leaseGeneration, outcome: 'dispatched', readback });
    const stopped = await ledger.markNeedsAttention({ runId: run.runId, leaseToken: claim.leaseToken,
      leaseGeneration: claim.leaseGeneration, expectedVersion: copying.version,
      reason: 'file_journal_unverified', error: 'file_journal_unverified' });
    return { run: stopped, actorId, resource: await ledger.listRunResources(run.runId).then((rows) => rows[0]), plan: p };
  }

  async function claim(c) {
    const claimed = await ledger.claimLease({ runId: c.run.runId, expectedVersion: c.run.version, leaseSeconds: 120 });
    expect(claimed).not.toBeNull();
    return { ...c, run: claimed };
  }

  function casArgs(candidateRun, overrides = {}) {
    const { run, actorId, resource, plan: p } = candidateRun;
    const expectedReadback = resource.readback;
    const verifiedReadback = {
      itemId: expectedReadback.itemId, driveId: expectedReadback.driveId,
      filename: expectedReadback.filename, folder: expectedReadback.folder,
      eTag: expectedReadback.eTag, versionId: expectedReadback.versionId,
      itemSize: expectedReadback.itemSize, contentHash: expectedReadback.contentHash,
      bytesSha256: HASH, recoveredAt: new Date().toISOString(),
    };
    return {
      runId: run.runId, actorId, expectedVersion: run.version,
      leaseToken: run.leaseToken, expectedLeaseGeneration: run.leaseGeneration,
      expectedStepIndex: run.stepIndex,
      expectedBundleExportedAt: new Date(p.bundleExportedAt).toISOString(),
      expectedPlanDigest: p.planDigest, expectedCopyPolicyDigest: p.copyPolicyDigest,
      expectedCreateBodySha256: p.createBodySha256,
      expectedRequestId: p.destinationRequestId, expectedRequestNumber: '9000001',
      resourceId: resource.resourceId, expectedResourceSequence: resource.sequence,
      expectedPlannedIdentity: resource.plannedIdentity, expectedSourceProvenance: resource.sourceProvenance,
      expectedReadback,
      expectedOutcome: resource.outcome, verifiedReadback, ...overrides,
    };
  }

  it('atomically verifies the exact unresolved file and restores the same copy step only', async () => {
    const c = await claim(await candidate());
    const recovered = await ledger.recoverFileReadback(casArgs(c));
    expect(recovered).toMatchObject({ status: 'creating', currentStep: 'copy_file', stepIndex: 4,
      needsAttentionReason: null, destinationRequestId: c.plan.destinationRequestId,
      destinationRequestNumber: '9000001', version: c.run.version + 1, leaseToken: null });
    const [resource] = await ledger.listRunResources(c.run.runId);
    expect(resource).toMatchObject({ outcome: 'verified', readback: { itemId: DEST_ITEM_ID, bytesSha256: HASH, uploadAttemptedAt: c.resource.readback.uploadAttemptedAt }, error: null });
  });

  it('refuses stale bundle freshness by DB clock and leaves both rows unchanged', async () => {
    const old = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
    const c = await claim(await candidate({ exportedAt: old }));
    expect(await ledger.recoverFileReadback(casArgs(c))).toBeNull();
    expect(await ledger.getRun(c.run.runId)).toMatchObject({ status: 'needs_attention', version: c.run.version, leaseToken: c.run.leaseToken });
    const [resource] = await ledger.listRunResources(c.run.runId);
    expect(resource).toMatchObject({ outcome: 'dispatched', readback: c.resource.readback });
  });

  it('refuses stale version, owner, request, or resource snapshots without partial receipt writes', async () => {
    const c = await claim(await candidate());
    for (const change of [
      { expectedVersion: c.run.version + 1 },
      { actorId: cliActorId('different-operator') },
      { expectedRequestNumber: '9000002' },
      { expectedResourceSequence: c.resource.sequence + 1 },
      { expectedStepIndex: c.run.stepIndex + 1 },
      { expectedReadback: { ...c.resource.readback, eTag: '"changed"' } },
      { expectedSourceProvenance: { contentHash: 'b'.repeat(64) } },
    ]) {
      expect(await ledger.recoverFileReadback(casArgs(c, change))).toBeNull();
    }
    await expect(ledger.recoverFileReadback(casArgs(c, { expectedOutcome: 'verified' }))).rejects.toMatchObject({ code: 'test_request_ledger_unsafe_value' });
    expect(await ledger.getRun(c.run.runId)).toMatchObject({ status: 'needs_attention', version: c.run.version, leaseToken: c.run.leaseToken });
    const [resource] = await ledger.listRunResources(c.run.runId);
    expect(resource).toMatchObject({ outcome: 'dispatched', readback: c.resource.readback });
  });
  it('admits one concurrent claim and rejects a stale worker after lease replacement', async () => {
    const c = await candidate();
    const claims = await Promise.all([0, 1].map(() => ledger.claimLease({
      runId: c.run.runId, expectedVersion: c.run.version,
    })));
    expect(claims.filter(Boolean)).toHaveLength(1);
    const old = { ...c, run: claims.find(Boolean) };
    await db.query(`UPDATE test_request_runs SET locked_until = clock_timestamp() - INTERVAL '1 second' WHERE run_id = $1::uuid`, [c.run.runId]);
    const replacement = await claim(old);
    await expect(ledger.recoverFileReadback(casArgs(old))).rejects.toMatchObject({ code: 'test_request_run_fenced' });
    const [resource] = await ledger.listRunResources(c.run.runId);
    expect(resource).toMatchObject({ outcome: 'dispatched', readback: c.resource.readback });
    expect(await ledger.recoverFileReadback(casArgs(replacement))).toMatchObject({ status: 'creating', stepIndex: 4 });
  });

  it('commits only one of two concurrent recoveries holding the same snapshot', async () => {
    const c = await claim(await candidate());
    const outcomes = await Promise.allSettled([0, 1].map(() => ledger.recoverFileReadback(casArgs(c))));
    expect(outcomes.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find((item) => item.status === 'rejected').reason).toMatchObject({ code: 'test_request_run_fenced' });
    expect(await ledger.getRun(c.run.runId)).toMatchObject({ status: 'creating', version: c.run.version + 1, stepIndex: 4 });
  });

  it('rolls back the real resource write if the final run update loses its fence', async () => {
    const c = await claim(await candidate());
    let resourceWasUpdated = false;
    const injectedFailureLedger = createRunLedger({
      ...db,
      transaction: (fn) => db.transaction((tx) => fn({
        query: async (sql, params) => {
          if (/UPDATE test_request_runs\s+SET status = 'creating'/.test(sql)) return { rows: [] };
          const result = await tx.query(sql, params);
          if (/UPDATE test_request_run_resources AS resource/.test(sql)) resourceWasUpdated = result.rows.length === 1;
          return result;
        },
      })),
    });
    await expect(injectedFailureLedger.recoverFileReadback(casArgs(c))).rejects.toMatchObject({ code: 'test_request_run_fenced' });
    expect(resourceWasUpdated).toBe(true);
    expect(await ledger.getRun(c.run.runId)).toMatchObject({ status: 'needs_attention', version: c.run.version, leaseToken: c.run.leaseToken });
    const [resource] = await ledger.listRunResources(c.run.runId);
    expect(resource).toMatchObject({ outcome: 'dispatched', readback: c.resource.readback });
  });

});
