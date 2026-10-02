/** @jest-environment node */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Client, Pool } from 'pg';

const mockPoolRef = { current: null };
jest.mock('@vercel/postgres', () => ({
  db: { connect: () => mockPoolRef.current.connect() },
  sql: (strings, ...values) => mockPoolRef.current.query(
    strings.reduce((text, part, i) => text + part + (i < values.length ? `$${i + 1}` : ''), ''),
    values,
  ),
}));

const TEST_URL = process.env.TEST_REQUEST_LEDGER_TEST_URL || '';
if (!TEST_URL && process.env.TEST_REQUEST_LEDGER_REQUIRE === '1') {
  throw new Error('TEST_REQUEST_LEDGER_REQUIRE=1 but TEST_REQUEST_LEDGER_TEST_URL is unset.');
}
if (/neon\.tech/i.test(TEST_URL) || (process.env.POSTGRES_URL && TEST_URL === process.env.POSTGRES_URL)) {
  throw new Error('Refusing to run materials background-job integration tests against a shared Production/Preview database.');
}
const describeIf = TEST_URL ? describe : describe.skip;
const MIGRATIONS = [
  '031_portal_upload_staging.sql',
  '042_site_visit_material_collections.sql',
  '043_portal_upload_staging_document_scope.sql',
  '044_site_visit_material_slot_leases.sql',
  '060_materials_background_jobs.sql',
].map((file) => fs.readFileSync(path.join(process.cwd(), 'lib/db/migrations', file), 'utf8'));

describeIf('applicant materials background-job store (live PostgreSQL)', () => {
  const schema = `materials_jobs_${crypto.randomBytes(5).toString('hex')}`;
  let admin;
  let jobs;
  let collections;
  let stagingStore;
  let now;
  let originalSchemaReadyFlag;

  beforeAll(async () => {
    admin = new Client({ connectionString: TEST_URL });
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    const scopedUrl = new URL(TEST_URL);
    scopedUrl.searchParams.set('options', `-c search_path=${schema}`);
    mockPoolRef.current = new Pool({ connectionString: scopedUrl.toString(), max: 6 });
    for (const migration of MIGRATIONS) await mockPoolRef.current.query(migration);
    jobs = await import('../../lib/services/site-visit-materials/background-job-store.js');
    collections = await import('../../lib/services/site-visit-materials/collection-store.js');
    originalSchemaReadyFlag = process.env.SITE_VISIT_MATERIALS_BACKGROUND_SCHEMA_READY;
    process.env.SITE_VISIT_MATERIALS_BACKGROUND_SCHEMA_READY = 'on';
    stagingStore = await import('../../lib/services/portal-upload-staging.js');
    now = new Date(Date.now());
  });

  afterAll(async () => {
    if (originalSchemaReadyFlag === undefined) delete process.env.SITE_VISIT_MATERIALS_BACKGROUND_SCHEMA_READY;
    else process.env.SITE_VISIT_MATERIALS_BACKGROUND_SCHEMA_READY = originalSchemaReadyFlag;
    if (mockPoolRef.current) await mockPoolRef.current.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
  });

  beforeEach(async () => {
    await mockPoolRef.current.query('TRUNCATE materials_upload_jobs, portal_upload_staging, site_visit_material_collections');
  });

  function checklist(waivedSlot = null) {
    return ['presentation_pdf', 'presentation_source', 'participant_bios'].map((key) => ({
      key,
      waived: key === waivedSlot,
    }));
  }

  async function makeCollection({ requestId = crypto.randomUUID(), status = 'open', waivedSlot = null } = {}) {
    const id = crypto.randomUUID();
    const tokenDigest = crypto.randomBytes(32).toString('hex');
    await mockPoolRef.current.query(
      `INSERT INTO site_visit_material_collections
         (id, request_id, site_visit_activity_id, status, due_at, closes_at, checklist, contacts,
          jti, token_digest, token_ciphertext, created_by, invited_at, ready_confirmed_at, ready_confirmed_by)
       VALUES ($1,$2,$3,$4,NOW()-INTERVAL '1 day',NOW()+INTERVAL '30 days',$5::jsonb,'{}'::jsonb,
               $6,$7,'sealed',$8,NOW(),CASE WHEN $4='ready' THEN NOW() END,CASE WHEN $4='ready' THEN $9::uuid END)`,
      [id, requestId, crypto.randomUUID(), status, JSON.stringify(checklist(waivedSlot)), crypto.randomUUID(), tokenDigest, crypto.randomUUID(), crypto.randomUUID()],
    );
    return { id, requestId, tokenDigest };
  }

  async function makeStaging({ requestId, actorBinding = 'actor-1', status = 'finalizing', expiresInHours = 4, leaseInHours = 1 } = {}) {
    const id = crypto.randomUUID();
    const leaseToken = crypto.randomUUID();
    await mockPoolRef.current.query(
      `INSERT INTO portal_upload_staging
         (id,scope,resource_id,actor_binding,pathname,filename,declared_content_type,max_bytes,status,
          lease_token,lease_expires_at,expires_at)
       VALUES ($1,'site_visit_material',$2,$3,$4,$5,'application/pdf',1000,$6,$7,
               NOW()+($8::text||' hours')::interval,NOW()+($9::text||' hours')::interval)`,
      [id, requestId, actorBinding, `test/${id}`, 'paper.pdf', status, status === 'finalizing' ? leaseToken : null, leaseInHours, expiresInHours],
    );
    return { id, leaseToken, actorBinding };
  }

  async function admit({ collection, staging, slot = 'presentation_pdf', requestId = collection.requestId, nowOverride = now }) {
    return jobs.enqueueMaterialsUploadJob({
      stagingId: staging.id,
      stagingLeaseToken: staging.leaseToken,
      requestId,
      collectionId: collection.id,
      actorBinding: staging.actorBinding,
      tokenDigest: collection.tokenDigest,
      slot,
      otherUploadsEnabled: slot === 'other',
      now: nowOverride,
    });
  }

  async function row(sql, values = []) {
    return (await mockPoolRef.current.query(sql, values)).rows[0];
  }

  async function waitForBlockedQuery(fragment, count = 1) {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const blocked = await admin.query(
        `SELECT COUNT(*)::int AS count FROM pg_stat_activity
          WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE $1`,
        [`%${fragment}%`],
      );
      if (blocked.rows[0].count >= count) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for PostgreSQL lock wait on ${fragment}`);
  }

  test('admission is replay-idempotent for the same staging identity and owns it atomically', async () => {
    const collection = await makeCollection();
    const staging = await makeStaging({ requestId: collection.requestId });
    const first = await admit({ collection, staging });
    const replay = await admit({ collection, staging });
    expect(replay.id).toBe(first.id);
    expect(await row('SELECT COUNT(*)::int AS count FROM materials_upload_jobs')).toMatchObject({ count: 1 });
    expect(await row('SELECT status, background_job_id, lease_token FROM portal_upload_staging WHERE id=$1', [staging.id]))
      .toMatchObject({ status: 'pending', background_job_id: first.id, lease_token: null });
  });

  test('the active checklist slot is unique across collections for the same request', async () => {
    const requestId = crypto.randomUUID();
    const collectionA = await makeCollection({ requestId });
    const stagingA = await makeStaging({ requestId });
    await admit({ collection: collectionA, staging: stagingA });
    await mockPoolRef.current.query("UPDATE site_visit_material_collections SET status='closed' WHERE id=$1", [collectionA.id]);
    const collectionB = await makeCollection({ requestId });
    const stagingB = await makeStaging({ requestId });

    await expect(admit({ collection: collectionB, staging: stagingB }))
      .rejects.toMatchObject({ code: 'slot_busy', httpStatus: 409 });
    expect(await row('SELECT background_job_id, status FROM portal_upload_staging WHERE id=$1', [stagingB.id]))
      .toMatchObject({ background_job_id: null, status: 'finalizing' });
  });

  test('admission racing expired cleanup has one durable winner and cleanup cannot delete owned staging', async () => {
    const collection = await makeCollection();
    const staging = await makeStaging({ requestId: collection.requestId, expiresInHours: -1, leaseInHours: -2 });
    const cleanup = await mockPoolRef.current.connect();
    try {
      await cleanup.query('BEGIN');
      const eligible = await cleanup.query(
        `SELECT id FROM portal_upload_staging WHERE id=$1 AND expires_at<NOW()
          AND background_job_id IS NULL AND NOT(status='finalizing' AND lease_expires_at>=NOW()) FOR UPDATE`,
        [staging.id],
      );
      expect(eligible.rowCount).toBe(1);
      const admission = admit({ collection, staging, nowOverride: new Date(Date.now() - 3 * 60 * 60 * 1000) });
      await waitForBlockedQuery('FROM portal_upload_staging');
      await cleanup.query(
        `UPDATE portal_upload_staging SET status='expired',lease_token=NULL,lease_expires_at=NULL
          WHERE id=$1 AND background_job_id IS NULL AND expires_at<NOW()
            AND NOT(status='finalizing' AND lease_expires_at>=NOW())`, [staging.id],
      );
      await cleanup.query('COMMIT');
      await expect(admission).rejects.toMatchObject({ code: 'staging_lease_lost' });
      expect(await row('SELECT status, background_job_id FROM portal_upload_staging WHERE id=$1', [staging.id]))
        .toMatchObject({ status: 'expired', background_job_id: null });
    } finally {
      await cleanup.query('ROLLBACK').catch(() => {});
      cleanup.release();
    }
  });

  test('Ready cannot be asserted after admission wins the collection lock', async () => {
    const collection = await makeCollection({ status: 'open' });
    const staging = await makeStaging({ requestId: collection.requestId });
    const blocker = await mockPoolRef.current.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM site_visit_material_collections WHERE id=$1 FOR UPDATE', [collection.id]);
      // Queue admission first while holding the collection lock, then Ready.
      // PostgreSQL will run admission and commit before markReady's lock check.
      const admission = admit({ collection, staging });
      await waitForBlockedQuery('FROM site_visit_material_collections');
      const ready = collections.markReady(collection.id, crypto.randomUUID());
      await waitForBlockedQuery("status = 'open' FOR UPDATE");
      await blocker.query('COMMIT');
      await admission;
      const marked = await ready;
      expect(marked).toBeNull();
      const current = await row('SELECT status, ready_confirmed_at FROM site_visit_material_collections WHERE id=$1', [collection.id]);
      expect(current).toMatchObject({ status: 'open', ready_confirmed_at: null });
    } finally {
      await blocker.query('ROLLBACK').catch(() => {});
      blocker.release();
    }
  });

  test('a crashed worker lease expires, is reclaimed with a new token, and stale token cannot settle', async () => {
    const collection = await makeCollection();
    const staging = await makeStaging({ requestId: collection.requestId });
    const job = await admit({ collection, staging });
    const first = await jobs.claimNextMaterialsUploadJob({ leaseSeconds: 60 });
    expect(first).toMatchObject({ id: job.id, status: 'processing', attempt_count: 1, staging_status: 'pending' });
    await mockPoolRef.current.query("UPDATE materials_upload_jobs SET locked_until=NOW()-INTERVAL '1 second' WHERE id=$1", [job.id]);
    await mockPoolRef.current.query("UPDATE portal_upload_staging SET lease_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1", [staging.id]);
    const second = await jobs.claimNextMaterialsUploadJob({ leaseSeconds: 60 });
    expect(second).toMatchObject({ id: job.id, status: 'processing', attempt_count: 2 });
    expect(second.lease_token).not.toBe(first.lease_token);
    expect(await jobs.completeMaterialsUploadJob({ jobId: job.id, leaseToken: first.lease_token, resultPayload: { ok: true } })).toBeNull();
    expect(await jobs.assertMaterialsUploadJobLease(job.id, second.lease_token)).toBe(true);
    expect(await jobs.giveBackMaterialsUploadJobAttempt(first)).toBeNull();
    expect(await jobs.giveBackMaterialsUploadJobAttempt(second)).toMatchObject({ status: 'queued', attempt_count: 1 });
  });

  test('settlement SQL supports retry, safe failure, attention, and terminal constraint shapes', async () => {
    const expected = [
      ['queued', { status: 'pending', owner: true, attempts: 1 }],
      ['failed', { status: 'rejected', owner: false, attempts: 1 }],
      ['needs_attention', { status: 'pending', owner: true, attempts: 1 }],
      ['cancelled', { status: 'rejected', owner: false, attempts: 1 }],
    ];
    for (const [status, expectation] of expected) {
      await mockPoolRef.current.query('TRUNCATE materials_upload_jobs, portal_upload_staging, site_visit_material_collections');
      const collection = await makeCollection();
      const staging = await makeStaging({ requestId: collection.requestId });
      await admit({ collection, staging });
      const claimed = await jobs.claimNextMaterialsUploadJob();
      expect(claimed.id).toBe((await row('SELECT id FROM materials_upload_jobs LIMIT 1')).id);
      expect(await row('SELECT background_job_id, lease_token FROM portal_upload_staging WHERE id=$1', [staging.id]))
        .toMatchObject({ background_job_id: claimed.id, lease_token: claimed.lease_token });
      const settled = await jobs.settleMaterialsUploadJob({
        job: claimed,
        status,
        errorCode: 'test_failure',
        retryAt: status === 'queued' ? new Date(Date.now() + 60_000) : null,
        clearStageOwner: !expectation.owner,
        rejectStage: !expectation.owner,
      });
      expect(settled).toMatchObject({ status, attempt_count: expectation.attempts });
      const staged = await row('SELECT status, background_job_id, lease_token FROM portal_upload_staging WHERE id=$1', [staging.id]);
      expect(staged.status).toBe(expectation.status);
      expect(Boolean(staged.background_job_id)).toBe(expectation.owner);
      expect(staged.lease_token).toBeNull();
    }
  });

  test('operator retry and cancel are guarded by attention state and do not restore old browser ownership', async () => {
    const retryCollection = await makeCollection();
    const retryStage = await makeStaging({ requestId: retryCollection.requestId });
    const retryJob = await admit({ collection: retryCollection, staging: retryStage });
    await mockPoolRef.current.query(
      `UPDATE materials_upload_jobs SET status='needs_attention',completed_at=NOW(),error_code='uncertain_write'
        WHERE id=$1`, [retryJob.id],
    );
    const retry = await jobs.resolveMaterialsUploadJob({ jobId: retryJob.id, action: 'retry' });
    expect(retry).toMatchObject({ status: 'queued', error_code: null, lease_token: null });
    expect(await row('SELECT status, background_job_id FROM portal_upload_staging WHERE id=$1', [retryStage.id]))
      .toMatchObject({ status: 'pending', background_job_id: retryJob.id });
    await expect(stagingStore.claimPortalUpload({
      stagingId: retryStage.id,
      scope: 'site_visit_material',
      resourceId: retryCollection.requestId,
      actorBinding: retryStage.actorBinding,
    })).rejects.toMatchObject({ code: 'finalize_in_progress' });
    await expect(jobs.resolveMaterialsUploadJob({ jobId: retryJob.id, action: 'retry' }))
      .rejects.toMatchObject({ code: 'job_not_resolvable' });

    const cancelCollection = await makeCollection();
    const cancelStage = await makeStaging({ requestId: cancelCollection.requestId });
    const cancelJob = await admit({ collection: cancelCollection, staging: cancelStage });
    await mockPoolRef.current.query(
      `UPDATE materials_upload_jobs SET status='needs_attention',completed_at=NOW(),error_code='uncertain_write'
        WHERE id=$1`, [cancelJob.id],
    );
    const cancelled = await jobs.resolveMaterialsUploadJob({ jobId: cancelJob.id, action: 'cancel' });
    expect(cancelled).toMatchObject({ status: 'cancelled', error_code: 'operator_cancelled' });
    expect(await row('SELECT status, background_job_id, result_code FROM portal_upload_staging WHERE id=$1', [cancelStage.id]))
      .toMatchObject({ status: 'rejected', background_job_id: null, result_code: 'cancelled' });
    await expect(stagingStore.claimPortalUpload({
      stagingId: cancelStage.id,
      scope: 'site_visit_material',
      resourceId: cancelCollection.requestId,
      actorBinding: cancelStage.actorBinding,
    })).rejects.toMatchObject({ code: 'cancelled' });
  });

  test('consumed staging is claimable for receipt recovery without changing its receipt', async () => {
    const collection = await makeCollection();
    const staging = await makeStaging({ requestId: collection.requestId });
    const job = await admit({ collection, staging });
    await mockPoolRef.current.query(
      `UPDATE portal_upload_staging SET status='consumed',consumed_at=NOW(),result_code='ok',
         result_payload='{"receipt":"saved"}'::jsonb WHERE id=$1`, [staging.id],
    );
    const claimed = await jobs.claimNextMaterialsUploadJob();
    expect(claimed).toMatchObject({ id: job.id, status: 'processing', staging_status: 'consumed' });
    const done = await jobs.completeMaterialsUploadJob({ jobId: job.id, leaseToken: claimed.lease_token, resultPayload: { recovered: true } });
    expect(done).toMatchObject({ status: 'completed' });
    expect(await row('SELECT status, result_code, result_payload, consumed_at FROM portal_upload_staging WHERE id=$1', [staging.id]))
      .toMatchObject({ status: 'consumed', result_code: 'ok', result_payload: { receipt: 'saved' } });
  });

  test('staging foreign key restricts pruning, and terminal job metadata expires independently', async () => {
    const collection = await makeCollection();
    const staging = await makeStaging({ requestId: collection.requestId });
    const job = await admit({ collection, staging });
    await mockPoolRef.current.query(
      `UPDATE portal_upload_staging SET status='consumed',consumed_at=NOW(),result_code='ok',
         result_payload='{"receipt":"saved"}'::jsonb WHERE id=$1`, [staging.id],
    );
    const claimed = await jobs.claimNextMaterialsUploadJob();
    await jobs.completeMaterialsUploadJob({ jobId: job.id, leaseToken: claimed.lease_token, resultPayload: { ok: true } });
    expect(await row('SELECT status, background_job_id FROM portal_upload_staging WHERE id=$1', [staging.id]))
      .toMatchObject({ status: 'consumed', background_job_id: null });
    await mockPoolRef.current.query("UPDATE portal_upload_staging SET updated_at=NOW()-INTERVAL '40 days' WHERE id=$1", [staging.id]);
    await expect(mockPoolRef.current.query('DELETE FROM portal_upload_staging WHERE id=$1', [staging.id]))
      .rejects.toMatchObject({ code: '23503' });
    const pruned = await mockPoolRef.current.query(
      `DELETE FROM portal_upload_staging s WHERE s.id=$1 AND s.updated_at<NOW()-INTERVAL '30 days'
        AND s.status IN ('consumed','rejected','expired') AND s.candidate_result IS NULL
        AND NOT EXISTS (SELECT 1 FROM materials_upload_jobs j WHERE j.staging_id=s.id)`, [staging.id],
    );
    expect(pruned.rowCount).toBe(0);
    await mockPoolRef.current.query("UPDATE materials_upload_jobs SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1", [job.id]);
    expect(await jobs.pruneMaterialsUploadJobs()).toBe(1);
    const stageDelete = await mockPoolRef.current.query(
      `DELETE FROM portal_upload_staging WHERE id=$1 AND updated_at<NOW()-INTERVAL '30 days'
        AND status='consumed' AND candidate_result IS NULL`, [staging.id],
    );
    expect(stageDelete.rowCount).toBe(1);
    expect(await row('SELECT id FROM portal_upload_staging WHERE id=$1', [staging.id])).toBeUndefined();
  });
});
