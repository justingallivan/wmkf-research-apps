/** Durable actor/request-bound browser-direct Graph upload intents. */
import crypto from 'node:crypto';
import { db, sql } from '@vercel/postgres';
import { sanitizeFailureCode } from '../meeting-tracker-recordings/import-store.js';

export const PRESENTATION_UPLOAD_LEASE_SECONDS = 300;
export const PRESENTATION_UPLOAD_REVIEW_GRACE_MS = 3 * 24 * 60 * 60 * 1000;
export const PRESENTATION_UPLOAD_CLEANUP_REVIEW_SECONDS = 6 * 60 * 60;

export async function getPresentationMaterialUpload({ uploadId, requestId, actorId }) {
  const result = await sql`
    SELECT * FROM presentation_material_uploads
     WHERE id = ${uploadId}
       AND request_id = ${requestId}
       AND actor_id = ${actorId}
       AND origin = 'browser'
     LIMIT 1
  `;
  return result.rows[0] || null;
}

export async function listPresentationMaterialUploads({ requestId, actorId }) {
  const result = await sql`
    SELECT id, request_id, artifact_type, original_display_filename,
           validated_mime_type, declared_size, client_resume_fingerprint,
           state, upload_session_expires_at, intent_expires_at, lease_token, lease_expires_at,
           candidate_item_id, request_document_id,
           created_at, updated_at
      FROM presentation_material_uploads
     WHERE request_id = ${requestId}
       AND actor_id = ${actorId}
       AND origin = 'browser'
       AND state NOT IN ('finalized', 'abandoned')
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
      physical_filename, generation_key, intent_expires_at, origin
    ) VALUES (
      ${row.id}, ${row.requestId}, ${row.siteVisitId}, ${row.actorId}, ${row.artifactType},
      ${row.originalDisplayFilename}, ${row.validatedMimeType}, ${row.declaredSize},
      ${row.clientResumeFingerprint}, ${row.libraryName}, ${row.folderPath},
      ${row.physicalFilename}, ${row.generationKey}, ${row.intentExpiresAt}, ${row.origin ?? 'browser'}
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
       AND origin = 'browser'
       AND state = 'initiated'
       AND upload_url_ciphertext IS NULL
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function refreshPresentationMaterialUploadSession({
  uploadId, requestId, actorId, uploadUrlCiphertext, expiresAt, intentExpiresAt, leaseToken = null,
}) {
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
       AND upload_url_ciphertext = ${uploadUrlCiphertext}
       AND (lease_token IS NULL OR lease_expires_at <= NOW() OR lease_token = ${leaseToken})
       AND (${leaseToken}::uuid IS NOT NULL OR origin = 'browser')
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function markPresentationMaterialUploadFailed({ uploadId, lastError }) {
  const result = await sql`
    UPDATE presentation_material_uploads
       SET state = 'failed', last_error = ${String(lastError || '').slice(0, 2000)}, updated_at = NOW()
     WHERE id = ${uploadId} AND origin = 'browser' AND state = 'initiated' AND upload_url_ciphertext IS NULL
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function markPresentationMaterialUploadSessionClosed({ uploadId, requestId, actorId, uploadUrlCiphertext, lastError }) {
  const result = await sql`
    UPDATE presentation_material_uploads
       SET state = 'failed',
           last_error = ${String(lastError || '').slice(0, 2000)},
           updated_at = NOW()
     WHERE id = ${uploadId}
       AND request_id = ${requestId}
       AND actor_id = ${actorId}
       AND state IN ('initiated', 'failed')
       AND upload_url_ciphertext = ${uploadUrlCiphertext}
       AND (lease_token IS NULL OR lease_expires_at <= NOW())
       AND origin = 'browser'
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
       SET state = CASE
             WHEN state = 'finalizing' THEN 'finalizing'
             WHEN state = 'failed' AND candidate_item_id IS NOT NULL THEN 'failed'
             ELSE 'uploaded'
           END,
           candidate_site_id = ${candidateColumns.siteId},
           candidate_drive_id = ${candidateColumns.driveId},
           candidate_item_id = ${candidateColumns.itemId},
           candidate_version_id = ${candidateColumns.versionId},
           candidate_etag = ${candidateColumns.eTag},
           candidate_size = ${candidateColumns.size},
           last_error = CASE
             WHEN state = 'failed' AND candidate_item_id IS NOT NULL THEN last_error
             ELSE NULL
           END,
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
       AND NOT (state = 'failed' AND candidate_item_id IS NOT NULL)
       AND origin = 'browser'
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
       AND origin = 'browser'
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
  if (row.state === 'failed' && row.candidate_item_id) return { state: 'rejected', row };
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

export async function releasePresentationMaterialUpload({ uploadId, leaseToken, lastError = null, terminal = false }) {
  const result = await sql`
    UPDATE presentation_material_uploads
       SET state = CASE
             WHEN ${terminal} AND candidate_item_id IS NOT NULL THEN 'failed'
             WHEN candidate_item_id IS NULL THEN 'initiated'
             ELSE 'uploaded'
           END,
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

/** Staff recovery shares the existing intent lease with finalize and cleanup. */
export async function claimPresentationMaterialUploadRecovery({ uploadId, requestId, actorId }) {
  const leaseToken = crypto.randomUUID();
  const result = await sql`
    UPDATE presentation_material_uploads
       SET lease_token = ${leaseToken},
           lease_expires_at = NOW() + (${PRESENTATION_UPLOAD_LEASE_SECONDS} || ' seconds')::INTERVAL,
           updated_at = NOW()
     WHERE id = ${uploadId}
       AND request_id = ${requestId}
       AND actor_id = ${actorId}
       AND origin = 'browser'
       AND state IN ('initiated', 'failed')
       AND candidate_item_id IS NULL
       AND request_document_id IS NULL
       AND (lease_token IS NULL OR lease_expires_at <= NOW())
     RETURNING *
  `;
  return result.rows[0] ? { row: result.rows[0], leaseToken } : null;
}

export async function renewPresentationMaterialUploadRecovery({ uploadId, leaseToken }) {
  const result = await sql`
    UPDATE presentation_material_uploads
       SET lease_expires_at = NOW() + (${PRESENTATION_UPLOAD_LEASE_SECONDS} || ' seconds')::INTERVAL,
           updated_at = NOW()
     WHERE id = ${uploadId}
       AND lease_token = ${leaseToken}
       AND lease_expires_at > NOW()
       AND state IN ('initiated', 'failed')
       AND candidate_item_id IS NULL
       AND request_document_id IS NULL
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function releasePresentationMaterialUploadRecovery({ uploadId, leaseToken }) {
  const result = await sql`
    UPDATE presentation_material_uploads
       SET lease_token = NULL,
           lease_expires_at = NULL,
           updated_at = NOW()
     WHERE id = ${uploadId}
       AND lease_token = ${leaseToken}
       AND lease_expires_at > NOW()
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function markPresentationMaterialUploadRecoveryTerminal({ uploadId, leaseToken }) {
  const result = await sql`
    UPDATE presentation_material_uploads
       SET state = 'failed', last_error = 'session_expired', updated_at = NOW()
     WHERE id = ${uploadId}
       AND lease_token = ${leaseToken}
       AND lease_expires_at > NOW()
       AND state IN ('initiated', 'failed')
       AND candidate_item_id IS NULL
       AND request_document_id IS NULL
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function markPresentationMaterialUploadRecoveryUncertain({ uploadId, leaseToken, lastError }) {
  const result = await sql`
    UPDATE presentation_material_uploads
       SET state = 'failed',
           last_error = ${String(lastError || 'recovery_uncertain').slice(0, 2000)},
           updated_at = NOW()
     WHERE id = ${uploadId}
       AND lease_token = ${leaseToken}
       AND lease_expires_at > NOW()
       AND state IN ('initiated', 'failed')
       AND candidate_item_id IS NULL
       AND request_document_id IS NULL
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function cancelPresentationMaterialUploadRecovery({ uploadId, leaseToken }) {
  const result = await sql`
    UPDATE presentation_material_uploads
       SET state = 'abandoned',
           upload_url_ciphertext = NULL,
           lease_token = NULL,
           lease_expires_at = NULL,
           last_error = 'staff_cancelled',
           updated_at = NOW()
     WHERE id = ${uploadId}
       AND lease_token = ${leaseToken}
       AND lease_expires_at > NOW()
       AND state IN ('initiated', 'failed')
       AND candidate_item_id IS NULL
       AND request_document_id IS NULL
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function recordPresentationMaterialUploadRecoverySession({
  uploadId, leaseToken, uploadUrlCiphertext, expiresAt, intentExpiresAt,
}) {
  const result = await sql`
    UPDATE presentation_material_uploads
       SET state = 'initiated',
           upload_url_ciphertext = ${uploadUrlCiphertext},
           upload_session_expires_at = ${expiresAt},
           intent_expires_at = ${intentExpiresAt},
           lease_token = NULL,
           lease_expires_at = NULL,
           last_error = NULL,
           updated_at = NOW()
     WHERE id = ${uploadId}
       AND lease_token = ${leaseToken}
       AND lease_expires_at > NOW()
       AND state = 'failed'
       AND candidate_item_id IS NULL
       AND request_document_id IS NULL
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
           last_error = CASE
             WHEN state = 'failed' AND candidate_item_id IS NOT NULL THEN last_error
             ELSE ${lastError ? String(lastError).slice(0, 2000) : null}
           END,
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
       AND NOT (state = 'failed' AND candidate_item_id IS NOT NULL)
     RETURNING *
  `;
  return result.rows[0] || null;
}

// --- Server-origin (origin = 'zoom_copy') writers, Stage 3b. The browser predicates above never match these. ---

const INSPECTABLE_STATES = ['initiated', 'uploaded', 'finalizing', 'failed', 'abandoned'];

/** I1. Pump lease: the recovery-shaped claim, keyed on origin and an unexpired intent instead of request/actor. */
export async function claimZoomCopyIntentPump({ uploadId }) {
  const leaseToken = crypto.randomUUID();
  const result = await sql`
    UPDATE presentation_material_uploads
       SET lease_token = ${leaseToken},
           lease_expires_at = NOW() + (${PRESENTATION_UPLOAD_LEASE_SECONDS} || ' seconds')::INTERVAL,
           updated_at = NOW()
     WHERE id = ${uploadId}
       AND origin = 'zoom_copy'
       AND state IN ('initiated', 'failed')
       AND candidate_item_id IS NULL
       AND request_document_id IS NULL
       AND intent_expires_at > NOW()
       AND (lease_token IS NULL OR lease_expires_at <= NOW())
     RETURNING *
  `;
  return result.rows[0] ? { row: result.rows[0], leaseToken } : null;
}

/** I2. Record the Graph session under the pump lease (keeps the lease; no browser caller shares it). */
export async function recordZoomCopyIntentSession({
  uploadId, leaseToken, uploadUrlCiphertext, expiresAt, intentExpiresAt,
}) {
  const result = await sql`
    UPDATE presentation_material_uploads
       SET upload_url_ciphertext = ${uploadUrlCiphertext},
           upload_session_expires_at = ${expiresAt},
           intent_expires_at = ${intentExpiresAt},
           last_error = NULL,
           updated_at = NOW()
     WHERE id = ${uploadId}
       AND origin = 'zoom_copy'
       AND state = 'initiated'
       AND upload_url_ciphertext IS NULL
       AND candidate_item_id IS NULL
       AND lease_token = ${leaseToken}
       AND lease_expires_at > NOW()
     RETURNING *
  `;
  return result.rows[0] || null;
}

/** I3. Finalize lease: `claimPresentationMaterialUpload` keyed on origin, narrowed to a recorded candidate. */
export async function claimZoomCopyIntentForFinalize({ uploadId }) {
  const leaseToken = crypto.randomUUID();
  const result = await sql`
    UPDATE presentation_material_uploads
       SET state = 'finalizing',
           lease_token = ${leaseToken},
           lease_expires_at = NOW() + (${PRESENTATION_UPLOAD_LEASE_SECONDS} || ' seconds')::INTERVAL,
           updated_at = NOW()
     WHERE id = ${uploadId}
       AND origin = 'zoom_copy'
       AND intent_expires_at > NOW()
       AND (
         (state = 'uploaded' AND candidate_item_id IS NOT NULL AND (lease_token IS NULL OR lease_expires_at <= NOW()))
         OR (state = 'finalizing' AND candidate_item_id IS NOT NULL AND (lease_token IS NULL OR lease_expires_at <= NOW()))
       )
     RETURNING *
  `;
  return result.rows[0] ? { row: result.rows[0], leaseToken } : null;
}

/**
 * I4. Receipt-inspection lease: a read/receipt lease for an expired intent, a failed linked copy, or a
 * non-staff abandonment. Changes neither state nor expiry. Never permission to pump, create or delete.
 */
export async function claimZoomCopyIntentReceiptInspection({ uploadId }) {
  const leaseToken = crypto.randomUUID();
  const result = await sql`
    UPDATE presentation_material_uploads u
       SET lease_token = ${leaseToken},
           lease_expires_at = NOW() + (${PRESENTATION_UPLOAD_LEASE_SECONDS} || ' seconds')::INTERVAL,
           updated_at = NOW()
     WHERE u.id = ${uploadId}
       AND u.origin = 'zoom_copy'
       AND u.state IN ('initiated', 'uploaded', 'finalizing', 'failed', 'abandoned')
       AND (u.lease_token IS NULL OR u.lease_expires_at <= NOW())
       AND (
         u.intent_expires_at <= NOW()
         OR EXISTS (SELECT 1 FROM zoom_video_copies c WHERE c.upload_id = u.id AND c.state = 'failed')
         OR (u.state = 'abandoned' AND u.last_error IS DISTINCT FROM 'staff_cancelled')
       )
     RETURNING *
  `;
  return result.rows[0] ? { row: result.rows[0], leaseToken } : null;
}

/** I4 renew: same live token and origin; deliberately no unexpired-intent predicate. */
export async function renewZoomCopyIntentReceiptInspection({ uploadId, leaseToken }) {
  const result = await sql`
    UPDATE presentation_material_uploads
       SET lease_expires_at = NOW() + (${PRESENTATION_UPLOAD_LEASE_SECONDS} || ' seconds')::INTERVAL,
           updated_at = NOW()
     WHERE id = ${uploadId}
       AND origin = 'zoom_copy'
       AND lease_token = ${leaseToken}
       AND lease_expires_at > NOW()
       AND state IN ('initiated', 'uploaded', 'finalizing', 'failed', 'abandoned')
     RETURNING *
  `;
  return result.rows[0] || null;
}

/** I4 release: token-keyed; clears the lease without touching state, expiry or error. */
export async function releaseZoomCopyIntentReceiptInspection({ uploadId, leaseToken }) {
  const result = await sql`
    UPDATE presentation_material_uploads
       SET lease_token = NULL,
           lease_expires_at = NULL,
           updated_at = NOW()
     WHERE id = ${uploadId}
       AND origin = 'zoom_copy'
       AND lease_token = ${leaseToken}
     RETURNING *
  `;
  return result.rows[0] || null;
}

/**
 * Source-failure abandonment: `cancelPresentationMaterialUploadRecovery`'s predicates with the source's
 * failure code in place of the staff-cancel marker. `staff_cancelled` is never accepted here.
 */
export async function abandonZoomCopyIntentForSourceFailure({ uploadId, leaseToken, failureCode }) {
  const code = sanitizeFailureCode(failureCode);
  if (code === 'staff_cancelled') throw new TypeError('A source failure never uses the staff cancellation marker.');
  const result = await sql`
    UPDATE presentation_material_uploads
       SET state = 'abandoned',
           upload_url_ciphertext = NULL,
           lease_token = NULL,
           lease_expires_at = NULL,
           last_error = ${code},
           updated_at = NOW()
     WHERE id = ${uploadId}
       AND origin = 'zoom_copy'
       AND lease_token = ${leaseToken}
       AND lease_expires_at > NOW()
       AND state IN ('initiated', 'failed')
       AND candidate_item_id IS NULL
       AND request_document_id IS NULL
     RETURNING *
  `;
  return result.rows[0] || null;
}

/**
 * I5. Bind a verified, exactly-registered Request Document to its intent without any Graph or Dataverse write.
 * One transaction, copy row locked first then intent. `expected` is the inspected intent (state, candidate item,
 * generation key, last_error); `verified` is the exact registration read (candidate descriptor and document id).
 * Writes nothing and returns `{ bound: false, reason }` when any recheck fails.
 */
export async function bindZoomCopyRegisteredReceipt({
  copyId, inspectionLeaseToken, copyLeaseToken = null, expected, verified,
}) {
  const c = verified?.candidate;
  if (!verified?.requestDocumentId || !c?.siteId || !c?.driveId || !c?.itemId || !c?.versionId || !c?.eTag || !Number.isSafeInteger(c?.size)) {
    throw new TypeError('A verified candidate and request document id are required.');
  }
  const client = await db.connect();
  let failed = null;
  try {
    await client.query('BEGIN');
    const outcome = await bindReceiptInTransaction(client, { copyId, inspectionLeaseToken, copyLeaseToken, expected, verified });
    await client.query(outcome.bound ? 'COMMIT' : 'ROLLBACK');
    return outcome;
  } catch (error) {
    failed = error;
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    if (failed) client.release(failed); else client.release();
  }
}

async function bindReceiptInTransaction(client, { copyId, inspectionLeaseToken, copyLeaseToken, expected, verified }) {
  const reject = reason => ({ bound: false, reason });
  const c = verified.candidate;
  const copy = (await client.query(
    `SELECT id, upload_id, request_id, state, lease_token,
            (lease_token IS NOT NULL AND lease_expires_at > NOW()) AS lease_live
       FROM zoom_video_copies WHERE id = $1 FOR UPDATE`,
    [copyId],
  )).rows[0];
  if (!copy) return reject('copy_missing');
  const row = (await client.query(
    `SELECT *, (lease_token IS NOT NULL AND lease_expires_at > NOW()) AS lease_live
       FROM presentation_material_uploads WHERE id = $1 FOR UPDATE`,
    [copy.upload_id],
  )).rows[0];
  if (!row) return reject('intent_missing');
  if (row.id !== copy.id || row.origin !== 'zoom_copy' || row.request_id !== copy.request_id) return reject('link_mismatch');
  if (!(row.lease_live && row.lease_token === inspectionLeaseToken)) return reject('inspection_lease_lost');
  if (!INSPECTABLE_STATES.includes(row.state) || row.state !== expected?.state
    || row.generation_key !== expected?.generationKey
    || (row.candidate_item_id ?? null) !== (expected?.candidateItemId ?? null)
    || (row.last_error ?? null) !== (expected?.lastError ?? null)) return reject('intent_changed');
  if (row.state === 'failed' && row.candidate_item_id) return reject('rejected_candidate');
  if (row.state === 'abandoned' && (row.last_error === 'staff_cancelled' || row.request_document_id)) return reject('abandonment_not_bindable');
  if (row.candidate_item_id && (row.candidate_drive_id !== c.driveId || row.candidate_item_id !== c.itemId
    || Number(row.candidate_size) !== c.size)) return reject('candidate_mismatch');
  if (Number(row.declared_size) !== c.size) return reject('size_mismatch');
  if (['queued', 'copying', 'registering'].includes(copy.state)) {
    if (!copyLeaseToken || !(copy.lease_live && copy.lease_token === copyLeaseToken)) return reject('copy_lease_lost');
  } else if (copy.state === 'failed') {
    if (copy.lease_live) return reject('copy_lease_live');
  } else return reject('copy_state_invalid');
  const bound = (await client.query(
    `UPDATE presentation_material_uploads
        SET state = 'finalized', request_document_id = $2,
            candidate_site_id = $3, candidate_drive_id = $4, candidate_item_id = $5,
            candidate_version_id = $6, candidate_etag = $7, candidate_size = $8,
            finalized_at = COALESCE(finalized_at, NOW()), upload_url_ciphertext = NULL,
            lease_token = NULL, lease_expires_at = NULL, last_error = NULL, updated_at = NOW()
      WHERE id = $1 AND origin = 'zoom_copy' AND lease_token = $9 AND lease_expires_at > NOW()
     RETURNING *`,
    [row.id, verified.requestDocumentId, c.siteId, c.driveId, c.itemId, c.versionId, c.eTag, c.size, inspectionLeaseToken],
  )).rows[0];
  return bound ? { bound: true, row: bound } : reject('bind_failed');
}
