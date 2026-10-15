/** @jest-environment node */
import fs from 'node:fs';
import crypto from 'node:crypto';
import pg from 'pg';
let mockPool;
jest.mock('@vercel/postgres', () => ({
  sql: (strings, ...values) => mockPool.query(strings.reduce((text, part, i) => text + (i ? `$${i}` : '') + part, ''), values),
}));
import {
  insertPresentationMaterialUpload, claimPresentationMaterialUploadRecovery,
  dismissPresentationMaterialUploadRecovery, releasePresentationMaterialUploadRecovery,
  refreshPresentationMaterialUploadSession, recordPresentationMaterialUploadCandidate,
  claimPresentationMaterialUploadsForCleanup,
} from '../../lib/services/post-presentation-materials/upload-intent-store.js';
const url = process.env.TEST_REQUEST_LEDGER_TEST_URL || '';
if (process.env.TEST_REQUEST_LEDGER_REQUIRE === '1' && !url) throw new Error('Local Postgres test URL required');
if (url && (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)
  || url === process.env.POSTGRES_URL)) throw new Error('Only isolated loopback Postgres is allowed');
const uuid = () => crypto.randomUUID();
(url ? describe : describe.skip)('durable upload dismissal (real Postgres)', () => {
  let admin; let schema;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url }); await admin.connect();
    schema = `dismiss_test_${uuid().replace(/-/g, '')}`;
    await admin.query(`CREATE SCHEMA "${schema}"`);
    mockPool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` });
    await mockPool.query('CREATE TABLE user_profiles (id SERIAL PRIMARY KEY)');
    await mockPool.query('CREATE TABLE portal_upload_staging (id UUID PRIMARY KEY, scope TEXT)');
    for (const file of ['055_post_presentation_materials.sql', '076_zoom_video_copies.sql', '083_presentation_upload_dismissal.sql']) {
      await mockPool.query(fs.readFileSync(`lib/db/migrations/${file}`, 'utf8'));
    }
  });
  afterAll(async () => {
    if (mockPool) await mockPool.end();
    if (admin) { if (schema) await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end(); }
  });
  test('dismissed receipt stays reconcilable; stale browser recovery is fenced and a recovered candidate gets review time', async () => {
    const row = { id: uuid(), requestId: uuid(), siteVisitId: uuid(), actorId: uuid(), artifactType: 100000005,
      originalDisplayFilename: 'recording.mp4', validatedMimeType: 'video/mp4', declaredSize: 100,
      clientResumeFingerprint: 'a'.repeat(64), libraryName: 'Requests', folderPath: 'x', physicalFilename: 'unique.mp4',
      generationKey: 'b'.repeat(64), intentExpiresAt: new Date(Date.now() - 86400000).toISOString() };
    await insertPresentationMaterialUpload(row);
    const sealed = 'A'.repeat(48);
    await mockPool.query('UPDATE presentation_material_uploads SET upload_url_ciphertext=$2 WHERE id=$1', [row.id, sealed]);
    const args = { uploadId: row.id, requestId: row.requestId, actorId: row.actorId };
    const claim = await claimPresentationMaterialUploadRecovery(args);
    const dismissed = await dismissPresentationMaterialUploadRecovery({ uploadId: row.id, leaseToken: claim.leaseToken });
    expect(dismissed.staff_dismissed_at).toBeTruthy();
    expect(dismissed.state).toBe('initiated'); expect(dismissed.upload_url_ciphertext).toBe(sealed);
    await releasePresentationMaterialUploadRecovery({ uploadId: row.id, leaseToken: claim.leaseToken });
    expect(await claimPresentationMaterialUploadRecovery(args)).toBeNull();
    expect(await refreshPresentationMaterialUploadSession({ ...args, uploadUrlCiphertext: sealed,
      expiresAt: new Date(Date.now() + 10000), intentExpiresAt: new Date(Date.now() + 86400000) })).toBeNull();
    // Advance only this isolated fixture beyond the existing six-hour review throttle.
    await mockPool.query("UPDATE presentation_material_uploads SET updated_at=NOW()-INTERVAL '7 hours' WHERE id=$1", [row.id]);
    const cleanup = await claimPresentationMaterialUploadsForCleanup({ limit: 10 });
    expect(cleanup.rows.some(r => r.id === row.id)).toBe(true);
    const recovered = await recordPresentationMaterialUploadCandidate({ ...args, leaseToken: cleanup.leaseToken,
      candidate: { siteId: 's', driveId: 'd', itemId: 'i', versionId: '1', eTag: 'e', size: 100 } });
    expect(recovered.staff_dismissed_at).toBeNull(); expect(recovered.state).toBe('uploaded');
    expect(new Date(recovered.intent_expires_at).getTime()).toBeGreaterThan(Date.now() + 2 * 86400000);
  });
});
