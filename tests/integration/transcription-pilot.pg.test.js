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
const MIGRATION_PATH = path.join(process.cwd(), 'lib/db/migrations/060_transcription_jobs.sql');

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
    const migration = fs.readFileSync(MIGRATION_PATH, 'utf8');
    await db.query(migration);
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
});
