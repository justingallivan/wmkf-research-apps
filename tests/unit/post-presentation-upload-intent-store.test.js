/** @jest-environment node */
jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));

import { sql } from '@vercel/postgres';
import {
  bindPresentationMaterialUploadForCleanup,
  cancelPresentationMaterialUploadRecovery,
  claimPresentationMaterialUploadRecovery,
  claimPresentationMaterialUpload,
  claimPresentationMaterialUploadsForCleanup,
  completePresentationMaterialUpload,
  getPresentationMaterialUpload,
  insertPresentationMaterialUpload,
  listPresentationMaterialUploads,
  markPresentationMaterialUploadSessionClosed,
  recordPresentationMaterialUploadCandidate,
  refreshPresentationMaterialUploadSession,
  releasePresentationMaterialUpload,
  releasePresentationMaterialUploadCleanupLease,
  renewPresentationMaterialUploadCleanupLease,
  renewPresentationMaterialUploadLease,
  markPresentationMaterialUploadFailed,
  recordPresentationMaterialUploadSession,
  renewPresentationMaterialUploadRecovery,
  releasePresentationMaterialUploadRecovery,
  markPresentationMaterialUploadRecoveryTerminal,
  markPresentationMaterialUploadRecoveryUncertain,
  recordPresentationMaterialUploadRecoverySession,
  abandonPresentationMaterialUpload,
} from '../../lib/services/post-presentation-materials/upload-intent-store.js';

const INPUT = {
  uploadId: '11111111-1111-4111-8111-111111111111',
  requestId: '22222222-2222-4222-8222-222222222222',
  actorId: '33333333-3333-4333-8333-333333333333',
  leaseToken: '44444444-4444-4444-8444-444444444444',
};

function statement(index = -1) {
  const [strings] = index < 0 ? sql.mock.calls.at(index) : sql.mock.calls[index];
  return strings.join('?').replace(/\s+/g, ' ');
}

beforeEach(() => {
  sql.mockReset();
  sql.mockResolvedValue({ rows: [{ id: INPUT.uploadId }] });
});

test('intent reads and claims are bound to upload, request, and creating actor', async () => {
  await getPresentationMaterialUpload(INPUT);
  expect(statement()).toContain("WHERE id = ? AND request_id = ? AND actor_id = ? AND origin = 'browser' LIMIT 1");

  await claimPresentationMaterialUpload(INPUT);
  const claim = statement();
  expect(claim).toContain("WHERE id = ? AND request_id = ? AND actor_id = ? AND origin = 'browser'");
  expect(claim).toContain("state IN ('initiated', 'uploaded')");
  expect(claim).toContain('(lease_token IS NULL OR lease_expires_at <= NOW())');
  expect(claim).toContain("state = 'finalizing' AND lease_expires_at <= NOW()");
  expect(claim).toContain('intent_expires_at > NOW()');
});

test('unfinished-upload projection includes the lease expiry needed to distinguish a live finalizer', async () => {
  await listPresentationMaterialUploads(INPUT);
  expect(statement()).toContain('intent_expires_at, lease_token, lease_expires_at');
});

test('lease renewal fails closed after either lease or review-after expiry', async () => {
  await renewPresentationMaterialUploadLease(INPUT);
  const text = statement();
  expect(text).toContain('lease_token = ?');
  expect(text).toContain('lease_expires_at > NOW()');
  expect(text).toContain('intent_expires_at > NOW()');
  expect(text).toContain("state = 'finalizing'");
});

test('cleanup lease renewal requires an expired, nonterminal intent and a still-live lease', async () => {
  await renewPresentationMaterialUploadCleanupLease(INPUT);
  const text = statement();
  expect(text).toContain('lease_token = ?');
  expect(text).toContain('lease_expires_at > NOW()');
  expect(text).toContain('intent_expires_at <= NOW()');
  expect(text).toContain("state NOT IN ('finalized', 'abandoned')");
});

test('candidate persistence with a lease preserves finalizing and requires that exact live lease', async () => {
  await recordPresentationMaterialUploadCandidate({
    ...INPUT,
    leaseToken: INPUT.leaseToken,
    candidate: {
      siteId: 'site', driveId: 'drive', itemId: 'item', versionId: '1.0',
      eTag: 'etag', size: 100,
    },
  });
  const text = statement();
  expect(text).not.toContain("SET state = 'uploaded'");
  expect(text).toContain("state NOT IN ('finalized', 'abandoned')");
  expect(text).toContain('lease_token = ? AND lease_expires_at > NOW()');
  expect(text).toContain("WHEN state = 'failed' AND candidate_item_id IS NOT NULL THEN 'failed'");
  expect(text).toContain("WHEN state = 'failed' AND candidate_item_id IS NOT NULL THEN last_error");
});

test('status candidate persistence cannot demote a live finalizer', async () => {
  await recordPresentationMaterialUploadCandidate({
    ...INPUT,
    leaseToken: null,
    candidate: {
      siteId: 'site', driveId: 'drive', itemId: 'item', versionId: '1.0',
      eTag: 'etag', size: 100,
    },
  });
  const text = statement();
  expect(text).toContain("SET state = 'uploaded'");
  expect(text).toContain("state IN ('initiated', 'uploaded', 'failed')");
  expect(text).toContain("state = 'finalizing' AND lease_expires_at <= NOW()");
  expect(text).toContain('(lease_token IS NULL OR lease_expires_at <= NOW())');
  expect(text).toContain("NOT (state = 'failed' AND candidate_item_id IS NOT NULL)");
});

test('a permanent validation failure parks its recorded candidate outside the finalize path', async () => {
  await releasePresentationMaterialUpload({
    uploadId: INPUT.uploadId,
    leaseToken: INPUT.leaseToken,
    lastError: 'post_presentation_mp4_signature_invalid',
    terminal: true,
  });
  expect(statement()).toContain("WHEN ? AND candidate_item_id IS NOT NULL THEN 'failed'");
  expect(sql.mock.calls.at(-1).slice(1)).toContain(true);

  sql.mockReset();
  sql.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{
    state: 'failed', candidate_item_id: 'item', intent_expires_at: '2026-10-03T00:00:00Z',
  }] });
  await expect(claimPresentationMaterialUpload(INPUT)).resolves.toMatchObject({ state: 'rejected' });
});

test('cleanup preserves a rejected candidate reason and cannot bind it as finalized', async () => {
  await releasePresentationMaterialUploadCleanupLease({
    uploadId: INPUT.uploadId, leaseToken: INPUT.leaseToken, lastError: 'unbound_inspect_only',
  });
  expect(statement()).toContain("WHEN state = 'failed' AND candidate_item_id IS NOT NULL THEN last_error");
  await bindPresentationMaterialUploadForCleanup({
    uploadId: INPUT.uploadId, leaseToken: INPUT.leaseToken,
    requestDocumentId: '44444444-4444-4444-8444-444444444444',
  });
  expect(statement()).toContain("NOT (state = 'failed' AND candidate_item_id IS NOT NULL)");
});

test('late status writes are fenced to the exact session URL they observed', async () => {
  await refreshPresentationMaterialUploadSession({
    ...INPUT, uploadUrlCiphertext: 'sealed-old',
    expiresAt: '2026-09-30T13:00:00Z', intentExpiresAt: '2026-10-03T13:00:00Z',
  });
  expect(statement()).toContain('upload_url_ciphertext = ?');
  expect(sql.mock.calls.at(-1).slice(1)).toContain('sealed-old');
  await markPresentationMaterialUploadSessionClosed({
    ...INPUT, uploadUrlCiphertext: 'sealed-old', lastError: 'session_expired',
  });
  expect(statement()).toContain('upload_url_ciphertext = ?');
  expect(sql.mock.calls.at(-1).slice(1)).toContain('sealed-old');
});

test('staff recovery shares the lease and cannot abandon or replace a recorded candidate', async () => {
  await claimPresentationMaterialUploadRecovery(INPUT);
  const claim = statement();
  expect(claim).toContain('request_id = ? AND actor_id = ?');
  expect(claim).toContain("state IN ('initiated', 'failed')");
  expect(claim).toContain('candidate_item_id IS NULL');
  expect(claim).toContain('request_document_id IS NULL');
  expect(claim).toContain('(lease_token IS NULL OR lease_expires_at <= NOW())');

  await cancelPresentationMaterialUploadRecovery(INPUT);
  const cancel = statement();
  expect(cancel).toContain('lease_token = ? AND lease_expires_at > NOW()');
  expect(cancel).toContain('candidate_item_id IS NULL');
  expect(cancel).toContain('request_document_id IS NULL');
  expect(cancel).toContain("state IN ('initiated', 'failed')");

  await recordPresentationMaterialUploadRecoverySession({
    ...INPUT, uploadUrlCiphertext: 'sealed-new',
    expiresAt: '2026-09-30T13:00:00Z', intentExpiresAt: '2026-10-03T13:00:00Z',
  });
  const retry = statement();
  expect(retry).toContain("state = 'failed'");
  expect(retry).toContain('candidate_item_id IS NULL');
  expect(retry).toContain('request_document_id IS NULL');
  expect(retry).toContain('lease_token = ? AND lease_expires_at > NOW()');
});

test('cleanup scheduling throttles recently reviewed rows without extending the user finalize deadline', async () => {
  await claimPresentationMaterialUploadsForCleanup();
  const claim = statement();
  expect(claim).toContain('updated_at <= NOW() - (? || \' seconds\')::INTERVAL');
  expect(claim).toContain('ORDER BY updated_at ASC, intent_expires_at ASC');

  sql.mockClear();
  await releasePresentationMaterialUploadCleanupLease(INPUT);
  const released = statement();
  expect(released).not.toContain('SET intent_expires_at');
  expect(released).toContain('updated_at = NOW()');
});

test('intent creation is idempotent only on the public upload identity', async () => {
  await insertPresentationMaterialUpload({
    id: INPUT.uploadId,
    requestId: INPUT.requestId,
    siteVisitId: '55555555-5555-4555-8555-555555555555',
    actorId: INPUT.actorId,
    artifactType: 100000005,
    originalDisplayFilename: 'recording.mp4',
    validatedMimeType: 'video/mp4',
    declaredSize: 100,
    clientResumeFingerprint: 'a'.repeat(64),
    libraryName: 'akoya_request',
    folderPath: '1003220/Post Site Visit Materials',
    physicalFilename: 'recording.mp4',
    generationKey: 'b'.repeat(64),
    intentExpiresAt: '2026-09-28T12:00:00Z',
  });
  expect(statement()).toContain('ON CONFLICT (id) DO NOTHING RETURNING');
});

test('completion is candidate-gated and atomically clears the preauthenticated URL and lease', async () => {
  await completePresentationMaterialUpload({
    ...INPUT,
    requestDocumentId: '55555555-5555-4555-8555-555555555555',
  });
  const text = statement();
  expect(text).toContain("SET state = 'finalized'");
  expect(text).toContain('upload_url_ciphertext = NULL');
  expect(text).toContain('lease_token = NULL');
  expect(text).toContain('candidate_item_id IS NOT NULL');
  expect(text).toContain('lease_expires_at > NOW()');
});

const BROWSER_ONLY = "origin = 'browser'";
const CANDIDATE = { siteId: 'site', driveId: 'drive', itemId: 'item', versionId: '1.0', eTag: 'etag', size: 100 };

test('browser reads, claims and unleased writers are isolated to origin browser', async () => {
  await listPresentationMaterialUploads(INPUT);
  expect(statement()).toContain(`actor_id = ? AND ${BROWSER_ONLY} AND state NOT IN`);

  await claimPresentationMaterialUpload(INPUT);
  expect(statement()).toContain(`actor_id = ? AND ${BROWSER_ONLY} AND intent_expires_at > NOW()`);

  await claimPresentationMaterialUploadRecovery(INPUT);
  expect(statement()).toContain(`actor_id = ? AND ${BROWSER_ONLY} AND state IN ('initiated', 'failed')`);

  await recordPresentationMaterialUploadSession({
    uploadId: INPUT.uploadId, uploadUrlCiphertext: 'sealed', expiresAt: 'x', intentExpiresAt: 'y',
  });
  expect(statement()).toContain(`WHERE id = ? AND ${BROWSER_ONLY} AND state = 'initiated'`);

  await markPresentationMaterialUploadFailed({ uploadId: INPUT.uploadId, lastError: 'e' });
  expect(statement()).toContain(`WHERE id = ? AND ${BROWSER_ONLY} AND state = 'initiated'`);

  await markPresentationMaterialUploadSessionClosed({ ...INPUT, uploadUrlCiphertext: 'sealed', lastError: 'e' });
  expect(statement()).toContain(`(lease_token IS NULL OR lease_expires_at <= NOW()) AND ${BROWSER_ONLY}`);

  await recordPresentationMaterialUploadCandidate({ ...INPUT, leaseToken: null, candidate: CANDIDATE });
  expect(statement()).toContain(`AND NOT (state = 'failed' AND candidate_item_id IS NOT NULL) AND ${BROWSER_ONLY}`);
});

test('session refresh exempts only a caller holding a lease token from the browser origin predicate', async () => {
  await refreshPresentationMaterialUploadSession({
    ...INPUT, uploadUrlCiphertext: 'sealed', expiresAt: 'x', intentExpiresAt: 'y',
  });
  expect(statement()).toContain(`AND (?::uuid IS NOT NULL OR ${BROWSER_ONLY})`);
  const params = sql.mock.calls.at(-1).slice(1);
  expect(params.filter((value) => value === INPUT.leaseToken)).toHaveLength(2);

  await refreshPresentationMaterialUploadSession({
    ...INPUT, leaseToken: undefined, uploadUrlCiphertext: 'sealed', expiresAt: 'x', intentExpiresAt: 'y',
  });
  expect(sql.mock.calls.at(-1).slice(1)).not.toContain(INPUT.leaseToken);
  expect(sql.mock.calls.at(-1).slice(1).filter((value) => value === null)).toHaveLength(2);
});

test('the token-keyed candidate writer stays origin-agnostic', async () => {
  await recordPresentationMaterialUploadCandidate({ ...INPUT, candidate: CANDIDATE });
  expect(statement()).not.toContain('origin');
});

test('token-keyed, recovery and cleanup functions never mention origin', async () => {
  const calls = [
    () => renewPresentationMaterialUploadLease(INPUT),
    () => releasePresentationMaterialUpload(INPUT),
    () => completePresentationMaterialUpload({ ...INPUT, requestDocumentId: INPUT.uploadId }),
    () => renewPresentationMaterialUploadRecovery(INPUT),
    () => releasePresentationMaterialUploadRecovery(INPUT),
    () => markPresentationMaterialUploadRecoveryTerminal(INPUT),
    () => markPresentationMaterialUploadRecoveryUncertain(INPUT),
    () => cancelPresentationMaterialUploadRecovery(INPUT),
    () => recordPresentationMaterialUploadRecoverySession({ ...INPUT, uploadUrlCiphertext: 's', expiresAt: 'x', intentExpiresAt: 'y' }),
    () => claimPresentationMaterialUploadsForCleanup(),
    () => releasePresentationMaterialUploadCleanupLease(INPUT),
    () => renewPresentationMaterialUploadCleanupLease(INPUT),
    () => abandonPresentationMaterialUpload(INPUT),
    () => bindPresentationMaterialUploadForCleanup({ ...INPUT, requestDocumentId: INPUT.uploadId }),
  ];
  for (const call of calls) {
    sql.mockClear();
    await call();
    expect(statement()).not.toContain('origin');
  }
});

test('intent creation writes origin explicitly, browser by default and zoom_copy only when passed', async () => {
  const row = {
    id: INPUT.uploadId, requestId: INPUT.requestId, siteVisitId: INPUT.requestId, actorId: INPUT.actorId,
    artifactType: 100000005, originalDisplayFilename: 'r.mp4', validatedMimeType: 'video/mp4', declaredSize: 100,
    clientResumeFingerprint: 'a'.repeat(64), libraryName: 'l', folderPath: 'f', physicalFilename: 'p.mp4',
    generationKey: 'b'.repeat(64), intentExpiresAt: '2026-09-28T12:00:00Z',
  };
  await insertPresentationMaterialUpload(row);
  expect(statement()).toContain('intent_expires_at, origin ) VALUES');
  expect(sql.mock.calls.at(-1).at(-1)).toBe('browser');
  await insertPresentationMaterialUpload({ ...row, origin: 'zoom_copy' });
  expect(sql.mock.calls.at(-1).at(-1)).toBe('zoom_copy');
});
