/** @jest-environment node */

jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));
jest.mock('@vercel/blob', () => ({
  del: jest.fn(),
  get: jest.fn(),
}));
jest.mock('@vercel/blob/client', () => ({
  generateClientTokenFromReadWriteToken: jest.fn(),
}));
jest.mock('../../lib/services/sharepoint-cleanup', () => ({
  cleanupSharePointItemsDetailed: jest.fn(),
}));

import { sql } from '@vercel/postgres';
import { del, get } from '@vercel/blob';
import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client';
import {
  PORTAL_UPLOAD_SCOPES,
  PortalUploadStagingError,
  claimPortalUpload,
  cleanupExpiredPortalUploads,
  createPortalUpload,
  externalGranteeActorBinding,
  loadClaimedPortalImage,
} from '../../lib/services/portal-upload-staging';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const STAGING_ID = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  jest.clearAllMocks();
  process.env.UPLOADS_BLOB_RW_TOKEN = 'vercel_blob_rw_test_private';
  generateClientTokenFromReadWriteToken.mockResolvedValue('scoped-client-token');
  sql.mockResolvedValue({ rows: [], rowCount: 1 });
});

test('external actor binding is deterministic and never stores the raw token', () => {
  const raw = 'secret-external-token-value';
  const first = externalGranteeActorBinding(raw);
  expect(first).toBe(externalGranteeActorBinding(raw));
  expect(first).toMatch(/^grantee:[0-9a-f]{64}$/);
  expect(first).not.toContain(raw);
});

test('mint chooses opaque server pathname and a private-store constrained token', async () => {
  const result = await createPortalUpload({
    scope: PORTAL_UPLOAD_SCOPES.GRANTEE_IMAGE,
    resourceId: REQUEST_ID,
    actorBinding: 'grantee:hash',
    filename: 'Figure.png',
    contentType: 'image/png',
    maxBytes: 10 * 1024 * 1024,
    originalEtag: 'W/"1"',
  });

  expect(result.pathname).toMatch(new RegExp(`^portal-staging/grantee_image/${REQUEST_ID}/[0-9a-f-]{36}$`));
  expect(result.pathname).not.toContain('Figure.png');
  expect(result.access).toBe('private');
  expect(generateClientTokenFromReadWriteToken).toHaveBeenCalledWith(expect.objectContaining({
    pathname: result.pathname,
    maximumSizeInBytes: 10 * 1024 * 1024,
    allowedContentTypes: ['image/png'],
    addRandomSuffix: false,
    allowOverwrite: false,
    token: 'vercel_blob_rw_test_private',
  }));
});

test('foreign ownership tuple is indistinguishable from a missing staging id', async () => {
  sql.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
  await expect(claimPortalUpload({
    stagingId: STAGING_ID,
    scope: PORTAL_UPLOAD_SCOPES.GRANTEE_IMAGE,
    resourceId: REQUEST_ID,
    actorBinding: 'grantee:wrong',
  })).rejects.toMatchObject({ code: 'staging_not_found', httpStatus: 404 });
});

test('a consumed row returns its durable result without acquiring a second lease', async () => {
  sql.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
    rows: [{ status: 'consumed', result_payload: { ok: true, marker: 'same-result' } }],
  });
  const result = await claimPortalUpload({
    stagingId: STAGING_ID,
    scope: PORTAL_UPLOAD_SCOPES.GRANTEE_IMAGE,
    resourceId: REQUEST_ID,
    actorBinding: 'grantee:hash',
  });
  expect(result).toMatchObject({ state: 'consumed', result: { ok: true, marker: 'same-result' } });
  expect(sql).toHaveBeenCalledTimes(2);
});

test('load fetches only the ledger pathname as private and records verified bytes', async () => {
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  get.mockResolvedValue({
    statusCode: 200,
    stream: new Blob([bytes]).stream(),
    blob: {
      pathname: 'portal-staging/grantee_image/path',
      contentType: 'image/png',
      size: bytes.length,
      etag: 'blob-etag',
    },
  });
  sql.mockResolvedValue({ rows: [{ id: STAGING_ID }] });
  const result = await loadClaimedPortalImage({
    row: {
      id: STAGING_ID,
      pathname: 'portal-staging/grantee_image/path',
      filename: 'Figure.png',
      declared_content_type: 'image/png',
      max_bytes: 100,
    },
    leaseToken: '33333333-3333-4333-8333-333333333333',
  });
  expect(get).toHaveBeenCalledWith('portal-staging/grantee_image/path', {
    access: 'private', useCache: false, token: 'vercel_blob_rw_test_private',
  });
  expect(result.buffer).toEqual(bytes);
  expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
});

test('metadata mismatch rejects before bytes reach the domain writer', async () => {
  get.mockResolvedValue({
    statusCode: 200,
    stream: new Blob(['x']).stream(),
    blob: { pathname: 'exact', contentType: 'image/jpeg', size: 1, etag: 'e' },
  });
  await expect(loadClaimedPortalImage({
    row: { id: STAGING_ID, pathname: 'exact', filename: 'x.png', declared_content_type: 'image/png', max_bytes: 100 },
    leaseToken: '33333333-3333-4333-8333-333333333333',
  })).rejects.toBeInstanceOf(PortalUploadStagingError);
  expect(sql).not.toHaveBeenCalled();
});

test('cleanup fails before reading or pruning the ledger when the private-store token is absent', async () => {
  delete process.env.UPLOADS_BLOB_RW_TOKEN;

  await expect(cleanupExpiredPortalUploads()).rejects.toMatchObject({
    code: 'staging_unavailable',
    httpStatus: 503,
  });
  expect(sql).not.toHaveBeenCalled();
  expect(del).not.toHaveBeenCalled();
});
