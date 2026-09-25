/** Durable actor/request-bound browser-direct Graph upload intents. */
import crypto from 'node:crypto';
import { sql } from '@vercel/postgres';

export const PRESENTATION_UPLOAD_LEASE_SECONDS = 300;
export const PRESENTATION_UPLOAD_REVIEW_GRACE_MS = 3 * 24 * 60 * 60 * 1000;
export const PRESENTATION_UPLOAD_CLEANUP_REVIEW_SECONDS = 6 * 60 * 60;

export async function getPresentationMaterialUpload({ uploadId, requestId, actorId }) {
  const result = await sql`
    SELECT * FROM presentation_material_uploads
     WHERE id = ${uploadId}
       AND request_id = ${requestId}
       AND actor_id = ${actorId}
     LIMIT 1
  `;
  return result.rows[0] || null;
}

export async function listPresentationMaterialUploads({ requestId, actorId }) {
  const result = await sql`
    SELECT id, request_id, artifact_type, original_display_filename,
           validated_mime_type, declared_size, client_resume_fingerprint,
           state, upload_session_expires_at, intent_expires_at, lease_expires_at,
           candidate_item_id, request_document_id, created_at, updated_at
      FROM presentation_material_uploads
     WHERE request_id = ${requestId}
       AND actor_id = ${actorId}
       AND state <> 'finalized'
     ORDER BY created_at DESC
  `;
  return result.rows;
}

export async function insertPresentationMaterialUpload(row) {
  const result = await sql`
    INSERT INTO presentation_material_uploads (
      id, request_id, site_visit_id, actor_id, artifact_type,
      original_display_filename, validated_mime_type, declared_size,
      client_resume_fingerprint, library_name, folder_path,
      physical_filename, generation_key, intent_expires_at
    ) VALUES (
      ${row.id}, ${row.requestId}, ${row.siteVisitId}, ${row.actorId}, ${row.artifactType},
      ${row.originalDisplayFilename}, ${row.validatedMimeType}, ${row.declaredSize},
      ${row.clientResumeFingerprint}, ${row.libraryName}, ${row.folderPath},
      ${row.physicalFilename}, ${row.generationKey}, ${row.intentExpiresAt}
    )
    ON CONFLICT (id) DO NOTHING
    RETURNING *
  `;
  return result.rows[0] || null;
}

export async function recordPresentationMaterialUploadSession({
  uploadId, uploadUrlCiphertext, expiresAt, intentExpiresAt,
}) {
  const result = await sql`
    UPDATE presentation_material_uploads
       SET upload_url_ciphertext = ${uploadUrlCiphertext},
           upload_session_expires_at = ${expiresAt},
           intent_expires_at = ${intentExpiresAt},
           last_error = NULL,
           updated_at = NOW()
     WHERE id = ${uploadId}
       AND state = 'initiated'
       AND upload_url_ciphertext IS NULL
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function refreshPresentationMaterialUploadSession({ uploadId, requestId, actorId, expiresAt, intentExpiresAt }) {
  const result = await sql`
    UPDATE presentation_material_uploads
       SET upload_session_expires_at = ${expiresAt},
           intent_expires_at = ${intentExpiresAt},
           last_error = NULL,
           updated_at = NOW()
     WHERE id = ${uploadId}
       AND request_id = ${requestId}
       AND actor_id = ${actorId}
       AND state IN ('initiated', 'uploaded')
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function markPresentationMaterialUploadFailed({ uploadId, lastError }) {
  const result = await sql`
    UPDATE presentation_material_uploads
       SET state = 'failed', last_error = ${String(lastError || '').slice(0, 2000)}, updated_at = NOW()
     WHERE id = ${uploadId} AND state = 'initiated' AND upload_url_ciphertext IS NULL
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function markPresentationMaterialUploadSessionClosed({ uploadId, requestId, actorId, lastError }) {
  const result = await sql`
    UPDATE presentation_material_uploads
       SET state = 'failed',
           last_error = ${String(lastError || '').slice(0, 2000)},
           updated_at = NOW()
     WHERE id = ${uploadId}
       AND request_id = ${requestId}
       AND actor_id = ${actorId}
       AND state IN ('initiated', 'failed')
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function recordPresentationMaterialUploadCandidate({ uploadId, requestId, actorId, candidate, leaseToken = null }) {
  const candidateColumns = {
    siteId: candidate.siteId,
    driveId: candidate.driveId,
    itemId: candidate.itemId,
    versionId: candidate.versionId,
    eTag: candidate.eTag,
    size: candidate.size,
  };
  const result = leaseToken
    ? await sql`
    UPDATE presentation_material_uploads
       SET candidate_site_id = ${candidateColumns.siteId},
           candidate_drive_id = ${candidateColumns.driveId},
           candidate_item_id = ${candidateColumns.itemId},
           candidate_version_id = ${candidateColumns.versionId},
           candidate_etag = ${candidateColumns.eTag},
           candidate_size = ${candidateColumns.size},
           last_error = NULL,
           updated_at = NOW()
     WHERE id = ${uploadId}
       AND request_id = ${requestId}
       AND actor_id = ${actorId}
       AND state NOT IN ('finalized', 'abandoned')
       AND lease_token = ${leaseToken}
       AND lease_expires_at > NOW()
     RETURNING *
  `
    : await sql`
    UPDATE presentation_material_uploads
       SET state = 'uploaded',
           candidate_site_id = ${candidate.siteId},
           candidate_drive_id = ${candidate.driveId},
           candidate_item_id = ${candidate.itemId},
           candidate_version_id = ${candidate.versionId},
           candidate_etag = ${candidate.eTag},
           candidate_size = ${candidate.size},
           last_error = NULL,
           updated_at = NOW()
     WHERE id = ${uploadId}
       AND request_id = ${requestId}
       AND actor_id = ${actorId}
       AND (
         state IN ('initiated', 'uploaded', 'failed')
         OR (state = 'finalizing' AND lease_expires_at <= NOW())
       )
       AND (lease_token IS NULL OR lease_expires_at <= NOW())
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function claimPresentationMaterialUpload({ uploadId, requestId, actorId }) {
  const leaseToken = crypto.randomUUID();
  const claimed = await sql`
    UPDATE presentation_material_uploads
       SET state = 'finalizing',
           lease_token = ${leaseToken},
           lease_expires_at = NOW() + (${PRESENTATION_UPLOAD_LEASE_SECONDS} || ' seconds')::INTERVAL,
           updated_at = NOW()
     WHERE id = ${uploadId}
       AND request_id = ${requestId}
       AND actor_id = ${actorId}
       AND intent_expires_at > NOW()
       AND (
         (state IN ('initiated', 'uploaded') AND (lease_token IS NULL OR lease_expires_at <= NOW()))
         OR (state = 'finalizing' AND lease_expires_at <= NOW())
       )
     RETURNING *
  `;
  if (claimed.rows[0]) return { state: 'claimed', row: claimed.rows[0], leaseToken };
  const row = await getPresentationMaterialUpload({ uploadId, requestId, actorId });
  if (!row) return { state: 'not_found' };
  if (row.state === 'finalized') return { state: 'finalized', row };
  if (new Date(row.intent_expires_at).getTime() <= Date.now()) return { state: 'expired', row };
  return { state: 'busy', row };
}

export async function renewPresentationMaterialUploadLease({ uploadId, leaseToken }) {
  const result = await sql`
    UPDATE presentation_material_uploads
       SET lease_expires_at = NOW() + (${PRESENTATION_UPLOAD_LEASE_SECONDS} || ' seconds')::INTERVAL,
           updated_at = NOW()
     WHERE id = ${uploadId}
       AND lease_token = ${leaseToken}
       AND lease_expires_at > NOW()
       AND intent_expires_at > NOW()
       AND state = 'finalizing'
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function releasePresentationMaterialUpload({ uploadId, leaseToken, lastError = null }) {
  const result = await sql`
    UPDATE presentation_material_uploads
       SET state = CASE WHEN candidate_item_id IS NULL THEN 'initiated' ELSE 'uploaded' END,
           lease_token = NULL,
           lease_expires_at = NULL,
           last_error = ${lastError ? String(lastError).slice(0, 2000) : null},
           updated_at = NOW()
     WHERE id = ${uploadId}
       AND lease_token = ${leaseToken}
       AND state = 'finalizing'
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function completePresentationMaterialUpload({ uploadId, leaseToken, requestDocumentId }) {
  const result = await sql`
    UPDATE presentation_material_uploads
       SET state = 'finalized',
           request_document_id = ${requestDocumentId},
           finalized_at = NOW(),
           upload_url_ciphertext = NULL,
           lease_token = NULL,
           lease_expires_at = NULL,
           last_error = NULL,
           updated_at = NOW()
     WHERE id = ${uploadId}
       AND lease_token = ${leaseToken}
       AND lease_expires_at > NOW()
       AND state = 'finalizing'
       AND candidate_item_id IS NOT NULL
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function claimPresentationMaterialUploadsForCleanup({ limit = 4 } = {}) {
  const leaseToken = crypto.randomUUID();
  const result = await sql`
    WITH eligible AS (
      SELECT id
        FROM presentation_material_uploads
       WHERE state NOT IN ('finalized', 'abandoned')
         AND intent_expires_at <= NOW()
         AND updated_at <= NOW() - (${PRESENTATION_UPLOAD_CLEANUP_REVIEW_SECONDS} || ' seconds')::INTERVAL
         AND (lease_token IS NULL OR lease_expires_at <= NOW())
       ORDER BY updated_at ASC, intent_expires_at ASC
       LIMIT ${limit}
       FOR UPDATE SKIP LOCKED
    )
    UPDATE presentation_material_uploads uploads
       SET lease_token = ${leaseToken},
           lease_expires_at = NOW() + (${PRESENTATION_UPLOAD_LEASE_SECONDS} || ' seconds')::INTERVAL,
           updated_at = NOW()
      FROM eligible
     WHERE uploads.id = eligible.id
    RETURNING uploads.*
  `;
  return { leaseToken, rows: result.rows };
}

export async function releasePresentationMaterialUploadCleanupLease({
  uploadId, leaseToken, lastError = null,
}) {
  const result = await sql`
    UPDATE presentation_material_uploads
       SET lease_token = NULL,
           lease_expires_at = NULL,
           last_error = ${lastError ? String(lastError).slice(0, 2000) : null},
           updated_at = NOW()
     WHERE id = ${uploadId}
       AND lease_token = ${leaseToken}
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function renewPresentationMaterialUploadCleanupLease({ uploadId, leaseToken }) {
  const result = await sql`
    UPDATE presentation_material_uploads
       SET lease_expires_at = NOW() + (${PRESENTATION_UPLOAD_LEASE_SECONDS} || ' seconds')::INTERVAL,
           updated_at = NOW()
     WHERE id = ${uploadId}
       AND lease_token = ${leaseToken}
       AND lease_expires_at > NOW()
       AND intent_expires_at <= NOW()
       AND state NOT IN ('finalized', 'abandoned')
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function abandonPresentationMaterialUpload({ uploadId, leaseToken, lastError }) {
  const result = await sql`
    UPDATE presentation_material_uploads
       SET state = 'abandoned',
           upload_url_ciphertext = NULL,
           lease_token = NULL,
           lease_expires_at = NULL,
           last_error = ${String(lastError || 'abandoned').slice(0, 2000)},
           updated_at = NOW()
     WHERE id = ${uploadId}
       AND lease_token = ${leaseToken}
       AND lease_expires_at > NOW()
       AND state <> 'finalized'
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function bindPresentationMaterialUploadForCleanup({ uploadId, leaseToken, requestDocumentId }) {
  const result = await sql`
    UPDATE presentation_material_uploads
       SET state = 'finalized',
           request_document_id = ${requestDocumentId},
           finalized_at = COALESCE(finalized_at, NOW()),
           upload_url_ciphertext = NULL,
           lease_token = NULL,
           lease_expires_at = NULL,
           last_error = NULL,
           updated_at = NOW()
     WHERE id = ${uploadId}
       AND lease_token = ${leaseToken}
       AND lease_expires_at > NOW()
       AND candidate_item_id IS NOT NULL
       AND state <> 'finalized'
     RETURNING *
  `;
  return result.rows[0] || null;
}
