/**
 * Durable, actor-bound staging for browser-direct private Blob uploads.
 *
 * Contract:
 *   mint: server chooses the pathname and records its owner before returning a
 *         short-lived, path-scoped client token.
 *   claim: finalize callers atomically acquire a lease by staging id + actor +
 *          scope + resource. A client-supplied pathname is never accepted.
 *   load: server fetches the exact private object, verifies metadata and bytes,
 *         and records its immutable Blob etag/hash under the lease.
 *   candidate/complete: downstream identity is durable before the Dataverse
 *         commit; a terminal response is durable before staged bytes are reaped.
 */

import crypto from 'crypto';
import { sql } from '@vercel/postgres';
import { del, get } from '@vercel/blob';
import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client';
import { sanitizeBlobFilename } from '../utils/blob-filename.js';
import { cleanupSharePointItemsDetailed } from './sharepoint-cleanup.js';

export const PORTAL_UPLOAD_SCOPES = Object.freeze({
  GRANTEE_IMAGE: 'grantee_image',
  STAFF_GRANTEE_IMAGE: 'staff_grantee_image',
});

export const PORTAL_IMAGE_CONTENT_TYPES = Object.freeze([
  'image/png',
  'image/jpeg',
  'image/webp',
]);

const VALID_SCOPES = new Set(Object.values(PORTAL_UPLOAD_SCOPES));
const VALID_IMAGE_TYPES = new Set(PORTAL_IMAGE_CONTENT_TYPES);
const TOKEN_TTL_MS = 15 * 60_000;
const ROW_TTL_MS = 60 * 60_000;
const LEASE_TTL_MS = 5 * 60_000;

export class PortalUploadStagingError extends Error {
  constructor(code, { httpStatus = 400, cause = null } = {}) {
    super(code, cause ? { cause } : undefined);
    this.name = 'PortalUploadStagingError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function uploadsBlobToken() {
  const token = process.env.UPLOADS_BLOB_RW_TOKEN;
  if (!token) {
    throw new PortalUploadStagingError('staging_unavailable', { httpStatus: 503 });
  }
  return token;
}

function assertScope(scope) {
  if (!VALID_SCOPES.has(scope)) throw new Error(`Unsupported portal upload scope: ${scope}`);
}

export function externalGranteeActorBinding(token) {
  return `grantee:${crypto.createHash('sha256').update(String(token || '')).digest('hex')}`;
}

export function staffActorBinding(profileId) {
  if (profileId === null || profileId === undefined || profileId === '') {
    // Development auth bypass has no stable profile. Keep it distinct from any
    // real user and still server-derived; production requireAppAccess never
    // returns this binding.
    return 'profile:development-bypass';
  }
  return `profile:${String(profileId)}`;
}

export async function createPortalUpload({
  scope,
  resourceId,
  actorBinding,
  filename,
  contentType,
  maxBytes,
  originalEtag = null,
}) {
  assertScope(scope);
  if (!resourceId || !actorBinding) throw new Error('resourceId and actorBinding are required');
  if (!VALID_IMAGE_TYPES.has(contentType)) {
    throw new PortalUploadStagingError('content_type_not_allowed', { httpStatus: 422 });
  }
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) throw new Error('maxBytes must be a positive integer');

  let safeFilename;
  try {
    safeFilename = sanitizeBlobFilename(filename);
  } catch (cause) {
    throw new PortalUploadStagingError('filename_invalid', { httpStatus: 422, cause });
  }

  const id = crypto.randomUUID();
  const pathname = `portal-staging/${scope}/${resourceId}/${id}`;
  const now = Date.now();
  const tokenValidUntil = now + TOKEN_TTL_MS;
  const rowExpiresAt = new Date(now + ROW_TTL_MS);

  let clientToken;
  try {
    clientToken = await generateClientTokenFromReadWriteToken({
      pathname,
      maximumSizeInBytes: maxBytes,
      allowedContentTypes: [contentType],
      validUntil: tokenValidUntil,
      addRandomSuffix: false,
      allowOverwrite: false,
      cacheControlMaxAge: 60,
      token: uploadsBlobToken(),
    });
  } catch (cause) {
    if (cause instanceof PortalUploadStagingError) throw cause;
    throw new PortalUploadStagingError('staging_unavailable', { httpStatus: 503, cause });
  }

  try {
    await sql`
      INSERT INTO portal_upload_staging (
        id, scope, resource_id, actor_binding, pathname, filename,
        declared_content_type, max_bytes, original_etag, expires_at
      ) VALUES (
        ${id}, ${scope}, ${resourceId}, ${actorBinding}, ${pathname}, ${safeFilename},
        ${contentType}, ${maxBytes}, ${originalEtag || null}, ${rowExpiresAt}
      )
    `;
  } catch (cause) {
    throw new PortalUploadStagingError('staging_unavailable', { httpStatus: 503, cause });
  }

  return {
    stagingId: id,
    pathname,
    clientToken,
    access: 'private',
    contentType,
    tokenExpiresAt: new Date(tokenValidUntil).toISOString(),
    stagingExpiresAt: rowExpiresAt.toISOString(),
  };
}

export async function claimPortalUpload({ stagingId, scope, resourceId, actorBinding }) {
  assertScope(scope);
  const leaseToken = crypto.randomUUID();
  const leaseExpiresAt = new Date(Date.now() + LEASE_TTL_MS);

  const claimed = await sql`
    UPDATE portal_upload_staging
       SET status = 'finalizing',
           lease_token = ${leaseToken},
           lease_expires_at = ${leaseExpiresAt},
           updated_at = NOW()
     WHERE id = ${stagingId}
       AND scope = ${scope}
       AND resource_id = ${resourceId}
       AND actor_binding = ${actorBinding}
       AND expires_at > NOW()
       AND (
         status = 'pending'
         OR (status = 'finalizing' AND lease_expires_at < NOW())
       )
     RETURNING *
  `;
  if (claimed.rows[0]) return { state: 'claimed', row: claimed.rows[0], leaseToken };

  // Deliberately use the full ownership tuple again: a valid-but-foreign id is
  // indistinguishable from a nonexistent id.
  const found = await sql`
    SELECT * FROM portal_upload_staging
     WHERE id = ${stagingId}
       AND scope = ${scope}
       AND resource_id = ${resourceId}
       AND actor_binding = ${actorBinding}
     LIMIT 1
  `;
  const row = found.rows[0];
  if (!row) throw new PortalUploadStagingError('staging_not_found', { httpStatus: 404 });
  if (row.status === 'consumed') return { state: 'consumed', row, result: row.result_payload };
  if (row.status === 'rejected') throw new PortalUploadStagingError(row.result_code || 'staging_rejected', { httpStatus: 409 });
  if (new Date(row.expires_at).getTime() <= Date.now() || row.status === 'expired') {
    await sql`
      UPDATE portal_upload_staging
         SET status = 'expired', lease_token = NULL, lease_expires_at = NULL, updated_at = NOW()
       WHERE id = ${stagingId} AND status <> 'consumed'
    `;
    throw new PortalUploadStagingError('staging_expired', { httpStatus: 410 });
  }
  throw new PortalUploadStagingError('finalize_in_progress', { httpStatus: 409 });
}

export async function loadClaimedPortalImage({ row, leaseToken }) {
  let result;
  try {
    result = await get(row.pathname, {
      access: 'private',
      useCache: false,
      token: uploadsBlobToken(),
    });
  } catch (cause) {
    throw new PortalUploadStagingError('staged_upload_missing', { httpStatus: 409, cause });
  }
  if (!result || result.statusCode !== 200 || !result.stream || result.blob?.pathname !== row.pathname) {
    throw new PortalUploadStagingError('staged_upload_missing', { httpStatus: 409 });
  }
  if (result.blob.contentType !== row.declared_content_type) {
    throw new PortalUploadStagingError('staged_upload_mismatch', { httpStatus: 422 });
  }
  if (!Number.isSafeInteger(result.blob.size) || result.blob.size <= 0) {
    throw new PortalUploadStagingError('empty_image', { httpStatus: 400 });
  }
  if (result.blob.size > Number(row.max_bytes)) {
    throw new PortalUploadStagingError('image_too_large', { httpStatus: 400 });
  }

  // Defense in depth against a future store/SDK policy regression: the exact
  // object must not be anonymously readable even though the client token was
  // minted from a private store. Never log or return the Blob URL.
  let anonymous;
  try {
    anonymous = await fetch(result.blob.url, { method: 'HEAD', redirect: 'manual' });
  } catch (cause) {
    throw new PortalUploadStagingError('staging_privacy_unverified', { httpStatus: 503, cause });
  }
  if (anonymous.ok) {
    throw new PortalUploadStagingError('staging_publicly_readable', { httpStatus: 422 });
  }
  if (anonymous.status !== 401 && anonymous.status !== 403) {
    throw new PortalUploadStagingError('staging_privacy_unverified', { httpStatus: 503 });
  }

  const buffer = Buffer.from(await new Response(result.stream).arrayBuffer());
  if (buffer.length !== result.blob.size || buffer.length > Number(row.max_bytes)) {
    throw new PortalUploadStagingError('staged_upload_mismatch', { httpStatus: 422 });
  }
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const updated = await sql`
    UPDATE portal_upload_staging
       SET blob_etag = ${result.blob.etag}, sha256 = ${sha256}, actual_bytes = ${buffer.length}, updated_at = NOW()
     WHERE id = ${row.id} AND status = 'finalizing' AND lease_token = ${leaseToken}
     RETURNING id
  `;
  if (!updated.rows[0]) throw new PortalUploadStagingError('finalize_lease_lost', { httpStatus: 409 });

  return {
    buffer,
    filename: row.filename,
    mimeType: row.declared_content_type,
    sha256,
    blobEtag: result.blob.etag,
  };
}

export async function recordPortalUploadCandidate({ stagingId, leaseToken, candidate }) {
  const updated = await sql`
    UPDATE portal_upload_staging
       SET candidate_result = ${JSON.stringify(candidate)}::jsonb, updated_at = NOW()
     WHERE id = ${stagingId} AND status = 'finalizing' AND lease_token = ${leaseToken}
     RETURNING id
  `;
  if (!updated.rows[0]) throw new PortalUploadStagingError('finalize_lease_lost', { httpStatus: 409 });
}

export async function completePortalUpload({ stagingId, leaseToken, resultCode = 'ok', resultPayload }) {
  const completed = await sql`
    UPDATE portal_upload_staging
       SET status = 'consumed',
           result_code = ${resultCode},
           result_payload = ${JSON.stringify(resultPayload || { ok: true })}::jsonb,
           consumed_at = NOW(),
           lease_token = NULL,
           lease_expires_at = NULL,
           updated_at = NOW()
     WHERE id = ${stagingId} AND status = 'finalizing' AND lease_token = ${leaseToken}
     RETURNING pathname, result_payload
  `;
  if (!completed.rows[0]) throw new PortalUploadStagingError('finalize_lease_lost', { httpStatus: 409 });
  try {
    await del(completed.rows[0].pathname, { token: uploadsBlobToken() });
  } catch (error) {
    // Durable consumed state is authoritative; exact-path maintenance cleanup
    // will retry the byte deletion. Never turn a committed domain write into a
    // reported failure because staging cleanup had a transient error.
    console.warn('[portal-upload-staging] post-commit Blob cleanup failed:', error?.message || error);
  }
  return completed.rows[0].result_payload;
}

export async function releasePortalUpload({ stagingId, leaseToken }) {
  await sql`
    UPDATE portal_upload_staging
       SET status = 'pending', lease_token = NULL, lease_expires_at = NULL, updated_at = NOW()
     WHERE id = ${stagingId} AND status = 'finalizing' AND lease_token = ${leaseToken}
  `;
}

export async function rejectPortalUpload({ stagingId, leaseToken, resultCode }) {
  const rejected = await sql`
    UPDATE portal_upload_staging
       SET status = 'rejected', result_code = ${resultCode},
           lease_token = NULL, lease_expires_at = NULL, updated_at = NOW()
     WHERE id = ${stagingId} AND status = 'finalizing' AND lease_token = ${leaseToken}
     RETURNING pathname
  `;
  if (rejected.rows[0]) {
    try {
      await del(rejected.rows[0].pathname, { token: uploadsBlobToken() });
    } catch (error) {
      console.warn('[portal-upload-staging] rejected Blob cleanup failed:', error?.message || error);
    }
  }
}

export async function clearPortalUploadCandidate({ stagingId, leaseToken }) {
  const updated = await sql`
    UPDATE portal_upload_staging
       SET candidate_result = NULL, updated_at = NOW()
     WHERE id = ${stagingId} AND status = 'finalizing' AND lease_token = ${leaseToken}
     RETURNING id
  `;
  if (!updated.rows[0]) throw new PortalUploadStagingError('finalize_lease_lost', { httpStatus: 409 });
}

export async function discardPortalUploadCandidate(candidate) {
  const driveId = typeof candidate?.driveId === 'string' ? candidate.driveId : '';
  const itemId = typeof candidate?.itemId === 'string' ? candidate.itemId : '';
  if (!driveId || !itemId) return false;
  const cleanup = await cleanupSharePointItemsDetailed(
    driveId,
    [{ id: itemId }],
    'portal-staging-reconcile',
  );
  return cleanup.failed.length === 0
    || cleanup.failed.every((item) => /\b404\b|not[ -]?found/i.test(item.error || ''));
}

export async function cleanupExpiredPortalUploads({ retentionDays = 7 } = {}) {
  // Resolve once and fail the whole maintenance subtask if the store credential
  // is absent. Advancing/pruning ledger rows without the ability to delete their
  // bytes would erase the only exact cleanup authority and strand objects.
  const token = uploadsBlobToken();
  const eligible = await sql`
    SELECT id, pathname
      FROM portal_upload_staging
     WHERE expires_at < NOW()
       AND NOT (status = 'finalizing' AND lease_expires_at >= NOW())
     ORDER BY expires_at ASC
     LIMIT 500
  `;
  let deleted = 0;
  let errors = 0;
  for (const row of eligible.rows) {
    let blobSettled = false;
    try {
      await del(row.pathname, { token });
      blobSettled = true;
    } catch (error) {
      // Blob-not-found errors vary by SDK version; deleting an already-absent
      // object is the desired state. Only retain a diagnostic count here.
      if (error?.name === 'BlobNotFoundError') blobSettled = true;
      else errors += 1;
    }
    await sql`
      UPDATE portal_upload_staging
         SET status = CASE WHEN status = 'consumed' THEN status ELSE 'expired' END,
             lease_token = NULL,
             lease_expires_at = NULL,
             updated_at = NOW()
       WHERE id = ${row.id}
         AND NOT (status = 'finalizing' AND lease_expires_at >= NOW())
    `;
    if (blobSettled) deleted += 1;
  }
  const pruned = await sql`
    DELETE FROM portal_upload_staging
     WHERE updated_at < NOW() - (${retentionDays} * INTERVAL '1 day')
       AND status IN ('consumed', 'rejected', 'expired')
  `;
  return { deleted, pruned: pruned.rowCount || 0, errors };
}
