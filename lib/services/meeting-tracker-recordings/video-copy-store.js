/**
 * Postgres persistence for zoom_video_copies (migration 076; plan
 * docs/plans/ZOOM_VIDEO_SHAREPOINT_COPY_PLAN_2026-10-08.md, "NEW store functions" and Build rulings 4-6).
 * Parameterized SQL only; no Zoom, Graph, Blob or Dataverse I/O happens here. The store holds identifiers
 * and lifecycle state only, never URLs, tokens, topics or emails.
 *
 * Every transition writer is one named function with its own predicate (no generic column patch). Each
 * active-state writer matches the copy lease holder (`lease_token = $t AND lease_expires_at > NOW()`), so a
 * dead tick can never write after a takeover. A counter that reaches its cap and the move to `failed` happen
 * in one UPDATE, so no statement can increment past the table CHECK. Intent-row writers live in
 * post-presentation-materials/upload-intent-store.js.
 *
 * `createZoomVideoCopyStore(database)` takes a `{ query, transaction }` adapter so a real-Postgres proof can
 * inject its own connection; the named exports are bound to the app pool.
 */
import crypto from 'node:crypto';
import { db, sql } from '@vercel/postgres';
import { REQUEST_DOCUMENT_ARTIFACT_TYPE } from '../../../shared/config/requestDocument.js';
import { POST_PRESENTATION_MP4_CONTENT_TYPE } from '../../utils/post-presentation-mp4-file.js';
import { PRESENTATION_UPLOAD_REVIEW_GRACE_MS } from '../post-presentation-materials/upload-intent-store.js';
import { _internal as materialInternals } from '../post-presentation-materials/material-service.js';
import { sanitizeFailureCode } from './import-store.js';

// Must exceed the copy tick's 300 s maxDuration so a live tick is never taken over.
export const ZOOM_VIDEO_COPY_LEASE_SECONDS = 600;
// CHECK caps on zoom_video_copies counters (migration 076).
export const SESSION_CREATE_ATTEMPT_CAP = 3;
export const SESSION_RESTART_CAP = 3;
export const UNCERTAIN_CHECK_CAP = 3;
export const REGISTRATION_ATTEMPT_CAP = 5;
// Backoff after registration attempt 1..4 (plan, Retry policy): 1, 5, 15, 60 minutes. Attempt 5 fails.
const REGISTRATION_BACKOFF_SECONDS = [60, 300, 900, 3600];
// Failure codes written when the shared uncertain_checks counter reaches its cap, by caller context.
export const UNCERTAIN_CAP_FAILURE_CODES = Object.freeze([
  'zoom_video_session_uncertain', 'zoom_video_cancel_uncertain', 'zoom_video_upload_uncertain',
]);
export const COPY_ACTIVE_STATES = Object.freeze(['queued', 'copying', 'registering']);
const COPIED_FILE_INDEX = 'idx_zoom_video_copies_copied_file';
const UNIQUE_VIOLATION = '23505';
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_HEX = /^[0-9a-f]{64}$/;

/** Ruling 12: sha256(trim(lowercase(email))), matching `readZoomImportConfig`'s normalization. */
export function hashZoomHostEmail(email) {
  return crypto.createHash('sha256').update(String(email ?? '').trim().toLowerCase()).digest('hex');
}

/** Plan "Intent row written by N1": sha256("zoom-copy:" + meetingUuid + ":" + fileId + ":" + size). */
export function zoomCopyResumeFingerprint({ meetingUuid, fileId, size }) {
  return crypto.createHash('sha256').update(`zoom-copy:${meetingUuid}:${fileId}:${size}`).digest('hex');
}

const requestLockKey = requestId => `zoom_video_copy:${String(requestId).toLowerCase()}:${REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING}`;

function assertGuid(value, label) {
  if (typeof value !== 'string' || !GUID.test(value)) throw new TypeError(`${label} must be a GUID.`);
  return value;
}

// Everything on the row except the copy lease token (the snapshot is read by GET as well as by ticks).
const COPY_COLUMNS = `c.id, c.upload_id, c.request_id, c.site_visit_activity_id, c.actor_profile_id, c.zoom_meeting_uuid,
  c.zoom_host_id, c.zoom_host_email_sha256, c.zoom_meeting_start, c.zoom_file_id, c.zoom_recording_type, c.declared_size,
  c.confirmed_winner_document_id, c.confirmed_winner_slot_version, c.state, c.lease_expires_at, c.next_attempt_at,
  c.bytes_confirmed, c.session_create_attempts, c.session_restarts, c.uncertain_checks, c.registration_attempts,
  c.cancel_requested_at, c.request_document_id, c.sharepoint_drive_id, c.sharepoint_item_id, c.sharepoint_quickxor_hash,
  c.failure_code, c.created_at, c.updated_at, c.completed_at,
  (c.lease_token IS NOT NULL AND c.lease_expires_at > NOW()) AS lease_live`;
// The intent half never carries the Graph upload URL (only whether one is recorded) or the intent lease token.
const INTENT_COLUMNS = `u.state AS intent_state, u.origin AS intent_origin, u.last_error AS intent_last_error,
  (u.upload_url_ciphertext IS NOT NULL) AS intent_has_ciphertext, u.upload_session_expires_at AS intent_session_expires_at,
  u.intent_expires_at, (u.intent_expires_at <= NOW()) AS intent_expired,
  (u.lease_token IS NOT NULL AND u.lease_expires_at > NOW()) AS intent_lease_live,
  u.candidate_site_id, u.candidate_drive_id, u.candidate_item_id, u.candidate_version_id, u.candidate_etag, u.candidate_size,
  u.request_document_id AS intent_request_document_id, u.generation_key, u.physical_filename, u.library_name, u.folder_path,
  u.updated_at AS intent_updated_at`;
const SNAPSHOT_FROM = 'FROM zoom_video_copies c JOIN presentation_material_uploads u ON u.id = c.upload_id';

/** Adapter over the app pool, same shape as the transcription store's. */
function vercelPostgresAdapter() {
  return {
    query(text, params = []) { return sql.query(text, params); },
    async transaction(fn) {
      const client = await db.connect();
      let failed = null;
      try {
        await client.query('BEGIN');
        const result = await fn({ query: (text, params = []) => client.query(text, params) });
        await client.query('COMMIT');
        return result;
      } catch (error) {
        failed = error;
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        if (failed) client.release(failed); else client.release();
      }
    },
  };
}

const oneOrNull = result => result.rows[0] || null;
const retryAfter = seconds => {
  if (seconds == null) return null;
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > 86_400) throw new TypeError('retryAfterSeconds must be an integer from 0 to 86400.');
  return seconds;
};

export function createZoomVideoCopyStore(database, { mp4GenerationIdentity = materialInternals.mp4GenerationIdentity } = {}) {
  if (!database || typeof database.query !== 'function' || typeof database.transaction !== 'function') {
    throw new TypeError('A query/transaction database adapter is required.');
  }

  /**
   * N1. One transaction: request advisory lock; Try-again snapshot recheck (ruling 5); copied-file replay
   * (ruling 6, before the active check); active-request check; intent insert; copy insert (same id).
   * Outcomes: started | replayed | active | reconciliation_pending | in_progress (a unique-index violation
   * on the path, generation key or active-request index: rolled back, nothing written).
   * All remote reads happen before this call; only Postgres statements run inside.
   */
  async function startZoomVideoCopy(input) {
    const {
      copyId = crypto.randomUUID(), requestId, requestNum, siteVisitActivityId, actorProfileId, actorSystemId,
      zoomMeetingUuid, zoomHostId, zoomHostEmail, zoomMeetingStart, zoomFileId, zoomRecordingType, declaredSize,
      originalDisplayFilename, libraryName, folderPath,
      confirmedWinnerDocumentId = null, confirmedWinnerSlotVersion = null,
      failedSnapshot = [], now = new Date(),
    } = input;
    assertGuid(copyId, 'copyId');
    assertGuid(requestId, 'requestId');
    assertGuid(siteVisitActivityId, 'siteVisitActivityId');
    assertGuid(actorSystemId, 'actorSystemId');
    if ((confirmedWinnerDocumentId == null) !== (confirmedWinnerSlotVersion == null)) {
      throw new TypeError('The confirmed winner id and slot version are set together or not at all.');
    }
    const hostEmailSha256 = hashZoomHostEmail(zoomHostEmail);
    const fingerprint = zoomCopyResumeFingerprint({ meetingUuid: zoomMeetingUuid, fileId: zoomFileId, size: declaredSize });
    const { physicalFilename, generationKey } = mp4GenerationIdentity({
      requestId, requestNum, operationId: copyId, resumeFingerprint: fingerprint,
    });
    const intentExpiresAt = new Date(now.getTime() + PRESENTATION_UPLOAD_REVIEW_GRACE_MS).toISOString();
    try {
      return await database.transaction(async tx => {
        await tx.query('SELECT pg_advisory_xact_lock(hashtext($1), 0)', [requestLockKey(requestId)]);
        // Rows that already failed for this request and file: the caller inspected them before BEGIN.
        const failed = (await tx.query(
          `SELECT c.id, c.updated_at::text AS updated_key, u.state AS intent_state,
                  (u.lease_token IS NOT NULL AND u.lease_expires_at > NOW()) AS intent_lease_live
             FROM zoom_video_copies c JOIN presentation_material_uploads u ON u.id = c.upload_id
            WHERE c.request_id = $1 AND c.zoom_file_id = $2 AND c.state = 'failed'`,
          [requestId, zoomFileId],
        )).rows;
        const seen = new Map((failedSnapshot || []).map(row => [row.id, row]));
        const changed = failed.some(row => {
          const before = seen.get(row.id);
          return !before || before.updated_key !== row.updated_key || before.intent_state !== row.intent_state
            || row.intent_lease_live || row.intent_state === 'finalized';
        });
        const replay = oneOrNull(await tx.query(
          `SELECT * FROM zoom_video_copies WHERE request_id = $1 AND zoom_file_id = $2 AND state = 'copied'`,
          [requestId, zoomFileId],
        ));
        if (replay) return { status: 'replayed', copy: replay };
        const active = oneOrNull(await tx.query(
          `SELECT id FROM zoom_video_copies WHERE request_id = $1 AND state IN ('queued', 'copying', 'registering')`,
          [requestId],
        ));
        if (active) return { status: 'active', copy: active };
        if (changed) return { status: 'reconciliation_pending', copy: null };
        const intent = oneOrNull(await tx.query(
          `INSERT INTO presentation_material_uploads (
             id, request_id, site_visit_id, actor_id, artifact_type, original_display_filename, validated_mime_type,
             declared_size, client_resume_fingerprint, library_name, folder_path, physical_filename, generation_key,
             state, intent_expires_at, origin
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'initiated', $14, 'zoom_copy')
           RETURNING *`,
          [copyId, requestId, siteVisitActivityId, actorSystemId, REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING,
            originalDisplayFilename, POST_PRESENTATION_MP4_CONTENT_TYPE, declaredSize, fingerprint, libraryName,
            folderPath, physicalFilename, generationKey, intentExpiresAt],
        ));
        const copy = oneOrNull(await tx.query(
          `INSERT INTO zoom_video_copies (
             id, upload_id, request_id, site_visit_activity_id, actor_profile_id, zoom_meeting_uuid, zoom_host_id,
             zoom_host_email_sha256, zoom_meeting_start, zoom_file_id, zoom_recording_type, declared_size,
             confirmed_winner_document_id, confirmed_winner_slot_version, state
           ) VALUES ($1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'queued')
           RETURNING *`,
          [copyId, requestId, siteVisitActivityId, actorProfileId, zoomMeetingUuid, zoomHostId, hostEmailSha256,
            zoomMeetingStart, zoomFileId, zoomRecordingType, declaredSize, confirmedWinnerDocumentId,
            confirmedWinnerSlotVersion],
        ));
        return { status: 'started', copy, intent };
      });
    } catch (error) {
      if (error?.code === UNIQUE_VIOLATION) return { status: 'in_progress', copy: null };
      throw error;
    }
  }

  /** Try again's pre-transaction inspection input (and N1's snapshot shape): failed rows for a request and file. */
  async function listFailedZoomVideoCopiesForFile({ requestId, zoomFileId }) {
    return (await database.query(
      `SELECT c.id, c.updated_at::text AS updated_key, u.state AS intent_state,
              (u.lease_token IS NOT NULL AND u.lease_expires_at > NOW()) AS intent_lease_live
         FROM zoom_video_copies c JOIN presentation_material_uploads u ON u.id = c.upload_id
        WHERE c.request_id = $1 AND c.zoom_file_id = $2 AND c.state = 'failed'
        ORDER BY c.created_at`,
      [assertGuid(requestId, 'requestId'), zoomFileId],
    )).rows;
  }

  /** The copied row for this request and file (the unique copied-file index makes it at most one), for replay before confirmation. */
  async function findCopiedZoomVideoCopyForFile({ requestId, zoomFileId }) {
    return oneOrNull(await database.query(
      `SELECT id, zoom_meeting_uuid, state FROM zoom_video_copies WHERE request_id = $1 AND zoom_file_id = $2 AND state = 'copied'`,
      [assertGuid(requestId, 'requestId'), zoomFileId],
    ));
  }

  /** Joined copy + intent snapshot for dispatch (one row). Carries no lease tokens and no Graph URL. */
  async function getZoomVideoCopySnapshot({ id }) {
    return oneOrNull(await database.query(
      `SELECT ${COPY_COLUMNS}, ${INTENT_COLUMNS} ${SNAPSHOT_FROM} WHERE c.id = $1`, [assertGuid(id, 'id')],
    ));
  }

  /** The same join for GET: a request's most recent copies. */
  async function listZoomVideoCopySnapshotsForRequest({ requestId, limit = 5 }) {
    return (await database.query(
      `SELECT ${COPY_COLUMNS}, ${INTENT_COLUMNS} ${SNAPSHOT_FROM}
        WHERE c.request_id = $1 ORDER BY c.created_at DESC LIMIT $2`,
      [assertGuid(requestId, 'requestId'), Math.min(Math.max(Number(limit) | 0, 1), 20)],
    )).rows;
  }

  /** N2. Claim the next due active row. Returns { row, leaseToken } or null. */
  async function claimZoomVideoCopyWork({ accessRequestId = null } = {}) {
    const leaseToken = crypto.randomUUID();
    const result = await database.query(
      `WITH next AS (
         SELECT id FROM zoom_video_copies
          WHERE state IN ('queued', 'copying', 'registering')
            AND (lease_token IS NULL OR lease_expires_at <= NOW())
            AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
            AND ($2::uuid IS NULL OR request_id = $2::uuid)
          ORDER BY updated_at
          LIMIT 1
          FOR UPDATE SKIP LOCKED
       )
       UPDATE zoom_video_copies c
          SET lease_token = $1, lease_expires_at = NOW() + ($3 || ' seconds')::INTERVAL, updated_at = NOW()
         FROM next WHERE c.id = next.id
       RETURNING c.*`,
      [leaseToken, accessRequestId, ZOOM_VIDEO_COPY_LEASE_SECONDS],
    );
    const row = oneOrNull(result);
    return row ? { row, leaseToken } : null;
  }

  /** N3. Renew the copy lease; the row's state and cancel flag drive the caller's fence. */
  async function renewZoomVideoCopyLease({ id, leaseToken, states }) {
    return oneOrNull(await database.query(
      `UPDATE zoom_video_copies
          SET lease_expires_at = NOW() + ($3 || ' seconds')::INTERVAL, updated_at = NOW()
        WHERE id = $1 AND lease_token = $2 AND lease_expires_at > NOW() AND state = ANY($4::text[])
       RETURNING state, cancel_requested_at`,
      [id, leaseToken, ZOOM_VIDEO_COPY_LEASE_SECONDS, states],
    ));
  }

  /** N7. Release the copy lease without a state change. */
  async function releaseZoomVideoCopyLease({ id, leaseToken }) {
    return oneOrNull(await database.query(
      `UPDATE zoom_video_copies
          SET lease_token = NULL, lease_expires_at = NULL, updated_at = NOW()
        WHERE id = $1 AND lease_token = $2
       RETURNING *`,
      [id, leaseToken],
    ));
  }

  // --- N4, split per state-table write (ruling 5) -------------------------------------------------------

  /** queued -> copying after the session receipt (I2) is recorded. */
  async function markZoomVideoCopyCopying({ id, leaseToken }) {
    return oneOrNull(await database.query(
      `UPDATE zoom_video_copies SET state = 'copying', updated_at = NOW()
        WHERE id = $1 AND lease_token = $2 AND lease_expires_at > NOW() AND state = 'queued'
       RETURNING *`,
      [id, leaseToken],
    ));
  }

  /** copying -> copying: confirmed bytes (advisory; Graph's offset is authoritative). */
  async function recordZoomVideoCopyProgress({ id, leaseToken, bytesConfirmed }) {
    if (!Number.isSafeInteger(bytesConfirmed) || bytesConfirmed < 0) throw new TypeError('bytesConfirmed must be a non-negative integer.');
    return oneOrNull(await database.query(
      `UPDATE zoom_video_copies SET bytes_confirmed = LEAST($3::bigint, declared_size), updated_at = NOW()
        WHERE id = $1 AND lease_token = $2 AND lease_expires_at > NOW() AND state = 'copying'
       RETURNING *`,
      [id, leaseToken, bytesConfirmed],
    ));
  }

  /**
   * queued -> queued: a confirmed session-create or I2 failure. The attempt counter and the cap failure are one
   * UPDATE; reaching 3 attempts moves the row to failed/zoom_video_session_create_failed.
   */
  async function recordZoomVideoCopySessionCreateFailure({ id, leaseToken, retryAfterSeconds = null }) {
    return oneOrNull(await database.query(
      `UPDATE zoom_video_copies
          SET session_create_attempts = LEAST(session_create_attempts + 1, $4::int),
              state = CASE WHEN session_create_attempts + 1 >= $4::int THEN 'failed' ELSE state END,
              failure_code = CASE WHEN session_create_attempts + 1 >= $4::int THEN 'zoom_video_session_create_failed' END,
              lease_token = CASE WHEN session_create_attempts + 1 >= $4::int THEN NULL ELSE lease_token END,
              lease_expires_at = CASE WHEN session_create_attempts + 1 >= $4::int THEN NULL ELSE lease_expires_at END,
              next_attempt_at = CASE WHEN session_create_attempts + 1 >= $4::int THEN NULL
                                     ELSE NOW() + COALESCE($3::int, 0) * INTERVAL '1 second' END,
              updated_at = NOW()
        WHERE id = $1 AND lease_token = $2 AND lease_expires_at > NOW() AND state = 'queued'
       RETURNING *`,
      [id, leaseToken, retryAfter(retryAfterSeconds), SESSION_CREATE_ATTEMPT_CAP],
    ));
  }

  /**
   * queued|copying -> same state: a proven-lost session (410, every path check absent) restarts at byte 0.
   * Reaching 3 restarts moves the row to failed/zoom_video_session_expired in the same UPDATE.
   */
  async function recordZoomVideoCopySessionRestart({ id, leaseToken }) {
    return oneOrNull(await database.query(
      `UPDATE zoom_video_copies
          SET session_restarts = LEAST(session_restarts + 1, $3::int),
              bytes_confirmed = 0,
              state = CASE WHEN session_restarts + 1 >= $3::int THEN 'failed' ELSE state END,
              failure_code = CASE WHEN session_restarts + 1 >= $3::int THEN 'zoom_video_session_expired' END,
              lease_token = CASE WHEN session_restarts + 1 >= $3::int THEN NULL ELSE lease_token END,
              lease_expires_at = CASE WHEN session_restarts + 1 >= $3::int THEN NULL ELSE lease_expires_at END,
              next_attempt_at = CASE WHEN session_restarts + 1 >= $3::int THEN NULL ELSE next_attempt_at END,
              updated_at = NOW()
        WHERE id = $1 AND lease_token = $2 AND lease_expires_at > NOW() AND state IN ('queued', 'copying')
       RETURNING *`,
      [id, leaseToken, SESSION_RESTART_CAP],
    ));
  }

  /**
   * queued|copying -> same state: an uncertain path/status/cancel check (404, partial item, absent after the last
   * chunk). The counter is shared; `capFailureCode` names the failure written when it reaches 3.
   */
  async function recordZoomVideoCopyUncertainCheck({ id, leaseToken, retryAfterSeconds, capFailureCode }) {
    if (!UNCERTAIN_CAP_FAILURE_CODES.includes(capFailureCode)) throw new TypeError('capFailureCode is not an uncertain-check failure code.');
    return oneOrNull(await database.query(
      `UPDATE zoom_video_copies
          SET uncertain_checks = LEAST(uncertain_checks + 1, $5::int),
              state = CASE WHEN uncertain_checks + 1 >= $5::int THEN 'failed' ELSE state END,
              failure_code = CASE WHEN uncertain_checks + 1 >= $5::int THEN $4::text END,
              lease_token = CASE WHEN uncertain_checks + 1 >= $5::int THEN NULL ELSE lease_token END,
              lease_expires_at = CASE WHEN uncertain_checks + 1 >= $5::int THEN NULL ELSE lease_expires_at END,
              next_attempt_at = CASE WHEN uncertain_checks + 1 >= $5::int THEN NULL
                                     ELSE NOW() + COALESCE($3::int, 0) * INTERVAL '1 second' END,
              updated_at = NOW()
        WHERE id = $1 AND lease_token = $2 AND lease_expires_at > NOW() AND state IN ('queued', 'copying')
       RETURNING *`,
      [id, leaseToken, retryAfter(retryAfterSeconds ?? 0), capFailureCode, UNCERTAIN_CHECK_CAP],
    ));
  }

  /** queued|copying -> registering: the full item resolved; drive and item are recorded on the copy row. */
  async function markZoomVideoCopyRegistering({ id, leaseToken, driveId, itemId }) {
    if (!driveId || !itemId) throw new TypeError('driveId and itemId are required.');
    return oneOrNull(await database.query(
      `UPDATE zoom_video_copies
          SET state = 'registering', sharepoint_drive_id = $3, sharepoint_item_id = $4,
              bytes_confirmed = declared_size, next_attempt_at = NULL, updated_at = NOW()
        WHERE id = $1 AND lease_token = $2 AND lease_expires_at > NOW() AND state IN ('queued', 'copying')
       RETURNING *`,
      [id, leaseToken, driveId, itemId],
    ));
  }

  /**
   * registering -> registering: a retryable finalize error. Backoff 1, 5, 15, 60 min and the lease cleared; the
   * fifth attempt moves the row to failed/zoom_video_registration_failed in the same UPDATE.
   */
  async function deferZoomVideoCopyRegistration({ id, leaseToken }) {
    return oneOrNull(await database.query(
      `UPDATE zoom_video_copies
          SET registration_attempts = LEAST(registration_attempts + 1, $3::int),
              state = CASE WHEN registration_attempts + 1 >= $3::int THEN 'failed' ELSE state END,
              failure_code = CASE WHEN registration_attempts + 1 >= $3::int THEN 'zoom_video_registration_failed' END,
              next_attempt_at = CASE WHEN registration_attempts + 1 >= $3::int THEN NULL
                ELSE NOW() + ($4::int[])[registration_attempts + 1] * INTERVAL '1 second' END,
              lease_token = NULL, lease_expires_at = NULL, updated_at = NOW()
        WHERE id = $1 AND lease_token = $2 AND lease_expires_at > NOW() AND state = 'registering'
       RETURNING *`,
      [id, leaseToken, REGISTRATION_ATTEMPT_CAP, REGISTRATION_BACKOFF_SECONDS],
    ));
  }

  /** queued|copying|registering -> failed with a sanitized code (terminal); clears the lease. */
  async function failZoomVideoCopy({ id, leaseToken, failureCode }) {
    return oneOrNull(await database.query(
      `UPDATE zoom_video_copies
          SET state = 'failed', failure_code = $3, next_attempt_at = NULL,
              lease_token = NULL, lease_expires_at = NULL, updated_at = NOW()
        WHERE id = $1 AND lease_token = $2 AND lease_expires_at > NOW() AND state IN ('queued', 'copying', 'registering')
       RETURNING *`,
      [id, leaseToken, sanitizeFailureCode(failureCode)],
    ));
  }

  /**
   * queued|copying|registering -> cancelled; clears the lease. When bytes were complete, the caller passes the
   * item identity (both or neither) so unregistered bytes stay findable.
   */
  async function cancelZoomVideoCopy({ id, leaseToken, driveId = null, itemId = null }) {
    if ((driveId == null) !== (itemId == null)) throw new TypeError('driveId and itemId are set together or not at all.');
    return oneOrNull(await database.query(
      `UPDATE zoom_video_copies
          SET state = 'cancelled', sharepoint_drive_id = COALESCE($3, sharepoint_drive_id),
              sharepoint_item_id = COALESCE($4, sharepoint_item_id), next_attempt_at = NULL,
              lease_token = NULL, lease_expires_at = NULL, updated_at = NOW()
        WHERE id = $1 AND lease_token = $2 AND lease_expires_at > NOW() AND state IN ('queued', 'copying', 'registering')
       RETURNING *`,
      [id, leaseToken, driveId, itemId],
    ));
  }

  /**
   * N5. Receipt repair: copy -> copied from a finalized linked intent. With a token the caller's live lease must
   * match (Q/C/R); with null the copy lease must be free or expired (any active row or failed). Runs under the
   * request advisory lock, like N1's failed-row recheck. A copied-file uniqueness conflict throws
   * `zoom_video_receipt_conflict` (the finalized intent is retained; the caller alerts).
   */
  async function markZoomVideoCopyCopied({ id, leaseToken = null }) {
    try {
      return await database.transaction(async tx => {
        await tx.query(
          `SELECT pg_advisory_xact_lock(hashtext('zoom_video_copy:' || request_id::text || ':${REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING}'), 0)
             FROM zoom_video_copies WHERE id = $1`,
          [id],
        );
        return oneOrNull(await tx.query(
          `UPDATE zoom_video_copies c
              SET state = 'copied', request_document_id = u.request_document_id,
                  sharepoint_drive_id = u.candidate_drive_id, sharepoint_item_id = u.candidate_item_id,
                  completed_at = NOW(), failure_code = NULL, next_attempt_at = NULL,
                  lease_token = NULL, lease_expires_at = NULL, updated_at = NOW()
             FROM presentation_material_uploads u
            WHERE c.id = $1 AND u.id = c.upload_id AND u.state = 'finalized'
              AND c.state IN ('queued', 'copying', 'registering', 'failed')
              AND (($2::uuid IS NOT NULL AND c.lease_token = $2::uuid AND c.lease_expires_at > NOW())
                OR ($2::uuid IS NULL AND (c.lease_token IS NULL OR c.lease_expires_at <= NOW())))
           RETURNING c.*`,
          [id, leaseToken],
        ));
      });
    } catch (error) {
      if (error?.code === UNIQUE_VIOLATION && error.constraint === COPIED_FILE_INDEX) {
        const conflict = new Error('Another copied row already owns this request and Zoom file.');
        conflict.code = 'zoom_video_receipt_conflict';
        throw conflict;
      }
      throw error;
    }
  }

  /** N5a. Rows whose linked intent is finalized and whose copy is not copied, with a free or expired copy lease. */
  async function listZoomVideoCopiesWithFinalizedIntent({ limit = 10 } = {}) {
    return (await database.query(
      `SELECT c.id FROM zoom_video_copies c JOIN presentation_material_uploads u ON u.id = c.upload_id
        WHERE c.state IN ('queued', 'copying', 'registering', 'failed') AND u.state = 'finalized'
          AND (c.lease_token IS NULL OR c.lease_expires_at <= NOW())
        ORDER BY c.updated_at LIMIT $1`,
      [Math.min(Math.max(Number(limit) | 0, 1), 50)],
    )).rows;
  }

  /**
   * N6. Staff cancel request: set the flag on a queued or copying row. Outcomes: requested | saving (registering,
   * 409 zoom_video_copy_saving) | terminal (copied/failed/cancelled, returned as is) | not_found.
   */
  async function requestZoomVideoCopyCancel({ id, requestId }) {
    const updated = oneOrNull(await database.query(
      `UPDATE zoom_video_copies
          SET cancel_requested_at = COALESCE(cancel_requested_at, NOW()), updated_at = NOW()
        WHERE id = $1 AND request_id = $2 AND state IN ('queued', 'copying')
       RETURNING *`,
      [id, requestId],
    ));
    if (updated) return { outcome: 'requested', row: updated };
    const row = oneOrNull(await database.query(
      'SELECT * FROM zoom_video_copies WHERE id = $1 AND request_id = $2', [id, requestId],
    ));
    if (!row) return { outcome: 'not_found', row: null };
    return { outcome: row.state === 'registering' ? 'saving' : 'terminal', row };
  }

  /**
   * Ruling 21. Release the copy lease and push the next attempt out, with no counter and no state change: a Zoom
   * configuration fault (auth or scope) is not the copy's fault. Active rows only; the lease must be live.
   */
  async function deferZoomVideoCopyAttempt({ id, leaseToken, retryAfterSeconds }) {
    if (retryAfter(retryAfterSeconds) == null) throw new TypeError('retryAfterSeconds is required.');
    return oneOrNull(await database.query(
      `UPDATE zoom_video_copies
          SET next_attempt_at = NOW() + $3::int * INTERVAL '1 second',
              lease_token = NULL, lease_expires_at = NULL, updated_at = NOW()
        WHERE id = $1 AND lease_token = $2 AND lease_expires_at > NOW() AND state IN ('queued', 'copying', 'registering')
       RETURNING *`,
      [id, leaseToken, retryAfterSeconds],
    ));
  }

  /**
   * Failed-copy due batch (ruling 5, narrowed by ruling 16). Selects failed rows whose next_attempt_at is due and
   * whose linked intent is unsettled (not finalized, which N5a repairs, and not abandoned), younger than the
   * 30-day backstop on the copy's updated_at, and advances next_attempt_at by `deferSeconds` in the same
   * statement, keyed on state = 'failed' (the row lock holds the previously read value). It never touches
   * updated_at, so the backstop is not renewed by its own inspections. Takes no copy lease, since terminal rows
   * are unleased. The I4 lease sits on the intent row.
   */
  async function claimFailedZoomVideoCopiesDue({ limit = 5, deferSeconds = 600, accessRequestId = null } = {}) {
    return (await database.query(
      `WITH due AS (
         SELECT c.id FROM zoom_video_copies c JOIN presentation_material_uploads u ON u.id = c.upload_id
          WHERE c.state = 'failed' AND (c.next_attempt_at IS NULL OR c.next_attempt_at <= NOW())
            AND u.state NOT IN ('finalized', 'abandoned')
            AND c.updated_at > NOW() - INTERVAL '30 days'
            AND ($3::uuid IS NULL OR c.request_id = $3::uuid)
          ORDER BY COALESCE(c.next_attempt_at, c.updated_at)
          LIMIT $1
          FOR UPDATE OF c SKIP LOCKED
       )
       UPDATE zoom_video_copies c
          SET next_attempt_at = NOW() + $2::int * INTERVAL '1 second'
         FROM due WHERE c.id = due.id AND c.state = 'failed'
       RETURNING c.id, c.request_id, c.upload_id, c.failure_code`,
      [Math.min(Math.max(Number(limit) | 0, 1), 20), retryAfter(deferSeconds), accessRequestId],
    )).rows;
  }

  return {
    startZoomVideoCopy, listFailedZoomVideoCopiesForFile, findCopiedZoomVideoCopyForFile, getZoomVideoCopySnapshot, listZoomVideoCopySnapshotsForRequest,
    claimZoomVideoCopyWork, renewZoomVideoCopyLease, releaseZoomVideoCopyLease,
    markZoomVideoCopyCopying, recordZoomVideoCopyProgress, recordZoomVideoCopySessionCreateFailure,
    recordZoomVideoCopySessionRestart, recordZoomVideoCopyUncertainCheck, markZoomVideoCopyRegistering,
    deferZoomVideoCopyRegistration, failZoomVideoCopy, cancelZoomVideoCopy,
    markZoomVideoCopyCopied, listZoomVideoCopiesWithFinalizedIntent, requestZoomVideoCopyCancel,
    claimFailedZoomVideoCopiesDue, deferZoomVideoCopyAttempt,
  };
}

const productionStore = createZoomVideoCopyStore(vercelPostgresAdapter());
export const startZoomVideoCopy = (...args) => productionStore.startZoomVideoCopy(...args);
export const listFailedZoomVideoCopiesForFile = (...args) => productionStore.listFailedZoomVideoCopiesForFile(...args);
export const findCopiedZoomVideoCopyForFile = (...args) => productionStore.findCopiedZoomVideoCopyForFile(...args);
export const getZoomVideoCopySnapshot = (...args) => productionStore.getZoomVideoCopySnapshot(...args);
export const listZoomVideoCopySnapshotsForRequest = (...args) => productionStore.listZoomVideoCopySnapshotsForRequest(...args);
export const claimZoomVideoCopyWork = (...args) => productionStore.claimZoomVideoCopyWork(...args);
export const renewZoomVideoCopyLease = (...args) => productionStore.renewZoomVideoCopyLease(...args);
export const releaseZoomVideoCopyLease = (...args) => productionStore.releaseZoomVideoCopyLease(...args);
export const markZoomVideoCopyCopying = (...args) => productionStore.markZoomVideoCopyCopying(...args);
export const recordZoomVideoCopyProgress = (...args) => productionStore.recordZoomVideoCopyProgress(...args);
export const recordZoomVideoCopySessionCreateFailure = (...args) => productionStore.recordZoomVideoCopySessionCreateFailure(...args);
export const recordZoomVideoCopySessionRestart = (...args) => productionStore.recordZoomVideoCopySessionRestart(...args);
export const recordZoomVideoCopyUncertainCheck = (...args) => productionStore.recordZoomVideoCopyUncertainCheck(...args);
export const markZoomVideoCopyRegistering = (...args) => productionStore.markZoomVideoCopyRegistering(...args);
export const deferZoomVideoCopyRegistration = (...args) => productionStore.deferZoomVideoCopyRegistration(...args);
export const failZoomVideoCopy = (...args) => productionStore.failZoomVideoCopy(...args);
export const cancelZoomVideoCopy = (...args) => productionStore.cancelZoomVideoCopy(...args);
export const markZoomVideoCopyCopied = (...args) => productionStore.markZoomVideoCopyCopied(...args);
export const listZoomVideoCopiesWithFinalizedIntent = (...args) => productionStore.listZoomVideoCopiesWithFinalizedIntent(...args);
export const requestZoomVideoCopyCancel = (...args) => productionStore.requestZoomVideoCopyCancel(...args);
export const claimFailedZoomVideoCopiesDue = (...args) => productionStore.claimFailedZoomVideoCopiesDue(...args);
export const deferZoomVideoCopyAttempt = (...args) => productionStore.deferZoomVideoCopyAttempt(...args);
