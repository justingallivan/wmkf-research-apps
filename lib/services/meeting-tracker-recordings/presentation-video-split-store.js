/**
 * Postgres persistence for presentation_video_splits (migration 080; plan
 * docs/plans/STAGE4_BUILD_PLAN_2026-10-10.md, Slice 2). Parameterized SQL only; no Graph, Sandbox or Dataverse I/O.
 * Slice 2 holds only the start transaction and read paths. Worker, cleanup and approval writers arrive in
 * slices 3-5, each as its own named function with its own predicate.
 *
 * `createPresentationVideoSplitStore(database)` takes a `{ query, transaction }` adapter, like the copy store.
 */
import crypto from 'node:crypto';
import { db, sql } from '@vercel/postgres';

export const SPLIT_PROCESSING_STATES = Object.freeze(['queued', 'cutting', 'uploading']);
const UNIQUE_VIOLATION = '23505';
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const requestLockKey = requestId => `presentation_video_split:${String(requestId).toLowerCase()}`;

function assertGuid(value, label) {
  if (typeof value !== 'string' || !GUID.test(value)) throw new TypeError(`${label} must be a GUID.`);
  return value;
}
function assertText(value, label, { optional = false, max = 2000 } = {}) {
  if (value == null && optional) return null;
  if (typeof value !== 'string' || value.length < 1 || value.length > max) throw new TypeError(`${label} must be a non-empty string.`);
  return value;
}

// Never selects lease_token, approval_claim_token, upload_url_ciphertext, lineage, cleanup_receipt,
// verification_receipt or sandbox_command_id.
export const SNAPSHOT_COLUMNS = `id, request_id, site_visit_activity_id, actor_profile_id, source_copy_id, transcript_revision_id,
  presentation_end_ms, source_document_id, source_drive_id, source_item_id, source_version_id, source_etag, source_size,
  source_quickxor_hash, mapping_version, state, lease_expires_at, next_attempt_at, cut_attempts, cancel_requested_at,
  sandbox_name, sandbox_created_at, sandbox_cleaned_at, cleanup_attempts, next_cleanup_at, output_drive_id, output_item_id,
  output_version_id, output_etag, output_size, output_quickxor_hash, request_document_id, superseded_document_id,
  approval_claimed_at, approval_actor_profile_id, approval_registration_attempted, approved_by_profile_id, approved_at,
  failure_code, created_at, updated_at, completed_at`;

/** Adapter over the app pool, same shape as the copy store's. */
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

export function createPresentationVideoSplitStore(database) {
  if (!database || typeof database.query !== 'function' || typeof database.transaction !== 'function') {
    throw new TypeError('A query/transaction database adapter is required.');
  }

  /**
   * One transaction: request advisory lock; refuse while a split is processing or registering (slice 2 refuses
   * every registering row; stale-approval reconciliation arrives in slice 4); supersede a review row; insert the
   * queued row. Outcomes: started | active | approval_in_progress.
   */
  async function startPresentationVideoSplit(input) {
    const {
      id = crypto.randomUUID(), requestId, siteVisitActivityId, actorProfileId, sourceCopyId, transcriptRevisionId,
      presentationEndMs, sourceDocumentId, sourceDriveId, sourceItemId, sourceVersionId = null, sourceEtag, sourceSize,
      sourceQuickXorHash = null, lineage,
    } = input;
    assertGuid(id, 'id');
    assertGuid(requestId, 'requestId');
    assertGuid(siteVisitActivityId, 'siteVisitActivityId');
    assertGuid(sourceCopyId, 'sourceCopyId');
    assertGuid(transcriptRevisionId, 'transcriptRevisionId');
    assertGuid(sourceDocumentId, 'sourceDocumentId');
    if (!Number.isSafeInteger(actorProfileId) || actorProfileId < 1) throw new TypeError('actorProfileId must be a positive integer.');
    if (!Number.isSafeInteger(presentationEndMs) || presentationEndMs < 0) throw new TypeError('presentationEndMs must be a non-negative integer.');
    if (!Number.isSafeInteger(sourceSize) || sourceSize < 1) throw new TypeError('sourceSize must be a positive integer.');
    assertText(sourceDriveId, 'sourceDriveId');
    assertText(sourceItemId, 'sourceItemId');
    assertText(sourceEtag, 'sourceEtag');
    assertText(sourceVersionId, 'sourceVersionId', { optional: true });
    assertText(sourceQuickXorHash, 'sourceQuickXorHash', { optional: true, max: 100 });
    if (!lineage || typeof lineage !== 'object' || Array.isArray(lineage)) throw new TypeError('lineage must be an object.');
    try {
      return await database.transaction(async tx => {
        await tx.query('SELECT pg_advisory_xact_lock(hashtext($1), 0)', [requestLockKey(requestId)]);
        const processing = oneOrNull(await tx.query(
          `SELECT id FROM presentation_video_splits WHERE request_id = $1 AND state IN ('queued', 'cutting', 'uploading')`,
          [requestId],
        ));
        if (processing) return { status: 'active', split: null };
        const registering = oneOrNull(await tx.query(
          `SELECT id FROM presentation_video_splits WHERE request_id = $1 AND state = 'registering'`,
          [requestId],
        ));
        if (registering) return { status: 'approval_in_progress', split: null };
        const superseded = (await tx.query(
          `UPDATE presentation_video_splits SET state = 'superseded', updated_at = NOW(), completed_at = NOW()
            WHERE request_id = $1 AND state = 'review' RETURNING id`,
          [requestId],
        )).rows;
        const split = oneOrNull(await tx.query(
          `INSERT INTO presentation_video_splits (
             id, request_id, site_visit_activity_id, actor_profile_id, source_copy_id, transcript_revision_id,
             presentation_end_ms, source_document_id, source_drive_id, source_item_id, source_version_id, source_etag,
             source_size, source_quickxor_hash, lineage, state
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, 'queued')
           RETURNING id, state`,
          [id, requestId, siteVisitActivityId, actorProfileId, sourceCopyId, transcriptRevisionId, presentationEndMs,
            sourceDocumentId, sourceDriveId, sourceItemId, sourceVersionId, sourceEtag, sourceSize, sourceQuickXorHash,
            JSON.stringify(lineage)],
        ));
        return { status: 'started', split, supersededIds: superseded.map(row => row.id) };
      });
    } catch (error) {
      if (error?.code === UNIQUE_VIOLATION) return { status: 'active', split: null };
      throw error;
    }
  }

  /** The copied zoom_video_copies row registered as this request document (at most one), for the same-source check. */
  async function findCopiedZoomVideoCopyForDocument({ requestId, requestDocumentId }) {
    return oneOrNull(await database.query(
      `SELECT id, zoom_meeting_uuid, recording_start, recording_end, sharepoint_drive_id, sharepoint_item_id,
              sharepoint_quickxor_hash, declared_size
         FROM zoom_video_copies WHERE request_id = $1 AND request_document_id = $2 AND state = 'copied'`,
      [assertGuid(requestId, 'requestId'), assertGuid(requestDocumentId, 'requestDocumentId')],
    ));
  }

  /** GET: a request's most recent splits. Carries no lease or claim tokens, upload URL ciphertext, lineage or receipts. */
  async function listPresentationVideoSplitSnapshotsForRequest({ requestId, limit = 10 }) {
    return (await database.query(
      `SELECT ${SNAPSHOT_COLUMNS} FROM presentation_video_splits WHERE request_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [assertGuid(requestId, 'requestId'), Math.min(Math.max(Number(limit) | 0, 1), 20)],
    )).rows;
  }

  return { startPresentationVideoSplit, findCopiedZoomVideoCopyForDocument, listPresentationVideoSplitSnapshotsForRequest };
}

const productionStore = createPresentationVideoSplitStore(vercelPostgresAdapter());
export const startPresentationVideoSplit = (...args) => productionStore.startPresentationVideoSplit(...args);
export const findCopiedZoomVideoCopyForDocument = (...args) => productionStore.findCopiedZoomVideoCopyForDocument(...args);
export const listPresentationVideoSplitSnapshotsForRequest = (...args) => productionStore.listPresentationVideoSplitSnapshotsForRequest(...args);
