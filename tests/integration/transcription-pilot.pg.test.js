/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
import { createTranscriptionPilotStore } from '../../lib/services/transcription-pilot/store.js';

const { Client, Pool } = pg;
const TEST_URL = process.env.TRANSCRIPTION_PILOT_PG_TEST_URL || '';
if (TEST_URL) {
  let parsed;
  try { parsed = new URL(TEST_URL); } catch { throw new Error('TRANSCRIPTION_PILOT_PG_TEST_URL must be a valid local PostgreSQL URL.'); }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)
    || !['localhost', '127.0.0.1', '::1'].includes(hostname)) {
    throw new Error('Refusing transcription pilot integration proof unless the database host is localhost/loopback.');
  }
}
if (!TEST_URL && process.env.TRANSCRIPTION_PILOT_PG_TEST_REQUIRE === '1') {
  throw new Error('TRANSCRIPTION_PILOT_PG_TEST_REQUIRE=1 but TRANSCRIPTION_PILOT_PG_TEST_URL is unset.');
}
if (/neon\.tech|vercel-storage/i.test(TEST_URL)
  || (process.env.POSTGRES_URL && TEST_URL === process.env.POSTGRES_URL)) {
  throw new Error('Refusing to run the transcription pilot proof against a shared Production/Preview database.');
}
const describeIf = TEST_URL ? describe : describe.skip;
const MIGRATION_PATHS = [
  path.join(process.cwd(), 'lib/db/migrations/060_transcription_jobs.sql'),
  path.join(process.cwd(), 'lib/db/migrations/061_transcription_workflow_dispatches.sql'),
];

describeIf('transcription pilot store (isolated local Postgres proof)', () => {
  let admin;
  let pool;
  let store;
  let schema;
  let ownerId;
  let otherOwnerId;
  const ids = [];

  async function makeQueuedJob(overrides = {}) {
    const id = crypto.randomUUID();
    const created = await store.createJob({
      id, ownerProfileId: ownerId, idempotencyKey: crypto.randomUUID(),
      originalFilename: `${id}.m4a`, declaredContentType: 'audio/mp4', declaredBytes: 8192,
      inputPathname: `transcription-pilot/${id}/input.m4a`, providerRegion: 'us',
      requestedModel: 'universal-2', optionsSnapshot: { language_detection: false },
      expiresAt: new Date(Date.now() + 86400000), receiptExpiresAt: new Date(Date.now() + 30 * 86400000),
      ...overrides,
    });
    ids.push(created.job.id);
    const queued = await store.queueJob({
      jobId: id, ownerProfileId: ownerId, expectedVersion: created.job.version,
      acknowledgementAt: new Date(), verifiedContentType: 'audio/mp4', verifiedBytes: 8192,
      durationMs: 5000, sha256: 'a'.repeat(64), etag: 'test-etag',
    });
    expect(queued.status).toBe('queued');
    return queued;
  }

  beforeAll(async () => {
    admin = new Client({ connectionString: TEST_URL });
    await admin.connect();
    schema = `transcription_test_${crypto.randomUUID().replace(/-/g, '')}`;
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ connectionString: TEST_URL, options: `-c search_path=${schema}` });
    const db = {
      query: (text, params = []) => pool.query(text, params),
      async transaction(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const value = await fn({ query: (text, params = []) => client.query(text, params) });
          await client.query('COMMIT');
          return value;
        } catch (error) {
          await client.query('ROLLBACK').catch(() => {});
          throw error;
        } finally { client.release(); }
      },
    };
    await db.query('CREATE TABLE user_profiles (id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE)');
    const owners = await db.query("INSERT INTO user_profiles(name) VALUES ('pilot-owner'),('other-owner') RETURNING id");
    [ownerId, otherOwnerId] = owners.rows.map(row => row.id);
    for (const migrationPath of MIGRATION_PATHS) await db.query(fs.readFileSync(migrationPath, 'utf8'));
    store = createTranscriptionPilotStore(db);
  });

  afterAll(async () => {
    if (pool) await pool.end();
    if (schema) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    if (admin) await admin.end();
  });

  afterEach(async () => {
    if (ids.length) {
      await pool.query('DELETE FROM transcription_jobs WHERE id = ANY($1::uuid[])', [ids.splice(0)]);
    }
  });

  it('enforces owner-scoped reads, idempotent creation, and one global active slot under concurrency', async () => {
    const first = await makeQueuedJob();
    const replay = await store.createJob({
      id: crypto.randomUUID(), ownerProfileId: ownerId, idempotencyKey: first.idempotency_key,
      originalFilename: first.original_filename, declaredContentType: first.declared_content_type,
      declaredBytes: Number(first.declared_bytes), inputPathname: `transcription-pilot/${crypto.randomUUID()}/input.m4a`,
      providerRegion: first.provider_region, requestedModel: first.requested_model,
      optionsSnapshot: first.options_snapshot, expiresAt: first.expires_at, receiptExpiresAt: first.receipt_expires_at,
    });
    expect(replay.created).toBe(false);
    expect(replay.job.id).toBe(first.id);
    expect(await store.getOwnerJob({ jobId: first.id, ownerProfileId: otherOwnerId })).toBeNull();
    const cleanupProof = await makeQueuedJob();
    expect(await store.requestCleanup({
      jobId: cleanupProof.id, ownerProfileId: otherOwnerId, expectedVersion: cleanupProof.version,
    })).toBeNull();
    expect((await store.getJob(cleanupProof.id)).cleanup_requested_at).toBeNull();
    const requested = await store.requestCleanup({
      jobId: cleanupProof.id, ownerProfileId: ownerId, expectedVersion: cleanupProof.version,
    });
    expect(requested.cleanup_requested_at).toBeTruthy();
    expect(requested.original_filename).toBeNull();
    expect(requested.correction_notes).toBeNull();

    const second = await makeQueuedJob();
    const eligible = await pool.query("SELECT count(*)::int AS n FROM transcription_jobs WHERE status='queued' AND cleanup_requested_at IS NULL AND id = ANY($1::uuid[])", [[first.id, second.id]]);
    expect(eligible.rows[0].n).toBe(2);
    const [a, b] = await Promise.all([
      store.claimNextQueuedJob(),
      store.claimNextQueuedJob(),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    const claimed = a || b;
    expect([first.id, second.id]).toContain(claimed.id);
    expect(claimed.status).toBe('submitting');
    const active = await pool.query("SELECT count(*)::int AS n FROM transcription_jobs WHERE status IN ('submitting','processing','saving','submission_uncertain')");
    expect(active.rows[0].n).toBe(1);
  });

  it('fences duplicate workflow starts with dispatch lease, attempt number, and late-ack CAS', async () => {
    const queued = await makeQueuedJob();
    const [first, duplicate] = await Promise.all([
      store.claimWorkflowDispatch({ jobId: queued.id, ownerProfileId: ownerId }),
      store.claimWorkflowDispatch({ jobId: queued.id, ownerProfileId: ownerId }),
    ]);
    expect([first, duplicate].filter(Boolean)).toHaveLength(1);
    const claim = first || duplicate;
    expect(claim.state).toBe('dispatching');
    expect(claim.attempt_no).toBe(1);
    expect(await store.acknowledgeWorkflowDispatch({ jobId: queued.id, dispatchToken: claim.dispatch_token,
      attemptNo: claim.attempt_no, workflowRunId: 'run_fixture_1' })).toMatchObject({ state: 'running' });
    expect(await store.checkWorkflowDispatchAttempt({ jobId: queued.id, attemptNo: 1 })).toBe('running');
    expect(await store.finishWorkflowDispatch({ jobId: queued.id, attemptNo: 1 })).toMatchObject({ state: 'completed' });
    expect(await store.acknowledgeWorkflowDispatch({ jobId: queued.id, dispatchToken: claim.dispatch_token,
      attemptNo: claim.attempt_no, workflowRunId: 'run_fixture_late' })).toBeNull();
    expect(await store.getWorkflowDispatch({ jobId: queued.id })).toMatchObject({ state: 'completed', attempt_no: 1 });
  });

  it.each(['reconcile', 'callback'])('fences an old attention workflow after %s re-arms delivery', async recovery => {
    const queued = await makeQueuedJob();
    const dispatch = await store.claimWorkflowDispatch({ jobId: queued.id, ownerProfileId: ownerId });
    await store.acknowledgeWorkflowDispatch({ jobId: queued.id, dispatchToken: dispatch.dispatch_token,
      attemptNo: dispatch.attempt_no, workflowRunId: 'run_before_recovery' });
    await pool.query(`UPDATE transcription_jobs SET status='submission_uncertain', submission_intent_at=NOW(),
      attempt_correlation_id=$2, provider_upload_ref_ciphertext='fixture-reference',
      callback_candidate_transcript_id='verified-candidate' WHERE id=$1`, [queued.id, crypto.randomUUID()]);
    if (recovery === 'reconcile') {
      const lease = await store.claimUncertainForReconcile({ jobId: queued.id, ownerProfileId: ownerId });
      expect(await store.reconcileVerifiedProviderId({ jobId: queued.id, ownerProfileId: ownerId,
        leaseToken: lease.leaseToken, expectedVersion: lease.job.version,
        providerTranscriptId: 'verified-candidate' })).toMatchObject({ status: 'processing' });
    } else {
      expect(await store.rearmWorkflowDispatch({ jobId: queued.id })).toBeTruthy();
    }
    expect(await store.getWorkflowDispatch({ jobId: queued.id })).toMatchObject({ state: 'pending' });
    expect(await store.finishWorkflowDispatch({ jobId: queued.id, attemptNo: dispatch.attempt_no })).toBeNull();
    expect(await store.acknowledgeWorkflowDispatch({ jobId: queued.id, dispatchToken: dispatch.dispatch_token,
      attemptNo: dispatch.attempt_no, workflowRunId: 'late_run' })).toBeNull();
  });

  it('recovers pre-intent leases to queued and post-intent leases to uncertain without permitting a second claim', async () => {
    const queued = await makeQueuedJob();
    const firstClaim = await store.claimQueuedJob({ jobId: queued.id });
    expect(firstClaim.lease_token).toBeTruthy();
    await pool.query('UPDATE transcription_jobs SET lease_expires_at = NOW() - INTERVAL \'1 second\' WHERE id = $1', [queued.id]);
    expect((await store.requeueExpiredPreIntentSubmissions()).map(row => row.id)).toContain(queued.id);
    const staleWrite = await store.mutateLeasedJob({
      jobId: queued.id, leaseToken: firstClaim.lease_token, expectedVersion: firstClaim.version,
      expectedStatuses: ['submitting'], fields: { sanitized_error_code: 'stale' },
    });
    expect(staleWrite).toBeNull();

    const secondClaim = await store.claimQueuedJob({ jobId: queued.id });
    const ref = await store.setProviderUploadReference({
      jobId: queued.id, leaseToken: secondClaim.lease_token, expectedVersion: secondClaim.version,
      ciphertext: 'encrypted-reference-fixture',
    });
    const intent = await store.beginProviderSubmission({
      jobId: queued.id, leaseToken: secondClaim.lease_token, expectedVersion: ref.version,
    });
    expect(intent.attempt_correlation_id).toBeTruthy();
    await pool.query('UPDATE transcription_jobs SET lease_expires_at = NOW() - INTERVAL \'1 second\' WHERE id = $1', [queued.id]);
    const uncertain = await store.markExpiredSubmittingUncertain();
    expect(uncertain.map(row => row.id)).toContain(queued.id);
    expect(uncertain.find(row => row.id === queued.id).status).toBe('submission_uncertain');
    expect(await store.claimNextQueuedJob()).toBeNull();
  });

  it('sends a DELETE-during-pre-intent expired lease to expired cleanup claim', async () => {
    const queued = await makeQueuedJob();
    const claimed = await store.claimQueuedJob({ jobId: queued.id });
    const deleting = await store.requestCleanup({
      jobId: queued.id, ownerProfileId: ownerId, expectedVersion: claimed.version,
    });
    expect(deleting.status).toBe('submitting');
    await pool.query('UPDATE transcription_jobs SET lease_expires_at = NOW() - INTERVAL \'1 second\' WHERE id = $1', [queued.id]);

    const recovered = await store.requeueExpiredPreIntentSubmissions();
    expect(recovered.find(row => row.id === queued.id).status).toBe('expired');
    expect(recovered.find(row => row.id === queued.id).lease_token).toBeNull();
    const cleanupClaim = await store.claimNextCleanupJob();
    expect(cleanupClaim.job.id).toBe(queued.id);
    expect(cleanupClaim.job.status).toBe('expired');
    expect(cleanupClaim.leaseToken).toBeTruthy();
    expect(cleanupClaim.job.input_cleanup_pathname).toBe(queued.input_cleanup_pathname);
  });

  it('rejects a lease release with a different token while the real lease is live', async () => {
    const queued = await makeQueuedJob();
    const claimed = await store.claimQueuedJob({ jobId: queued.id });
    const wrongToken = crypto.randomUUID();
    expect(await store.getLeasedJob({ jobId: queued.id, leaseToken: wrongToken })).toBeNull();
    expect(await store.releaseLease({
      jobId: queued.id, leaseToken: wrongToken, expectedVersion: claimed.version,
      expectedStatuses: ['submitting'],
    })).toBeNull();
    const persisted = await store.getJob(queued.id);
    expect(persisted.lease_token).toBe(claimed.lease_token);
    expect(persisted.lease_expires_at.getTime()).toBeGreaterThan(Date.now());
  });

  it('records callback candidates independently, binds only under the live lease, and persists ID conflicts', async () => {
    const queued = await makeQueuedJob();
    const claimed = await store.claimQueuedJob({ jobId: queued.id });
    const ref = await store.setProviderUploadReference({ jobId: queued.id, leaseToken: claimed.lease_token, expectedVersion: claimed.version, ciphertext: 'cipher' });
    const intent = await store.beginProviderSubmission({ jobId: queued.id, leaseToken: claimed.lease_token, expectedVersion: ref.version });
    const candidate = await store.recordCallbackCandidate({ attemptCorrelationId: intent.attempt_correlation_id, providerTranscriptId: 'transcript-candidate' });
    expect(candidate.recorded).toBe(true);
    const leased = await store.getLeasedJob({ jobId: queued.id, leaseToken: claimed.lease_token });
    const bound = await store.bindVerifiedProviderId({
      jobId: queued.id, leaseToken: claimed.lease_token, expectedVersion: leased.version,
      providerTranscriptId: 'transcript-candidate',
    });
    expect(bound.job.status).toBe('processing');
    expect(bound.job.provider_transcript_id).toBe('transcript-candidate');
    const mismatch = await store.recordCallbackCandidate({ attemptCorrelationId: intent.attempt_correlation_id, providerTranscriptId: 'different-candidate' });
    expect(mismatch.conflict).toBe(true);
    expect(mismatch.job.provider_id_conflict).toBe(true);
    expect(mismatch.job.conflicting_transcript_id).toBe('different-candidate');
  });

  it('fails closed on NULL ready hashes, invalid uncertain shapes, and false content-purge receipts', async () => {
    const queued = await makeQueuedJob();
    const claimed = await store.claimQueuedJob({ jobId: queued.id });
    const ref = await store.setProviderUploadReference({ jobId: queued.id, leaseToken: claimed.lease_token, expectedVersion: claimed.version, ciphertext: 'cipher' });
    const intent = await store.beginProviderSubmission({ jobId: queued.id, leaseToken: claimed.lease_token, expectedVersion: ref.version });
    const bound = await store.bindVerifiedProviderId({
      jobId: queued.id, leaseToken: claimed.lease_token, expectedVersion: intent.version,
      providerTranscriptId: 'transcript-for-checks',
    });
    await expect(pool.query(
      `UPDATE transcription_jobs SET status='ready', output_pathname='transcription-pilot/x/output.json',
        output_cleanup_pathname='transcription-pilot/x/output.json', ready_at=NOW(), output_sha256=NULL WHERE id=$1`,
      [queued.id],
    )).rejects.toMatchObject({ code: '23514', constraint: 'transcription_jobs_ready_shape' });
    await expect(pool.query(
      `UPDATE transcription_jobs SET status='submission_uncertain', lease_token=NULL, lease_expires_at=NULL,
        submission_intent_at=NULL, attempt_correlation_id=NULL, provider_upload_ref_ciphertext=NULL WHERE id=$1`,
      [queued.id],
    )).rejects.toMatchObject({ code: '23514', constraint: 'transcription_jobs_uncertain_shape' });
    await expect(pool.query(
      `UPDATE transcription_jobs SET content_purged_at=NOW() WHERE id=$1`, [queued.id],
    )).rejects.toMatchObject({ code: '23514', constraint: 'transcription_jobs_purged_content_shape' });
    expect(bound.job.status).toBe('processing');
  });

  it.each(['processing', 'saving'])('claims %s cleanup after DELETE and lease expiry', async status => {
    const queued = await makeQueuedJob();
    await pool.query(
      `UPDATE transcription_jobs SET status=$2, cleanup_requested_at=NOW(),
         lease_token=$3, lease_expires_at=NOW()-INTERVAL '1 second'
       WHERE id=$1`,
      [queued.id, status, crypto.randomUUID()],
    );
    const claim = await store.claimCleanup({ jobId: queued.id });
    expect(claim.job.id).toBe(queued.id);
    expect(claim.job.status).toBe(status);
    expect(claim.leaseToken).toBeTruthy();
    expect(claim.job.input_cleanup_pathname).toBe(queued.input_cleanup_pathname);
  });

  it('keeps failed remote deletion independently claimable after local cleanup completes', async () => {
    const queued = await makeQueuedJob();
    await pool.query(
      `UPDATE transcription_jobs SET status='failed', cleanup_requested_at=NOW(),
         local_cleanup_completed_at=NOW(), content_purged_at=NOW(),
         input_cleanup_pathname=NULL, audio_pathname=NULL,
         original_filename=NULL, audio_sha256=NULL, audio_etag=NULL,
         provider_transcript_id='remote-pending-fixture', provider_cleanup_completed_at=NULL
       WHERE id=$1`, [queued.id],
    );
    const claim = await store.claimCleanup({ jobId: queued.id });
    expect(claim.job.id).toBe(queued.id);
    expect(claim.job.provider_transcript_id).toBe('remote-pending-fixture');
    expect(claim.job.local_cleanup_completed_at).toBeTruthy();
  });

  it('retains provider receipt identity through purge, then stops claiming after remote resolution', async () => {
    const queued = await makeQueuedJob();
    await pool.query(
      `UPDATE transcription_jobs SET status='failed', expires_at=NOW()-INTERVAL '1 day',
         receipt_expires_at=NOW()-INTERVAL '1 day', content_purged_at=NOW(),
         local_cleanup_completed_at=NOW(), input_cleanup_pathname=NULL, audio_pathname=NULL,
         original_filename=NULL, audio_sha256=NULL, audio_etag=NULL,
         provider_transcript_id='remote-receipt-fixture', provider_region='eu'
       WHERE id=$1`, [queued.id],
    );
    const claim = await store.claimCleanup({ jobId: queued.id });
    const purged = await store.purgeExpiredReceipt({
      jobId: queued.id, leaseToken: claim.leaseToken, expectedVersion: claim.job.version,
    });
    expect(purged.provider_transcript_id).toBe('remote-receipt-fixture');
    expect(purged.provider_region).toBe('eu');
    expect(purged.receipt_purged_at).toBeTruthy();
    const sameLease = await store.getLeasedJob({ jobId: queued.id, leaseToken: claim.leaseToken });
    expect(await store.purgeExpiredReceipt({
      jobId: queued.id, leaseToken: claim.leaseToken, expectedVersion: sameLease.version,
    })).toBeNull();
    const resolved = await store.markProviderDeletionCompleted({
      jobId: queued.id, leaseToken: claim.leaseToken, expectedVersion: sameLease.version,
    });
    expect(resolved.provider_transcript_id).toBeNull();
    expect(resolved.provider_region).toBe('eu');
    const released = await store.releaseLease({
      jobId: queued.id, leaseToken: claim.leaseToken, expectedVersion: resolved.version,
      expectedStatuses: ['failed'],
    });
    expect(released.lease_token).toBeNull();
    expect(await store.claimCleanup({ jobId: queued.id })).toBeNull();
    expect(await store.claimNextCleanupJob()).toBeNull();
  });

  it('keeps upload-reservation reaping pending indefinitely while retaining the exact target', async () => {
    const queued = await makeQueuedJob();
    await pool.query(
      `UPDATE transcription_jobs SET cleanup_requested_at=NOW(), upload_valid_until=NOW()+INTERVAL '1 minute',
         receipt_expires_at=NOW()-INTERVAL '1 second'
       WHERE id=$1`, [queued.id],
    );
    let claim = await store.claimCleanup({ jobId: queued.id });
    let finished = await store.finishLocalCleanup({
      jobId: queued.id, leaseToken: claim.leaseToken, expectedVersion: claim.job.version,
      deletedPaths: ['input_cleanup_pathname'],
    });
    expect(finished.input_cleanup_pathname).toBe(queued.input_cleanup_pathname);
    expect(finished.audio_pathname).toBeNull();
    expect(finished.content_purged_at).toBeTruthy();
    await pool.query(`UPDATE transcription_jobs SET lease_expires_at=NOW()-INTERVAL '1 second',
      upload_valid_until=NOW()-INTERVAL '6 minutes' WHERE id=$1`, [queued.id]);
    claim = await store.claimCleanup({ jobId: queued.id });
    finished = await store.finishLocalCleanup({
      jobId: queued.id, leaseToken: claim.leaseToken, expectedVersion: claim.job.version,
      deletedPaths: ['input_cleanup_pathname'],
    });
    expect(finished.input_cleanup_pathname).toBe(queued.input_cleanup_pathname);
    expect(finished.audio_pathname).toBeNull();
    expect(finished.content_purged_at).toBeTruthy();
    expect(finished.local_cleanup_completed_at).toBeNull();
    const receiptPurged = await store.purgeExpiredReceipt({
      jobId: queued.id, leaseToken: claim.leaseToken, expectedVersion: finished.version,
    });
    expect(receiptPurged.input_cleanup_pathname).toBe(queued.input_cleanup_pathname);
    expect(receiptPurged.receipt_purged_at).toBeTruthy();
    await pool.query(`UPDATE transcription_jobs SET lease_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1`, [queued.id]);
    const repeatedClaim = await store.claimCleanup({ jobId: queued.id });
    expect(repeatedClaim.job.input_cleanup_pathname).toBe(queued.input_cleanup_pathname);
    const repeatedFinish = await store.finishLocalCleanup({
      jobId: queued.id, leaseToken: repeatedClaim.leaseToken, expectedVersion: repeatedClaim.job.version,
      deletedPaths: ['input_cleanup_pathname'],
    });
    expect(repeatedFinish.input_cleanup_pathname).toBe(queued.input_cleanup_pathname);
    expect(repeatedFinish.receipt_purged_at).toBeTruthy();
  });

  it('does not resolve a conflicting provider binding through DELETE cleanup', async () => {
    const queued = await makeQueuedJob();
    await pool.query(
      `UPDATE transcription_jobs SET status='processing', cleanup_requested_at=NOW(),
         submission_intent_at=NOW(), attempt_correlation_id=$2,
         provider_transcript_id='bound-conflict-fixture', callback_candidate_transcript_id='bound-conflict-fixture',
         conflicting_transcript_id='different-conflict-fixture', provider_id_conflict=TRUE,
         provider_upload_ref_ciphertext='cipher'
       WHERE id=$1`, [queued.id, crypto.randomUUID()],
    );
    const claim = await store.claimCleanup({ jobId: queued.id });
    const result = await store.markProviderDeletionCompleted({
      jobId: queued.id, leaseToken: claim.leaseToken, expectedVersion: claim.job.version,
    });
    expect(result).toBeNull();
    const persisted = await store.getJob(queued.id);
    expect(persisted.status).toBe('processing');
    expect(persisted.provider_transcript_id).toBe('bound-conflict-fixture');
    expect(persisted.provider_id_conflict).toBe(true);
    expect(persisted.conflicting_transcript_id).toBe('different-conflict-fixture');
    expect(persisted.provider_cleanup_completed_at).toBeNull();
    const uncertain = await store.mutateLeasedJob({
      jobId: queued.id, leaseToken: claim.leaseToken, expectedVersion: persisted.version,
      expectedStatuses: ['processing', 'saving'], fields: { status: 'submission_uncertain' }, allowCleanup: true,
    });
    expect(uncertain.status).toBe('submission_uncertain');
    expect(uncertain.cleanup_requested_at).toBeTruthy();
    expect(uncertain.provider_id_conflict).toBe(true);
    expect(await store.markProviderDeletionCompleted({ jobId: queued.id, leaseToken: claim.leaseToken,
      expectedVersion: uncertain.version })).toBeNull();
  });

  it('claims expired content while retaining a known active provider binding', async () => {
    const queued = await makeQueuedJob();
    await pool.query(
      `UPDATE transcription_jobs SET status='processing', provider_transcript_id='known-active-fixture',
         submission_intent_at=NOW(), attempt_correlation_id=$2, provider_upload_ref_ciphertext='cipher',
         expires_at=NOW()-INTERVAL '1 second'
       WHERE id=$1`, [queued.id, crypto.randomUUID()],
    );
    const claim = await store.claimNextExpiredContentJob();
    expect(claim.job.id).toBe(queued.id);
    expect(claim.job.provider_transcript_id).toBe('known-active-fixture');
    expect(claim.job.status).toBe('processing');
    expect(claim.leaseToken).toBeTruthy();
  });
});
