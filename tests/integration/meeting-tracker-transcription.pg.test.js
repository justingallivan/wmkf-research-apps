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
  '065_transcription_zoom_transcript.sql',
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

  describe('Zoom transcript alignment fences (migration 065)', () => {
    async function makeAlignmentJob({ alignment = { status: 'pending', attempts: 0 }, names = {}, zoom = true } = {}) {
      const id = uuid();
      const zoomPath = `transcription-pilot/${ownerId}/${id}/input/zoom-transcript.vtt`;
      const created = await store.createMeetingJob({
        id, ownerProfileId: ownerId, idempotencyKey: uuid(), requestId, siteVisitActivityId,
        originalFilename: `${id}.m4a`, declaredContentType: 'audio/mp4', declaredBytes: 8192,
        inputPathname: `transcription-pilot/${ownerId}/${id}/input/a.m4a`,
        zoomTranscriptCleanupPathname: zoom ? zoomPath : undefined,
        providerRegion: 'us', requestedModel: 'universal-2', optionsSnapshot: {},
        expiresAt: new Date(Date.now() + 86400000), receiptExpiresAt: new Date(Date.now() + 30 * 86400000),
      });
      jobIds.push(created.job.id);
      await pool.query(
        `UPDATE transcription_jobs SET status='ready', output_pathname=$2, output_cleanup_pathname=$2,
           output_sha256=$3, ready_at=NOW(), speaker_names=$4::jsonb,
           zoom_transcript_pathname=$5, zoom_transcript_sha256=$6, speaker_alignment=$7::jsonb WHERE id=$1`,
        [id, `transcription-pilot/${ownerId}/${id}/output/transcript.json`, 'a'.repeat(64), JSON.stringify(names),
          zoom ? zoomPath : null, zoom ? 'b'.repeat(64) : null, alignment ? JSON.stringify(alignment) : null],
      );
      return store.getJob(id);
    }
    const expireLease = id => pool.query(`UPDATE transcription_jobs SET lease_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1`, [id]);

    it('queues a Zoom job with the live pointer and hash, and publishReady stamps pending only with a Zoom pathname', async () => {
      for (const withZoom of [true, false]) {
        const id = uuid();
        const created = await store.createMeetingJob({
          id, ownerProfileId: ownerId, idempotencyKey: uuid(), requestId, siteVisitActivityId,
          originalFilename: 'a.m4a', declaredContentType: 'audio/mp4', declaredBytes: 8192,
          inputPathname: `transcription-pilot/${ownerId}/${id}/input/a.m4a`,
          zoomTranscriptCleanupPathname: withZoom ? `transcription-pilot/${ownerId}/${id}/input/zoom-transcript.vtt` : undefined,
          providerRegion: 'us', requestedModel: 'universal-2', optionsSnapshot: {},
          expiresAt: new Date(Date.now() + 86400000), receiptExpiresAt: new Date(Date.now() + 30 * 86400000),
        });
        jobIds.push(id);
        const queued = await store.queueMeetingJob({ jobId: id, requestId, siteVisitActivityId, actorProfileId: ownerId,
          expectedVersion: created.job.version, acknowledgementAt: new Date(), verifiedContentType: 'audio/mp4',
          verifiedBytes: 8192, durationMs: 5000, sha256: 'a'.repeat(64), etag: null,
          zoomTranscriptSha256: withZoom ? 'b'.repeat(64) : null });
        expect(queued.zoom_transcript_pathname).toBe(withZoom ? queued.zoom_transcript_cleanup_pathname : null);
        expect(queued.zoom_transcript_sha256).toBe(withZoom ? 'b'.repeat(64) : null);
        const token = uuid();
        await pool.query(`UPDATE transcription_jobs SET status='saving', provider_transcript_id='p-'||$1::text,
          lease_token=$2, lease_expires_at=NOW()+INTERVAL '1 minute' WHERE id=$1`, [id, token]);
        const current = await store.getJob(id);
        const ready = await store.publishReady({ jobId: id, leaseToken: token, expectedVersion: current.version,
          outputPathname: `transcription-pilot/${ownerId}/${id}/output/transcript.json`, outputSha256: 'c'.repeat(64) });
        expect(ready.status).toBe('ready');
        expect(ready.speaker_alignment).toEqual(withZoom ? { status: 'pending', attempts: 0 } : null);
      }
    });

    it('claims once, refuses a live-lease running row and exhausted attempts', async () => {
      const job = await makeAlignmentJob();
      const [one, two] = await Promise.all([store.claimJobForAlignment({ jobId: job.id }), store.claimJobForAlignment({ jobId: job.id })]);
      expect([one, two].filter(Boolean)).toHaveLength(1);
      const claimed = one || two;
      expect(claimed.job.speaker_alignment).toMatchObject({ status: 'running', attempts: 1 });
      expect(claimed.job.version).toBe(job.version + 1);
      expect(await store.claimJobForAlignment({ jobId: job.id })).toBeNull();
      await expireLease(job.id);
      const reclaimed = await store.claimJobForAlignment({ jobId: job.id });
      expect(reclaimed.job.speaker_alignment).toMatchObject({ status: 'running', attempts: 2 });
      await pool.query(`UPDATE transcription_jobs SET lease_token=NULL, lease_expires_at=NULL,
        speaker_alignment='{"status":"pending","attempts":3}'::jsonb WHERE id=$1`, [job.id]);
      expect(await store.claimJobForAlignment({ jobId: job.id })).toBeNull();
      const noZoom = await makeAlignmentJob({ zoom: false, alignment: null });
      expect(await store.claimJobForAlignment({ jobId: noZoom.id })).toBeNull();
    });

    it('completeAlignment writes once; a stale token, stale version, or hand-edited names write nothing', async () => {
      const job = await makeAlignmentJob();
      const first = await store.claimJobForAlignment({ jobId: job.id });
      const result = { speakerNames: { A: 'Chair' }, alignment: { status: 'applied', attempts: 1 } };
      expect(await store.completeAlignment({ jobId: job.id, leaseToken: uuid(), expectedVersion: first.job.version, ...result })).toBeNull();
      expect(await store.completeAlignment({ jobId: job.id, leaseToken: first.leaseToken, expectedVersion: first.job.version - 1, ...result })).toBeNull();
      await pool.query(`UPDATE transcription_jobs SET speaker_names='{"A":"Hand edit"}'::jsonb WHERE id=$1`, [job.id]);
      expect(await store.completeAlignment({ jobId: job.id, leaseToken: first.leaseToken, expectedVersion: first.job.version, ...result })).toBeNull();
      await pool.query(`UPDATE transcription_jobs SET speaker_names='{}'::jsonb WHERE id=$1`, [job.id]);
      const done = await store.completeAlignment({ jobId: job.id, leaseToken: first.leaseToken, expectedVersion: first.job.version, ...result });
      expect(done).toMatchObject({ speaker_names: { A: 'Chair' }, speaker_alignment: { status: 'applied' }, lease_token: null });
      expect(done.version).toBe(first.job.version + 1);
      expect(await store.completeAlignment({ jobId: job.id, leaseToken: first.leaseToken, expectedVersion: first.job.version, ...result })).toBeNull();
    });

    it('an expired-lease reclaim fences the old token out', async () => {
      const job = await makeAlignmentJob();
      const first = await store.claimJobForAlignment({ jobId: job.id });
      await expireLease(job.id);
      const second = await store.claimJobForAlignment({ jobId: job.id });
      expect(await store.completeAlignment({ jobId: job.id, leaseToken: first.leaseToken, expectedVersion: first.job.version,
        speakerNames: { A: 'Old' }, alignment: { status: 'applied' } })).toBeNull();
      expect(await store.failAlignment({ jobId: job.id, leaseToken: first.leaseToken, expectedVersion: first.job.version,
        code: 'x' })).toBeNull();
      expect((await store.getJob(job.id)).lease_token).toBe(second.leaseToken);
    });

    it('failAlignment returns to pending after attempts 1 and 2 and fails on the third non-terminal attempt', async () => {
      const job = await makeAlignmentJob();
      const expected = ['pending', 'pending', 'failed'];
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const claimed = await store.claimJobForAlignment({ jobId: job.id });
        expect(claimed.job.speaker_alignment.attempts).toBe(attempt);
        const failed = await store.failAlignment({ jobId: job.id, leaseToken: claimed.leaseToken,
          expectedVersion: claimed.job.version, code: 'executor_timeout' });
        expect(failed).toMatchObject({ lease_token: null,
          speaker_alignment: { status: expected[attempt - 1], attempts: attempt, code: 'executor_timeout' } });
      }
      expect(await store.claimJobForAlignment({ jobId: job.id })).toBeNull();
      const terminalJob = await makeAlignmentJob();
      const claimed = await store.claimJobForAlignment({ jobId: terminalJob.id });
      const terminal = await store.failAlignment({ jobId: terminalJob.id, leaseToken: claimed.leaseToken,
        expectedVersion: claimed.job.version, terminal: true, code: 'zoom_transcript_missing' });
      expect(terminal.speaker_alignment).toMatchObject({ status: 'failed', code: 'zoom_transcript_missing' });
    });

    it('with an expired lease and no reclaim, the still-current token and version cannot complete or fail', async () => {
      const job = await makeAlignmentJob();
      const claimed = await store.claimJobForAlignment({ jobId: job.id });
      await expireLease(job.id);
      expect(await store.completeAlignment({ jobId: job.id, leaseToken: claimed.leaseToken, expectedVersion: claimed.job.version,
        speakerNames: { A: 'Late' }, alignment: { status: 'applied' } })).toBeNull();
      expect(await store.failAlignment({ jobId: job.id, leaseToken: claimed.leaseToken, expectedVersion: claimed.job.version,
        code: 'late' })).toBeNull();
      expect((await store.getJob(job.id)).speaker_names).toEqual({});
    });

    it('a hand edit on a running row with an expired lease supersedes it and the claim then finds nothing', async () => {
      const job = await makeAlignmentJob();
      await store.claimJobForAlignment({ jobId: job.id });
      await expireLease(job.id);
      const current = await store.getJob(job.id);
      const updated = await store.updateMeetingSpeakerNames({ jobId: job.id, requestId, siteVisitActivityId,
        expectedVersion: current.version, actorProfileId: ownerId, speakerNames: { A: 'Hand' } });
      expect(updated.speaker_alignment).toMatchObject({ status: 'superseded', attempts: 1 });
      expect(await store.claimJobForAlignment({ jobId: job.id })).toBeNull();
    });

    it('never claims a job that has a publication row', async () => {
      const job = await makeAlignmentJob();
      const operationId = uuid();
      operationIds.push(operationId);
      await pool.query(
        `INSERT INTO meeting_transcript_publications(operation_id, request_id, site_visit_activity_id,
           initiator_profile_id, input_job_id, state) VALUES($1,$2,$3,$4,$5,'closed')`,
        [operationId, requestId, siteVisitActivityId, ownerId, job.id],
      );
      expect(await store.claimJobForAlignment({ jobId: job.id })).toBeNull();
      expect(await store.claimNextPendingAlignmentJob({ limit: 50 })).not.toContain(job.id);
    });

    it('expireExhaustedAlignments fails running+attempts>=3 with a free or expired lease and spares a live lease', async () => {
      const exhausted = '{"status":"running","attempts":3}';
      const expired = await makeAlignmentJob({ alignment: JSON.parse(exhausted) });
      const released = await makeAlignmentJob({ alignment: JSON.parse(exhausted) });
      const live = await makeAlignmentJob({ alignment: JSON.parse(exhausted) });
      const under = await makeAlignmentJob({ alignment: { status: 'running', attempts: 2 } });
      await pool.query(`UPDATE transcription_jobs SET lease_token=$2, lease_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1`, [expired.id, uuid()]);
      await pool.query(`UPDATE transcription_jobs SET lease_token=$2, lease_expires_at=NOW()+INTERVAL '5 minutes' WHERE id=$1`, [live.id, uuid()]);
      const rows = await store.expireExhaustedAlignments({ limit: 50 });
      expect(rows.map(row => row.id).sort()).toEqual([expired.id, released.id].sort());
      for (const id of [expired.id, released.id]) {
        expect(await store.getJob(id)).toMatchObject({ lease_token: null,
          speaker_alignment: { status: 'failed', code: 'attempts_exhausted' } });
      }
      expect((await store.getJob(live.id)).speaker_alignment.status).toBe('running');
      expect((await store.getJob(under.id)).speaker_alignment.status).toBe('running');
    });

    it('recovery scan reaches a running row with a released or expired lease and skips live leases and fresh pending', async () => {
      const fresh = await makeAlignmentJob();
      const stale = await makeAlignmentJob();
      const running = await makeAlignmentJob({ alignment: { status: 'running', attempts: 1 } });
      const live = await makeAlignmentJob({ alignment: { status: 'running', attempts: 1 } });
      await pool.query(`UPDATE transcription_jobs SET updated_at=NOW()-INTERVAL '10 minutes' WHERE id=$1`, [stale.id]);
      await pool.query(`UPDATE transcription_jobs SET lease_token=$2, lease_expires_at=NOW()+INTERVAL '5 minutes' WHERE id=$1`, [live.id, uuid()]);
      const ids = await store.claimNextPendingAlignmentJob({ limit: 50 });
      expect(ids).toEqual(expect.arrayContaining([stale.id, running.id]));
      expect(ids).not.toContain(fresh.id);
      expect(ids).not.toContain(live.id);
    });

    it('a hand edit supersedes a pending alignment (including an empty save) and the claim then finds nothing', async () => {
      for (const names of [{ A: 'Hand' }, {}]) {
        const job = await makeAlignmentJob();
        const updated = await store.updateMeetingSpeakerNames({ jobId: job.id, requestId, siteVisitActivityId,
          expectedVersion: job.version, actorProfileId: ownerId, speakerNames: names });
        expect(updated.speaker_alignment).toMatchObject({ status: 'superseded', attempts: 0 });
        expect(await store.claimJobForAlignment({ jobId: job.id })).toBeNull();
      }
      const applied = await makeAlignmentJob({ alignment: { status: 'applied', attempts: 1 } });
      const kept = await store.updateMeetingSpeakerNames({ jobId: applied.id, requestId, siteVisitActivityId,
        expectedVersion: applied.version, actorProfileId: ownerId, speakerNames: { A: 'Edit' } });
      expect(kept.speaker_alignment.status).toBe('applied');
    });

    it('purge deletes the Zoom path last-acknowledged, clears speaker_alignment, and never purges early', async () => {
      const job = await makeAlignmentJob();
      const cleanup = await store.requestMeetingJobCleanup({ jobId: job.id, requestId, siteVisitActivityId,
        actorProfileId: ownerId, expectedVersion: job.version });
      expect(cleanup.speaker_alignment).toBeNull();
      const claimed = await store.claimCleanup({ jobId: job.id });
      const partial = await store.finishLocalCleanup({ jobId: job.id, leaseToken: claimed.leaseToken, expectedVersion: claimed.job.version,
        deletedPaths: [] });
      expect(partial.content_purged_at).toBeNull();
      expect(partial.zoom_transcript_cleanup_pathname).not.toBeNull();
      await expireLease(job.id);
      const again = await store.claimCleanup({ jobId: job.id });
      const done = await store.finishLocalCleanup({ jobId: job.id, leaseToken: again.leaseToken, expectedVersion: again.job.version,
        deletedPaths: ['input_cleanup_pathname', 'output_cleanup_pathname', 'zoom_transcript_cleanup_pathname'] });
      expect(done).toMatchObject({ zoom_transcript_cleanup_pathname: null, zoom_transcript_pathname: null, speaker_alignment: null });
      expect(done.content_purged_at).not.toBeNull();
    });

    it('the purged-content CHECK rejects a purged row that still has a Zoom pointer or alignment', async () => {
      const job = await makeAlignmentJob();
      const purged = `content_purged_at=NOW(), audio_pathname=NULL, output_pathname=NULL, diagnostic_pathname=NULL,
        correction_notes=NULL, original_filename=NULL, audio_sha256=NULL, audio_etag=NULL, status='expired'`;
      const withPointer = await pool.query(`UPDATE transcription_jobs SET ${purged}, speaker_alignment=NULL,
        zoom_transcript_pathname='p' WHERE id=$1`, [job.id]).catch(err => err);
      expect(withPointer.constraint).toBe('transcription_jobs_purged_content_shape');
      const withAlignment = await pool.query(`UPDATE transcription_jobs SET ${purged}, zoom_transcript_pathname=NULL,
        speaker_alignment='{"status":"applied"}'::jsonb WHERE id=$1`, [job.id]).catch(err => err);
      expect(withAlignment.constraint).toBe('transcription_jobs_purged_content_shape');
    });

    it('rejects an oversized or non-object speaker_alignment', async () => {
      const job = await makeAlignmentJob();
      for (const bad of ['[]', JSON.stringify({ status: 'x', pad: 'y'.repeat(70000) })]) {
        const error = await pool.query('UPDATE transcription_jobs SET speaker_alignment=$2::jsonb WHERE id=$1', [job.id, bad]).catch(err => err);
        expect(error.constraint).toBe('transcription_jobs_speaker_alignment_shape');
      }
    });
  });
});
