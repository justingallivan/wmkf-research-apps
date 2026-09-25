/** @jest-environment node */
jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));

import { sql } from '@vercel/postgres';
import {
  claimPresentationMaterialUpload,
  claimPresentationMaterialUploadsForCleanup,
  completePresentationMaterialUpload,
  getPresentationMaterialUpload,
  insertPresentationMaterialUpload,
  listPresentationMaterialUploads,
  recordPresentationMaterialUploadCandidate,
  releasePresentationMaterialUploadCleanupLease,
  renewPresentationMaterialUploadCleanupLease,
  renewPresentationMaterialUploadLease,
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
  expect(statement()).toContain('WHERE id = ? AND request_id = ? AND actor_id = ? LIMIT 1');

  await claimPresentationMaterialUpload(INPUT);
  const claim = statement();
  expect(claim).toContain('WHERE id = ? AND request_id = ? AND actor_id = ?');
  expect(claim).toContain("state IN ('initiated', 'uploaded')");
  expect(claim).toContain('(lease_token IS NULL OR lease_expires_at <= NOW())');
  expect(claim).toContain("state = 'finalizing' AND lease_expires_at <= NOW()");
  expect(claim).toContain('intent_expires_at > NOW()');
});

test('unfinished-upload projection includes the lease expiry needed to distinguish a live finalizer', async () => {
  await listPresentationMaterialUploads(INPUT);
  expect(statement()).toContain('intent_expires_at, lease_expires_at');
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
