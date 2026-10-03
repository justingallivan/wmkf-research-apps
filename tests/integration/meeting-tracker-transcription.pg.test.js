/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
import { createTranscriptionPilotStore } from '../../lib/services/transcription-pilot/store.js';

const { Client, Pool } = pg;
const TEST_URL = process.env.MEETING_TRACKER_TRANSCRIPTION_PG_TEST_URL || '';
if (TEST_URL) {
  let parsed;
  try { parsed = new URL(TEST_URL); } catch { throw new Error('MEETING_TRACKER_TRANSCRIPTION_PG_TEST_URL must be a valid local PostgreSQL URL.'); }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)
    || !['localhost', '127.0.0.1', '::1'].includes(hostname)) {
    throw new Error('Refusing Meeting Tracker integration proof unless the database host is localhost/loopback.');
  }
}
if (!TEST_URL && process.env.MEETING_TRACKER_TRANSCRIPTION_PG_TEST_REQUIRE === '1') {
  throw new Error('MEETING_TRACKER_TRANSCRIPTION_PG_TEST_REQUIRE=1 but MEETING_TRACKER_TRANSCRIPTION_PG_TEST_URL is unset.');
}
if (/neon\.tech|vercel-storage/i.test(TEST_URL)
  || (process.env.POSTGRES_URL && TEST_URL === process.env.POSTGRES_URL)) {
  throw new Error('Refusing the Meeting Tracker proof against a shared Production/Preview database.');
}

const describeIf = TEST_URL ? describe : describe.skip;
const MIGRATION_PATHS = [
  '060_transcription_jobs.sql',
  '061_transcription_workflow_dispatches.sql',
  '062_transcription_speaker_names.sql',
  '063_meeting_tracker_transcription.sql',
  '064_meeting_transcript_close_attribution.sql',
].map(file => path.join(process.cwd(), 'lib/db/migrations', file));
const uuid = () => crypto.randomUUID();

describeIf('Meeting Tracker publication store (isolated local Postgres proof)', () => {
  let admin;
  let pool;
  let store;
  let schema;
  let ownerId;
  const jobIds = [];
  const operationIds = [];
  const requestId = uuid();
  const siteVisitActivityId = uuid();
  const actorSystemId = uuid();

  async function makeReadyMeetingJob() {
    const id = uuid();
    const created = await store.createMeetingJob({
      id,
      ownerProfileId: ownerId,
      idempotencyKey: uuid(),
      requestId,
      siteVisitActivityId,
      originalFilename: `${id}.m4a`,
      declaredContentType: 'audio/mp4',
      declaredBytes: 8192,
      inputPathname: `transcription-pilot/${ownerId}/${id}/input.m4a`,
      providerRegion: 'us',
      requestedModel: 'universal-2',
      optionsSnapshot: { language_detection: false },
      expiresAt: new Date(Date.now() + 86400000),
      receiptExpiresAt: new Date(Date.now() + 30 * 86400000),
    });
    jobIds.push(created.job.id);
    await pool.query(
      `UPDATE transcription_jobs SET status='ready', output_pathname=$2, output_cleanup_pathname=$2,
         output_sha256=$3, ready_at=NOW(), speaker_names=$4::jsonb WHERE id=$1`,
      [id, `transcription-pilot/${ownerId}/${id}/output/transcript.json`, 'a'.repeat(64), JSON.stringify({ S1: 'Avery' })],
    );
    return store.getJob(id);
  }

  function candidatePaths(operationId) {
    const root = `requests/${requestId}/transcripts/${operationId}`;
    return {
      source: `${root}/${operationId}.json`,
      txt: `${root}/${operationId}.txt`,
      vtt: `${root}/${operationId}.vtt`,
    };
  }

  function fileDescriptor(filename, marker) {
    return {
      contentType: 'application/octet-stream', driveId: `drive-${marker}`, eTag: `etag-${marker}`,
      filename, itemId: `item-${marker}`, sha256: marker.repeat(64), siteId: `site-${marker}`,
      size: 128, versionId: `version-${marker}`,
    };
  }

  async function recordRecoverableFiles(operationId, leaseToken) {
    const paths = candidatePaths(operationId);
    const descriptors = Object.fromEntries(['source', 'txt', 'vtt'].map((role, index) => {
      const marker = ['b', 'c', 'd'][index];
      const descriptor = fileDescriptor(paths[role].split('/').at(-1), marker);
      return [role, descriptor];
    }));
    for (const role of ['source', 'txt', 'vtt']) {
      expect(await store.recordMeetingPublicationCandidate({ operationId, requestId, siteVisitActivityId,
        leaseToken, role, candidatePath: paths[role], descriptor: descriptors[role] })).toBeTruthy();
    }
    expect(await store.recordMeetingPublicationSlotFence({ operationId, requestId, siteVisitActivityId,
      leaseToken, fenceVersion: 7 })).toBeTruthy();
    return descriptors;
  }

  async function freeze(job, operationId) {
    operationIds.push(operationId);
    return store.freezeMeetingPublicationFromJob({
      operationId, jobId: job.id, requestId, siteVisitActivityId,
      initiatorProfileId: ownerId, publishedByProfileId: ownerId, actingUserSystemId: actorSystemId,
      expectedVersion: job.version, candidatePaths: candidatePaths(operationId),
      frozenInputSha256: 'e'.repeat(64), formatterVersion: '1',
    });
  }

  beforeAll(async () => {
    admin = new Client({ connectionString: TEST_URL });
    await admin.connect();
    schema = `meeting_tracker_test_${uuid().replace(/-/g, '')}`;
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ connectionString: TEST_URL, options: `-c search_path=${schema}` });
    const database = {
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
    await database.query('CREATE TABLE user_profiles (id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE)');
    const owner = await database.query("INSERT INTO user_profiles(name) VALUES ('tracker-owner') RETURNING id");
    ownerId = owner.rows[0].id;
    for (const migrationPath of MIGRATION_PATHS) await database.query(fs.readFileSync(migrationPath, 'utf8'));
    store = createTranscriptionPilotStore(database);
  });

  afterEach(async () => {
    if (operationIds.length) {
      await pool.query('DELETE FROM meeting_transcript_publications WHERE operation_id = ANY($1::uuid[])', [operationIds.splice(0)]);
    }
    if (jobIds.length) {
      await pool.query('DELETE FROM transcription_jobs WHERE id = ANY($1::uuid[])', [jobIds.splice(0)]);
    }
  });

  afterAll(async () => {
    if (pool) await pool.end();
    if (schema) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    if (admin) await admin.end();
  });

  it('applies migrations 063–064 with the paired binding, exclusive source, and close attribution constraints', async () => {
    const linkedJob = await makeReadyMeetingJob();
    const columns = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema=$1 AND table_name='meeting_transcript_publications'`, [schema],
    );
    expect(columns.rows.map(row => row.column_name)).toEqual(expect.arrayContaining([
      'closed_by_profile_id', 'input_job_id', 'source_artifact_id', 'lease_token', 'lease_expires_at',
    ]));
    const withNullBinding = await pool.query(
      `INSERT INTO transcription_jobs(id, owner_profile_id, expires_at, receipt_expires_at, request_id)
       VALUES($1,$2,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 days',$3)`, [uuid(), ownerId, requestId],
    ).catch(error => error);
    expect(withNullBinding.code).toBe('23514');
    expect(withNullBinding.constraint).toBe('transcription_jobs_request_visit_shape');

    const sourceConflict = await pool.query(
      `INSERT INTO meeting_transcript_publications(
         operation_id,request_id,site_visit_activity_id,initiator_profile_id,input_job_id,source_artifact_id,state
       ) VALUES($1,$2,$3,$4,$5,$6,'draft')`,
      [uuid(), requestId, siteVisitActivityId, ownerId, linkedJob.id, uuid()],
    ).catch(error => error);
    expect(sourceConflict.code).toBe('23514');
    expect(sourceConflict.constraint).toBe('meeting_transcript_publications_source_shape');
  });

  it('serializes competing request publications and blocks cleanup while the winning receipt is unresolved', async () => {
    const [firstJob, secondJob] = await Promise.all([makeReadyMeetingJob(), makeReadyMeetingJob()]);
    const firstOperation = uuid();
    const secondOperation = uuid();
    const results = await Promise.all([freeze(firstJob, firstOperation), freeze(secondJob, secondOperation)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const winnerIndex = results.findIndex(Boolean);
    const winner = results[winnerIndex];
    const winnerJob = winnerIndex === 0 ? firstJob : secondJob;
    const winnerOperation = winnerIndex === 0 ? firstOperation : secondOperation;
    expect(winner.publication.state).toBe('publishing');
    expect(await store.getMeetingPublication({ operationId: winnerOperation, requestId, siteVisitActivityId }))
      .toMatchObject({ input_job_id: winnerJob.id, published_by_profile_id: ownerId });

    await pool.query('UPDATE transcription_jobs SET lease_expires_at=NOW()-INTERVAL \'1 second\' WHERE id=$1', [winnerJob.id]);
    await expect(store.requestMeetingJobCleanup({ jobId: winnerJob.id, requestId, siteVisitActivityId,
      actorProfileId: ownerId, expectedVersion: winner.jobVersion })).rejects.toMatchObject({
      code: 'transcription_publication_unresolved',
    });
  });

  it('allows one recovery claimant and fences the prior publication lease token', async () => {
    const job = await makeReadyMeetingJob();
    const operationId = uuid();
    const frozen = await freeze(job, operationId);
    expect(frozen).toBeTruthy();
    const descriptors = await recordRecoverableFiles(operationId, frozen.publication.lease_token);
    const unknown = await store.transitionMeetingPublication({ operationId, requestId, siteVisitActivityId,
      expectedState: 'publishing', state: 'unknown', leaseToken: frozen.publication.lease_token,
      errorCode: 'publication_uncertain' });
    expect(unknown).toMatchObject({ state: 'unknown', slot_fence_version: 7 });
    await pool.query(`UPDATE meeting_transcript_publications SET lease_expires_at=NOW()-INTERVAL '1 second'
      WHERE operation_id=$1`, [operationId]);

    const [one, two] = await Promise.all([
      store.claimMeetingPublicationForRecovery({ operationId, requestId, siteVisitActivityId }),
      store.claimMeetingPublicationForRecovery({ operationId, requestId, siteVisitActivityId }),
    ]);
    expect([one, two].filter(Boolean)).toHaveLength(1);
    const recovery = one || two;
    expect(recovery.publication.state).toBe('publishing');
    expect(recovery.publication.verified_files).toEqual(descriptors);
    expect(await store.transitionMeetingPublication({ operationId, requestId, siteVisitActivityId,
      expectedState: 'publishing', state: 'published', leaseToken: frozen.publication.lease_token,
      resultingDocumentId: uuid() })).toBeNull();
    expect(await store.transitionMeetingPublication({ operationId, requestId, siteVisitActivityId,
      expectedState: 'publishing', state: 'published_reconcile', leaseToken: recovery.leaseToken,
      errorCode: 'registry_pending' })).toMatchObject({ state: 'published_reconcile', lease_token: null });
  });

  it('records the closing staff profile when a publication closes before external writes', async () => {
    const job = await makeReadyMeetingJob();
    const operationId = uuid();
    const frozen = await freeze(job, operationId);
    const closed = await store.closeMeetingPublicationWithoutWrites({ operationId, requestId,
      siteVisitActivityId, leaseToken: frozen.publication.lease_token, actorProfileId: ownerId });
    expect(closed).toMatchObject({ state: 'closed', closed_by_profile_id: ownerId, error_code: 'closed_before_write' });
  });
});
