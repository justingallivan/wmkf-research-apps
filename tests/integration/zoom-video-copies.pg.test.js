/** @jest-environment node */
// Real-Postgres proof for the Stage 3b copy store and intent-store additions (plan "Tests", Store block).
// Runs only when ZOOM_VIDEO_COPY_PG_TEST_URL points at a loopback PostgreSQL; creates and drops its own schema.
// ZOOM_VIDEO_COPY_PG_MUTATE=drop_active_index|drop_copied_index applies a deliberate mutation in setup so the
// tests that depend on that index can be shown to fail.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';

let mockPool = null;
jest.mock('@vercel/postgres', () => {
  const sql = (strings, ...values) => mockPool.query(strings.reduce((text, part, i) => text + (i ? `$${i}` : '') + part, ''), values);
  sql.query = (text, params) => mockPool.query(text, params);
  return { sql, db: { connect: () => mockPool.connect() } };
});

import {
  createZoomVideoCopyStore, hashZoomHostEmail,
} from '../../lib/services/meeting-tracker-recordings/video-copy-store.js';
import {
  claimZoomCopyIntentForFinalize, claimZoomCopyIntentPump, claimZoomCopyIntentReceiptInspection,
  recordZoomCopyIntentSession, bindZoomCopyRegisteredReceipt, releaseZoomCopyIntentReceiptInspection,
  abandonZoomCopyIntentForSourceFailure,
} from '../../lib/services/post-presentation-materials/upload-intent-store.js';

const { Client, Pool } = pg;
const TEST_URL = process.env.ZOOM_VIDEO_COPY_PG_TEST_URL || '';
if (TEST_URL) {
  let parsed;
  try { parsed = new URL(TEST_URL); } catch { throw new Error('ZOOM_VIDEO_COPY_PG_TEST_URL must be a valid local PostgreSQL URL.'); }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !['localhost', '127.0.0.1', '::1'].includes(hostname)) {
    throw new Error('Refusing the Zoom video copy proof unless the database host is localhost/loopback.');
  }
  if (/neon\.tech|vercel-storage/i.test(TEST_URL) || (process.env.POSTGRES_URL && TEST_URL === process.env.POSTGRES_URL)) {
    throw new Error('Refusing the Zoom video copy proof against a shared Production/Preview database.');
  }
}
const describeIf = TEST_URL ? describe : describe.skip;
const MUTATE = process.env.ZOOM_VIDEO_COPY_PG_MUTATE || '';
const MIGRATIONS = ['055_post_presentation_materials.sql', '076_zoom_video_copies.sql']
  .map(file => path.join(process.cwd(), 'lib/db/migrations', file));
const uuid = () => crypto.randomUUID();
const CIPHERTEXT = 'A'.repeat(48);
const candidate = (marker = 'a', size = 5000) => ({
  siteId: `site-${marker}`, driveId: `drive-${marker}`, itemId: `item-${marker}`, versionId: `v-${marker}`, eTag: `e-${marker}`, size,
});

describeIf('Zoom video copy store (isolated local Postgres proof)', () => {
  let admin; let pool; let schema; let store; let profileId;
  // Widens the race window: after N1's active-request check, hold for a moment before the inserts.
  let raceDelayMs = 0;
  const actorSystemId = uuid();

  const startInput = (over = {}) => ({
    copyId: uuid(), requestId: uuid(), requestNum: '1001234', siteVisitActivityId: uuid(), actorProfileId: profileId, actorSystemId,
    zoomMeetingUuid: 'meeting-uuid==', zoomHostId: 'host-1', zoomHostEmail: ' Host@Example.org ', zoomMeetingStart: '2026-10-01T18:00:00Z',
    zoomFileId: 'file-1', zoomRecordingType: 'shared_screen_with_speaker_view', declaredSize: 5000,
    originalDisplayFilename: 'Zoom video Oct 1, 2026 11.00 AM PT.mp4', libraryName: 'Requests', folderPath: 'F/Post Site Visit Materials', ...over,
  });
  const start = async over => {
    const input = startInput(over);
    const result = await store.startZoomVideoCopy(input);
    return { input, result };
  };
  const copyRow = async id => (await pool.query('SELECT * FROM zoom_video_copies WHERE id=$1', [id])).rows[0];
  const intentRow = async id => (await pool.query('SELECT * FROM presentation_material_uploads WHERE id=$1', [id])).rows[0];
  const expireCopyLease = id => pool.query("UPDATE zoom_video_copies SET lease_expires_at = NOW() - INTERVAL '1 second' WHERE id=$1", [id]);
  const claimFor = async requestId => {
    const claimed = await store.claimZoomVideoCopyWork({ accessRequestId: requestId });
    expect(claimed).toBeTruthy();
    return claimed;
  };
  async function failCopy(id, requestId, code = 'zoom_recording_changed') {
    const { row, leaseToken } = await claimFor(requestId);
    expect(row.id).toBe(id);
    return store.failZoomVideoCopy({ id, leaseToken, failureCode: code });
  }
  async function finalizeIntent(id, marker = 'a') {
    const c = candidate(marker);
    await pool.query(
      `UPDATE presentation_material_uploads SET state='finalized', request_document_id=$2, finalized_at=NOW(),
         upload_url_ciphertext=NULL, lease_token=NULL, lease_expires_at=NULL,
         candidate_site_id=$3, candidate_drive_id=$4, candidate_item_id=$5, candidate_version_id=$6, candidate_etag=$7, candidate_size=$8
       WHERE id=$1`,
      [id, uuid(), c.siteId, c.driveId, c.itemId, c.versionId, c.eTag, c.size],
    );
  }

  beforeAll(async () => {
    admin = new Client({ connectionString: TEST_URL });
    await admin.connect();
    schema = `zoom_copy_test_${uuid().replace(/-/g, '')}`;
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ connectionString: TEST_URL, options: `-c search_path=${schema}` });
    mockPool = pool;
    await pool.query('CREATE TABLE user_profiles (id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE)');
    await pool.query('CREATE TABLE portal_upload_staging (id UUID PRIMARY KEY, scope TEXT)');
    profileId = (await pool.query("INSERT INTO user_profiles(name) VALUES ('zoom-copy-actor') RETURNING id")).rows[0].id;
    for (const file of MIGRATIONS) await pool.query(fs.readFileSync(file, 'utf8'));
    if (MUTATE === 'drop_active_index') await pool.query('DROP INDEX idx_zoom_video_copies_active_request');
    if (MUTATE === 'drop_copied_index') await pool.query('DROP INDEX idx_zoom_video_copies_copied_file');
    store = createZoomVideoCopyStore({
      query: (text, params = []) => pool.query(text, params),
      async transaction(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const value = await fn({
            async query(text, params = []) {
              const result = await client.query(text, params);
              if (raceDelayMs && /^SELECT id FROM zoom_video_copies WHERE request_id/.test(text)) await new Promise(resolve => setTimeout(resolve, raceDelayMs));
              return result;
            },
          });
          await client.query('COMMIT');
          return value;
        } catch (error) {
          await client.query('ROLLBACK').catch(() => {});
          throw error;
        } finally { client.release(); }
      },
    });
  });

  afterAll(async () => {
    if (pool) await pool.end();
    if (schema) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    if (admin) await admin.end();
  });

  it('N1 inserts both rows with the same id, origin zoom_copy and the host email hashed, never stored', async () => {
    const { input, result } = await start();
    expect(result.status).toBe('started');
    const copy = await copyRow(input.copyId);
    const intent = await intentRow(input.copyId);
    expect(copy).toMatchObject({ state: 'queued', upload_id: input.copyId, zoom_host_email_sha256: hashZoomHostEmail('host@example.org') });
    expect(intent).toMatchObject({ origin: 'zoom_copy', state: 'initiated', upload_url_ciphertext: null, actor_id: actorSystemId });
    expect(intent.physical_filename).toBe(`1001234-Recording-${input.copyId}.mp4`);
    expect(JSON.stringify(copy)).not.toMatch(/example\.org/i);
  });

  it('concurrent starts for one request create exactly one active copy', async () => {
    const requestId = uuid();
    raceDelayMs = 150;
    let a; let b;
    try {
      [a, b] = await Promise.all([
        store.startZoomVideoCopy(startInput({ requestId, zoomFileId: 'file-A' })),
        store.startZoomVideoCopy(startInput({ requestId, zoomFileId: 'file-B' })),
      ]);
    } finally { raceDelayMs = 0; }
    expect([a.status, b.status].sort()).toEqual(['active', 'started']);
    const active = await pool.query(
      "SELECT count(*)::int AS n FROM zoom_video_copies WHERE request_id=$1 AND state IN ('queued','copying','registering')", [requestId],
    );
    expect(active.rows[0].n).toBe(1);
  });

  it('a failure after the intent insert rolls both rows back; a unique violation maps to in_progress', async () => {
    const bad = startInput({ zoomRecordingType: 'BAD TYPE' });
    await expect(store.startZoomVideoCopy(bad)).rejects.toMatchObject({ code: '23514' });
    expect(await intentRow(bad.copyId)).toBeUndefined();
    expect(await copyRow(bad.copyId)).toBeUndefined();

    const first = startInput();
    expect((await store.startZoomVideoCopy(first)).status).toBe('started');
    await failCopy(first.copyId, first.requestId);
    const clash = startInput({ requestId: first.requestId, copyId: first.copyId, zoomFileId: 'file-other' });
    const rows = await store.listFailedZoomVideoCopiesForFile({ requestId: first.requestId, zoomFileId: 'file-other' });
    expect(await store.startZoomVideoCopy({ ...clash, failedSnapshot: rows })).toEqual({ status: 'in_progress', copy: null });
  });

  it('replays a copied file before the active check, and the copied-file index refuses a second copied row', async () => {
    const requestId = uuid();
    const a = startInput({ requestId });
    await store.startZoomVideoCopy(a);
    await failCopy(a.copyId, requestId);
    const snap = await store.listFailedZoomVideoCopiesForFile({ requestId, zoomFileId: 'file-1' });
    const b = startInput({ requestId });
    expect((await store.startZoomVideoCopy({ ...b, failedSnapshot: snap })).status).toBe('started');
    await finalizeIntent(b.copyId, 'b');
    const copied = await store.markZoomVideoCopyCopied({ id: b.copyId });
    expect(copied).toMatchObject({ state: 'copied', sharepoint_item_id: 'item-b', failure_code: null });

    // Replay: same request and file, no new rows; an unrelated active copy for another file would not hide it.
    const c = startInput({ requestId });
    const replay = await store.startZoomVideoCopy(c);
    expect(replay.status).toBe('replayed');
    expect(replay.copy.id).toBe(b.copyId);
    expect(await copyRow(c.copyId)).toBeUndefined();

    // The old failed row, once its intent is finalized, cannot also become copied for the same request and file.
    await finalizeIntent(a.copyId, 'a');
    await expect(store.markZoomVideoCopyCopied({ id: a.copyId })).rejects.toMatchObject({ code: 'zoom_video_receipt_conflict' });
    expect((await copyRow(a.copyId)).state).toBe('failed');
  });

  it('a Try again start refuses when a failed row changed since inspection or its intent is already finalized', async () => {
    const requestId = uuid();
    const a = startInput({ requestId });
    await store.startZoomVideoCopy(a);
    await failCopy(a.copyId, requestId);
    expect((await store.startZoomVideoCopy(startInput({ requestId }))).status).toBe('reconciliation_pending');
    const snap = await store.listFailedZoomVideoCopiesForFile({ requestId, zoomFileId: 'file-1' });
    await pool.query("UPDATE zoom_video_copies SET updated_at = NOW() + INTERVAL '1 second' WHERE id=$1", [a.copyId]);
    expect((await store.startZoomVideoCopy({ ...startInput({ requestId }), failedSnapshot: snap })).status).toBe('reconciliation_pending');
    const fresh = await store.listFailedZoomVideoCopiesForFile({ requestId, zoomFileId: 'file-1' });
    await finalizeIntent(a.copyId);
    expect((await store.startZoomVideoCopy({ ...startInput({ requestId }), failedSnapshot: fresh })).status).toBe('reconciliation_pending');
  });

  it('a counter at its cap moves to failed in one statement and never violates a CHECK', async () => {
    const requestId = uuid();
    const a = startInput({ requestId });
    await store.startZoomVideoCopy(a);
    let { row, leaseToken } = await claimFor(requestId);
    const first = await store.recordZoomVideoCopySessionCreateFailure({ id: a.copyId, leaseToken, retryAfterSeconds: 30 });
    expect(first).toMatchObject({ state: 'queued', session_create_attempts: 1 });
    await pool.query('UPDATE zoom_video_copies SET session_create_attempts = 2 WHERE id=$1', [a.copyId]);
    const capped = await store.recordZoomVideoCopySessionCreateFailure({ id: a.copyId, leaseToken });
    expect(capped).toMatchObject({ state: 'failed', session_create_attempts: 3, failure_code: 'zoom_video_session_create_failed', lease_token: null });
    expect(await store.recordZoomVideoCopySessionCreateFailure({ id: a.copyId, leaseToken })).toBeNull();

    const b = startInput({ requestId });
    await store.startZoomVideoCopy({ ...b, failedSnapshot: await store.listFailedZoomVideoCopiesForFile({ requestId, zoomFileId: 'file-1' }) });
    ({ row, leaseToken } = await claimFor(requestId));
    await pool.query("UPDATE zoom_video_copies SET state='copying', session_restarts=2, uncertain_checks=2, bytes_confirmed=100 WHERE id=$1", [b.copyId]);
    const unc = await store.recordZoomVideoCopyUncertainCheck({ id: b.copyId, leaseToken, retryAfterSeconds: 600, capFailureCode: 'zoom_video_upload_uncertain' });
    expect(unc).toMatchObject({ state: 'failed', uncertain_checks: 3, failure_code: 'zoom_video_upload_uncertain' });

    const c = startInput({ requestId });
    await store.startZoomVideoCopy({ ...c, failedSnapshot: await store.listFailedZoomVideoCopiesForFile({ requestId, zoomFileId: 'file-1' }) });
    ({ row, leaseToken } = await claimFor(requestId));
    await pool.query("UPDATE zoom_video_copies SET state='copying', session_restarts=2, bytes_confirmed=100 WHERE id=$1", [c.copyId]);
    expect(await store.recordZoomVideoCopySessionRestart({ id: c.copyId, leaseToken }))
      .toMatchObject({ state: 'failed', session_restarts: 3, failure_code: 'zoom_video_session_expired' });

    const d = startInput({ requestId });
    await store.startZoomVideoCopy({ ...d, failedSnapshot: await store.listFailedZoomVideoCopiesForFile({ requestId, zoomFileId: 'file-1' }) });
    ({ row, leaseToken } = await claimFor(requestId));
    expect(await store.markZoomVideoCopyRegistering({ id: d.copyId, leaseToken, driveId: 'dr', itemId: 'it' })).toMatchObject({ state: 'registering', bytes_confirmed: '5000' });
    const first1 = await store.deferZoomVideoCopyRegistration({ id: d.copyId, leaseToken });
    expect(first1).toMatchObject({ state: 'registering', registration_attempts: 1, lease_token: null });
    const secs = (await pool.query("SELECT EXTRACT(EPOCH FROM next_attempt_at - NOW())::int AS s FROM zoom_video_copies WHERE id=$1", [d.copyId])).rows[0].s;
    expect(secs).toBeGreaterThan(50);
    expect(secs).toBeLessThanOrEqual(60);
    await pool.query('UPDATE zoom_video_copies SET registration_attempts = 4, next_attempt_at = NULL WHERE id=$1', [d.copyId]);
    ({ row, leaseToken } = await claimFor(requestId));
    expect(await store.deferZoomVideoCopyRegistration({ id: d.copyId, leaseToken }))
      .toMatchObject({ state: 'failed', registration_attempts: 5, failure_code: 'zoom_video_registration_failed', lease_token: null });
  });

  it('stale copy lease tokens cannot write after a takeover', async () => {
    const requestId = uuid();
    const a = startInput({ requestId });
    await store.startZoomVideoCopy(a);
    const old = (await claimFor(requestId)).leaseToken;
    expect(await store.claimZoomVideoCopyWork({ accessRequestId: requestId })).toBeNull();
    await expireCopyLease(a.copyId);
    const fresh = (await claimFor(requestId)).leaseToken;
    expect(fresh).not.toBe(old);
    const stale = { id: a.copyId, leaseToken: old };
    expect(await store.renewZoomVideoCopyLease({ ...stale, states: ['queued'] })).toBeNull();
    expect(await store.markZoomVideoCopyCopying(stale)).toBeNull();
    expect(await store.recordZoomVideoCopySessionCreateFailure(stale)).toBeNull();
    expect(await store.markZoomVideoCopyRegistering({ ...stale, driveId: 'd', itemId: 'i' })).toBeNull();
    expect(await store.failZoomVideoCopy({ ...stale, failureCode: 'x' })).toBeNull();
    expect(await store.cancelZoomVideoCopy(stale)).toBeNull();
    expect(await store.releaseZoomVideoCopyLease(stale)).toBeNull();
    expect((await copyRow(a.copyId)).state).toBe('queued');
    expect(await store.renewZoomVideoCopyLease({ id: a.copyId, leaseToken: fresh, states: ['queued'] })).toMatchObject({ state: 'queued' });
    expect(await store.markZoomVideoCopyCopying({ id: a.copyId, leaseToken: fresh })).toMatchObject({ state: 'copying' });
  });

  it('N5 refuses a live copy lease and accepts it once expired; N5a lists only unleased finalized rows', async () => {
    const requestId = uuid();
    const a = startInput({ requestId });
    await store.startZoomVideoCopy(a);
    await claimFor(requestId);
    await finalizeIntent(a.copyId);
    expect(await store.markZoomVideoCopyCopied({ id: a.copyId })).toBeNull();
    expect((await store.listZoomVideoCopiesWithFinalizedIntent({ limit: 50 })).map(r => r.id)).not.toContain(a.copyId);
    await expireCopyLease(a.copyId);
    expect((await store.listZoomVideoCopiesWithFinalizedIntent({ limit: 50 })).map(r => r.id)).toContain(a.copyId);
    expect(await store.markZoomVideoCopyCopied({ id: a.copyId })).toMatchObject({ state: 'copied', lease_token: null });
  });

  it('intent claims enforce origin, state, candidate, lease and token predicates', async () => {
    const requestId = uuid();
    const a = startInput({ requestId });
    await store.startZoomVideoCopy(a);
    expect(await claimZoomCopyIntentForFinalize({ uploadId: a.copyId })).toBeNull(); // initiated
    const pump = await claimZoomCopyIntentPump({ uploadId: a.copyId });
    expect(pump.row.origin).toBe('zoom_copy');
    expect(await claimZoomCopyIntentPump({ uploadId: a.copyId })).toBeNull(); // live lease
    const session = { uploadId: a.copyId, uploadUrlCiphertext: CIPHERTEXT, expiresAt: new Date(Date.now() + 3600e3).toISOString(), intentExpiresAt: new Date(Date.now() + 86400e3).toISOString() };
    expect(await recordZoomCopyIntentSession({ ...session, leaseToken: uuid() })).toBeNull();
    expect(await recordZoomCopyIntentSession({ ...session, leaseToken: pump.leaseToken })).toMatchObject({ upload_url_ciphertext: CIPHERTEXT, lease_token: pump.leaseToken });
    expect(await recordZoomCopyIntentSession({ ...session, leaseToken: pump.leaseToken })).toBeNull(); // ciphertext already set

    const browser = uuid();
    await pool.query(
      `INSERT INTO presentation_material_uploads (id, request_id, site_visit_id, actor_id, artifact_type, original_display_filename, validated_mime_type,
         declared_size, client_resume_fingerprint, library_name, folder_path, physical_filename, generation_key, intent_expires_at)
       VALUES ($1,$2,$2,$2,100000005,'x.mp4','video/mp4',10,$3,'L','F',$4,$3,NOW()+INTERVAL '1 day')`,
      [browser, uuid(), 'c'.repeat(64), `b-${browser}.mp4`],
    );
    expect(await claimZoomCopyIntentPump({ uploadId: browser })).toBeNull();

    await pool.query(
      `UPDATE presentation_material_uploads SET state='uploaded', lease_token=NULL, lease_expires_at=NULL,
         candidate_site_id='s', candidate_drive_id='d', candidate_item_id='i', candidate_version_id='v', candidate_etag='e', candidate_size=5000 WHERE id=$1`, [a.copyId],
    );
    expect(await claimZoomCopyIntentPump({ uploadId: a.copyId })).toBeNull(); // uploaded with candidate
    const fin = await claimZoomCopyIntentForFinalize({ uploadId: a.copyId });
    expect(fin.row.state).toBe('finalizing');
    expect(await claimZoomCopyIntentForFinalize({ uploadId: a.copyId })).toBeNull(); // live finalize lease
    await pool.query('UPDATE presentation_material_uploads SET lease_token=NULL, lease_expires_at=NULL WHERE id=$1', [a.copyId]);
    expect(await claimZoomCopyIntentForFinalize({ uploadId: a.copyId })).toBeTruthy(); // null finalizing lease is taken over
    expect(await abandonZoomCopyIntentForSourceFailure({ uploadId: a.copyId, leaseToken: fin.leaseToken, failureCode: 'zoom_recording_changed' })).toBeNull();
  });

  it('source-failure abandonment stores the source code, never the staff marker', async () => {
    const requestId = uuid();
    const a = startInput({ requestId });
    await store.startZoomVideoCopy(a);
    const pump = await claimZoomCopyIntentPump({ uploadId: a.copyId });
    await expect(abandonZoomCopyIntentForSourceFailure({ uploadId: a.copyId, leaseToken: pump.leaseToken, failureCode: 'staff_cancelled' })).rejects.toThrow(TypeError);
    const done = await abandonZoomCopyIntentForSourceFailure({ uploadId: a.copyId, leaseToken: pump.leaseToken, failureCode: 'zoom_recording_changed' });
    expect(done).toMatchObject({ state: 'abandoned', last_error: 'zoom_recording_changed', lease_token: null, upload_url_ciphertext: null });
  });

  it('I5 rejects a changed intent or candidate and binds the matching one, then N5 repairs the copy', async () => {
    const requestId = uuid();
    const a = startInput({ requestId });
    await store.startZoomVideoCopy(a);
    await failCopy(a.copyId, requestId);
    const intent = await intentRow(a.copyId);
    expect(await claimZoomCopyIntentReceiptInspection({ uploadId: uuid() })).toBeNull();
    const insp = await claimZoomCopyIntentReceiptInspection({ uploadId: a.copyId }); // linked copy failed
    expect(insp.row.state).toBe('initiated');
    expect(await claimZoomCopyIntentReceiptInspection({ uploadId: a.copyId })).toBeNull(); // live lease
    const verified = { candidate: candidate('v'), requestDocumentId: uuid() };
    const expected = { state: 'initiated', generationKey: intent.generation_key, candidateItemId: null, lastError: null };
    const base = { copyId: a.copyId, inspectionLeaseToken: insp.leaseToken, expected, verified };

    expect(await bindZoomCopyRegisteredReceipt({ ...base, inspectionLeaseToken: uuid() })).toMatchObject({ bound: false, reason: 'inspection_lease_lost' });
    expect(await bindZoomCopyRegisteredReceipt({ ...base, expected: { ...expected, generationKey: 'f'.repeat(64) } })).toMatchObject({ bound: false, reason: 'intent_changed' });
    expect(await bindZoomCopyRegisteredReceipt({ ...base, expected: { ...expected, state: 'failed' } })).toMatchObject({ bound: false, reason: 'intent_changed' });
    expect(await bindZoomCopyRegisteredReceipt({ ...base, verified: { ...verified, candidate: candidate('v', 4999) } })).toMatchObject({ bound: false, reason: 'size_mismatch' });
    expect((await intentRow(a.copyId)).state).toBe('initiated'); // nothing written by the rejections

    // A recorded candidate that differs from the verified one is not bound.
    await pool.query(
      `UPDATE presentation_material_uploads SET candidate_site_id='s', candidate_drive_id='drive-x', candidate_item_id='item-x',
         candidate_version_id='v', candidate_etag='e', candidate_size=5000 WHERE id=$1`, [a.copyId],
    );
    expect(await bindZoomCopyRegisteredReceipt({ ...base, expected: { ...expected, candidateItemId: 'item-x' } })).toMatchObject({ bound: false, reason: 'candidate_mismatch' });
    await pool.query("UPDATE presentation_material_uploads SET state='failed' WHERE id=$1", [a.copyId]);
    expect(await bindZoomCopyRegisteredReceipt({ ...base, verified: { ...verified, candidate: candidate('x') }, expected: { ...expected, state: 'failed', candidateItemId: 'item-x' } }))
      .toMatchObject({ bound: false, reason: 'rejected_candidate' });
    await pool.query(
      `UPDATE presentation_material_uploads SET state='initiated', candidate_site_id=NULL, candidate_drive_id=NULL, candidate_item_id=NULL,
         candidate_version_id=NULL, candidate_etag=NULL, candidate_size=NULL WHERE id=$1`, [a.copyId],
    );

    const bound = await bindZoomCopyRegisteredReceipt(base);
    expect(bound.bound).toBe(true);
    expect(await intentRow(a.copyId)).toMatchObject({ state: 'finalized', request_document_id: verified.requestDocumentId, candidate_item_id: 'item-v', lease_token: null, last_error: null });
    expect(await store.markZoomVideoCopyCopied({ id: a.copyId })).toMatchObject({ state: 'copied', request_document_id: verified.requestDocumentId, sharepoint_item_id: 'item-v' });
    expect(await releaseZoomCopyIntentReceiptInspection({ uploadId: a.copyId, leaseToken: insp.leaseToken })).toBeNull();
  });

  it('I5 refuses a staff-cancelled abandonment, a live copy lease on a failed copy, and a missing live copy token for an active copy', async () => {
    const requestId = uuid();
    const a = startInput({ requestId });
    await store.startZoomVideoCopy(a);
    const { leaseToken: copyToken } = await claimFor(requestId);
    const pump = await claimZoomCopyIntentPump({ uploadId: a.copyId });
    await pool.query("UPDATE presentation_material_uploads SET intent_expires_at = NOW() - INTERVAL '1 hour', lease_token=NULL, lease_expires_at=NULL WHERE id=$1", [a.copyId]);
    expect(pump).toBeTruthy();
    const insp = await claimZoomCopyIntentReceiptInspection({ uploadId: a.copyId }); // expired intent
    const intent = await intentRow(a.copyId);
    const verified = { candidate: candidate('w'), requestDocumentId: uuid() };
    const base = { copyId: a.copyId, inspectionLeaseToken: insp.leaseToken, verified,
      expected: { state: 'initiated', generationKey: intent.generation_key, candidateItemId: null, lastError: null } };
    expect(await bindZoomCopyRegisteredReceipt(base)).toMatchObject({ bound: false, reason: 'copy_lease_lost' });
    expect(await bindZoomCopyRegisteredReceipt({ ...base, copyLeaseToken: uuid() })).toMatchObject({ bound: false, reason: 'copy_lease_lost' });
    await pool.query("UPDATE presentation_material_uploads SET state='abandoned', last_error='staff_cancelled' WHERE id=$1", [a.copyId]);
    expect(await bindZoomCopyRegisteredReceipt({ ...base, copyLeaseToken: copyToken, expected: { ...base.expected, state: 'abandoned', lastError: 'staff_cancelled' } }))
      .toMatchObject({ bound: false, reason: 'abandonment_not_bindable' });
    await pool.query("UPDATE presentation_material_uploads SET state='initiated', last_error=NULL WHERE id=$1", [a.copyId]);
    expect(await bindZoomCopyRegisteredReceipt({ ...base, copyLeaseToken: copyToken })).toMatchObject({ bound: true });
    expect(await store.markZoomVideoCopyCopied({ id: a.copyId, leaseToken: copyToken })).toMatchObject({ state: 'copied' });
  });

  it('N6 sets the cancel flag on queued or copying rows only; the failed-due selector advances next_attempt_at', async () => {
    const requestId = uuid();
    const a = startInput({ requestId });
    await store.startZoomVideoCopy(a);
    expect(await store.requestZoomVideoCopyCancel({ id: a.copyId, requestId: uuid() })).toEqual({ outcome: 'not_found', row: null });
    expect((await store.requestZoomVideoCopyCancel({ id: a.copyId, requestId })).outcome).toBe('requested');
    const { leaseToken } = await claimFor(requestId);
    await store.markZoomVideoCopyRegistering({ id: a.copyId, leaseToken, driveId: 'd', itemId: 'i' });
    expect((await store.requestZoomVideoCopyCancel({ id: a.copyId, requestId })).outcome).toBe('saving');
    expect((await store.cancelZoomVideoCopy({ id: a.copyId, leaseToken, driveId: 'd', itemId: 'i' })).state).toBe('cancelled');
    expect((await store.requestZoomVideoCopyCancel({ id: a.copyId, requestId })).outcome).toBe('terminal');

    const b = startInput({ requestId });
    await store.startZoomVideoCopy(b);
    await failCopy(b.copyId, requestId);
    const due = await store.claimFailedZoomVideoCopiesDue({ limit: 20, accessRequestId: requestId });
    expect(due.map(r => r.id)).toEqual([b.copyId]);
    expect(await store.claimFailedZoomVideoCopiesDue({ limit: 20, accessRequestId: requestId })).toEqual([]);
    expect((await copyRow(b.copyId)).next_attempt_at).not.toBeNull();
  });
});
