/**
 * Postgres persistence for presentation_video_splits (migration 080; plan
 * docs/plans/STAGE4_BUILD_PLAN_2026-10-10.md, Slice 2). Parameterized SQL only; no Graph, Sandbox or Dataverse I/O.
 * Slice 2 holds the start transaction and read paths. Slice 3 adds the worker transitions (each fenced by
 * `lease_token = $x AND lease_expires_at > NOW()` and its own from-state) and the Sandbox cleanup ledger. Approval
 * writers arrive in slices 4-5, each as its own named function with its own predicate.
 *
 * Cleanup deviation from the plan's draft predicate: a processing row (queued/cutting/uploading) is never cleanable.
 * A polled row legitimately has a NULL lease between ticks, so "lease is null or expired" would clean a live cut.
 * A row becomes cleanable when the worker moves it out of processing (review, failed, superseded, cancelled).
 *
 * `createPresentationVideoSplitStore(database)` takes a `{ query, transaction }` adapter, like the copy store.
 */
import crypto from 'node:crypto';
import { db, sql } from '@vercel/postgres';

export const SPLIT_PROCESSING_STATES = Object.freeze(['queued', 'cutting', 'uploading']);
const UNIQUE_VIOLATION = '23505';
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CODE = /^[a-z0-9_]{1,80}$/;
function assertCode(value) {
  if (typeof value !== 'string' || !CODE.test(value)) throw new TypeError('failureCode must be a short snake_case code.');
  return value;
}
function assertSeconds(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 86_400) throw new TypeError('seconds must be a positive integer.');
  return value;
}

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
// node-postgres returns BIGINT as a string; the worker compares these numerically.
const normalizeSplit = row => (row ? {
  ...row,
  presentation_end_ms: Number(row.presentation_end_ms),
  source_size: Number(row.source_size),
  output_size: row.output_size == null ? null : Number(row.output_size),
} : null);
const PROCESSING_SQL = `('queued', 'cutting', 'uploading')`;
const CLEANUP_BACKOFF_SQL = `CASE WHEN cleanup_attempts + 1 = 1 THEN INTERVAL '1 minute'
                                    WHEN cleanup_attempts + 1 = 2 THEN INTERVAL '10 minutes' ELSE INTERVAL '1 hour' END`;
const FENCE = `id = $1 AND lease_token = $2 AND lease_expires_at > NOW()`;

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
        // Lock the awaiting row (at most one, by index) so an approval claim cannot move it review -> registering
        // between this check and the supersede below (Codex slice 2 review). The approve claim must also lock it.
        const awaiting = oneOrNull(await tx.query(
          `SELECT id, state FROM presentation_video_splits
            WHERE request_id = $1 AND state IN ('review', 'registering') FOR UPDATE`,
          [requestId],
        ));
        if (awaiting?.state === 'registering') return { status: 'approval_in_progress', split: null };
        const superseded = awaiting ? (await tx.query(
          `UPDATE presentation_video_splits SET state = 'superseded', updated_at = NOW(), completed_at = NOW()
            WHERE id = $1 AND state = 'review' RETURNING id`,
          [awaiting.id],
        )).rows : [];
        if (awaiting && superseded.length !== 1) return { status: 'approval_in_progress', split: null };
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


  // --- slice 3: worker transitions ------------------------------------------------------------------------------

  /** Claim one due processing row (also one whose lease expired). Returns { row, leaseToken } or null. */
  async function claimPresentationVideoSplitWork({ accessRequestId = null, leaseSeconds }) {
    const leaseToken = crypto.randomUUID();
    const result = await database.query(
      `WITH next AS (
         SELECT id FROM presentation_video_splits
          WHERE state IN ${PROCESSING_SQL}
            AND (lease_token IS NULL OR lease_expires_at <= NOW())
            AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
            AND ($2::uuid IS NULL OR request_id = $2::uuid)
          ORDER BY updated_at
          LIMIT 1
          FOR UPDATE SKIP LOCKED
       )
       UPDATE presentation_video_splits s
          SET lease_token = $1, lease_expires_at = NOW() + ($3 || ' seconds')::INTERVAL, updated_at = NOW()
         FROM next WHERE s.id = next.id
       RETURNING s.*`,
      [leaseToken, accessRequestId, assertSeconds(leaseSeconds)],
    );
    const row = normalizeSplit(oneOrNull(result));
    return row ? { row, leaseToken } : null;
  }

  async function renewPresentationVideoSplitLease({ id, leaseToken, states, leaseSeconds }) {
    return oneOrNull(await database.query(
      `UPDATE presentation_video_splits
          SET lease_expires_at = NOW() + ($3 || ' seconds')::INTERVAL, updated_at = NOW()
        WHERE ${FENCE} AND state = ANY($4::text[])
       RETURNING state`,
      [id, leaseToken, assertSeconds(leaseSeconds), states],
    ));
  }

  /** Release the lease without a state change (still-running poll, finished tick). */
  async function releasePresentationVideoSplitLease({ id, leaseToken }) {
    return oneOrNull(await database.query(
      `UPDATE presentation_video_splits SET lease_token = NULL, lease_expires_at = NULL, updated_at = NOW()
        WHERE id = $1 AND lease_token = $2 RETURNING id`,
      [id, leaseToken],
    ));
  }

  /** A fixed configuration fault: wait, uncounted, without changing state. */
  async function deferPresentationVideoSplitAttempt({ id, leaseToken, retrySeconds }) {
    return oneOrNull(await database.query(
      `UPDATE presentation_video_splits
          SET lease_token = NULL, lease_expires_at = NULL, next_attempt_at = NOW() + ($3 || ' seconds')::INTERVAL, updated_at = NOW()
        WHERE ${FENCE} AND state IN ${PROCESSING_SQL} RETURNING id`,
      [id, leaseToken, assertSeconds(retrySeconds)],
    ));
  }

  /** Written before the Sandbox create call, so cleanup tracks the name whatever happens next. */
  async function recordPresentationVideoSandboxName({ id, leaseToken, sandboxName }) {
    return oneOrNull(await database.query(
      `UPDATE presentation_video_splits SET sandbox_name = $3, updated_at = NOW()
        WHERE ${FENCE} AND state = 'queued' AND sandbox_name IS NULL RETURNING id`,
      [id, leaseToken, assertText(sandboxName, 'sandboxName', { max: 100 })],
    ));
  }

  async function recordPresentationVideoSandboxCreated({ id, leaseToken }) {
    return oneOrNull(await database.query(
      `UPDATE presentation_video_splits SET sandbox_created_at = NOW(), updated_at = NOW()
        WHERE ${FENCE} AND state = 'queued' AND sandbox_name IS NOT NULL RETURNING id`,
      [id, leaseToken],
    ));
  }

  /** queued -> cutting once the detached cut command is running. */
  async function recordPresentationVideoCutStarted({ id, leaseToken, commandId }) {
    return oneOrNull(await database.query(
      `UPDATE presentation_video_splits SET state = 'cutting', sandbox_command_id = $3, updated_at = NOW()
        WHERE ${FENCE} AND state = 'queued' AND sandbox_name IS NOT NULL RETURNING id`,
      [id, leaseToken, assertText(commandId, 'commandId', { max: 200 })],
    ));
  }

  /** cutting -> uploading: the cut receipt, the sealed upload session and the upload command id, in one write. */
  async function recordPresentationVideoCutReceiptAndUploadStarted({
    id, leaseToken, verificationReceipt, uploadUrlCiphertext, uploadSessionExpiresAt, commandId,
  }) {
    if (!verificationReceipt || typeof verificationReceipt !== 'object' || Array.isArray(verificationReceipt)) {
      throw new TypeError('verificationReceipt must be an object.');
    }
    return oneOrNull(await database.query(
      `UPDATE presentation_video_splits
          SET state = 'uploading', verification_receipt = $3::jsonb, upload_url_ciphertext = $4,
              upload_session_expires_at = $5, sandbox_command_id = $6, updated_at = NOW()
        WHERE ${FENCE} AND state = 'cutting' RETURNING id`,
      [id, leaseToken, JSON.stringify(verificationReceipt), assertText(uploadUrlCiphertext, 'uploadUrlCiphertext', { max: 20000 }),
        uploadSessionExpiresAt ?? null, assertText(commandId, 'commandId', { max: 200 })],
    ));
  }

  /** uploading -> review with the verified output identity. Clears the lease and the sealed upload URL. */
  async function markPresentationVideoSplitReview({
    id, leaseToken, outputDriveId, outputItemId, outputVersionId = null, outputEtag, outputSize, outputQuickXorHash = null,
  }) {
    if (!Number.isSafeInteger(outputSize) || outputSize < 1) throw new TypeError('outputSize must be a positive integer.');
    return oneOrNull(await database.query(
      `UPDATE presentation_video_splits
          SET state = 'review', output_drive_id = $3, output_item_id = $4, output_version_id = $5, output_etag = $6,
              output_size = $7, output_quickxor_hash = $8, upload_url_ciphertext = NULL,
              lease_token = NULL, lease_expires_at = NULL, updated_at = NOW()
        WHERE ${FENCE} AND state = 'uploading' RETURNING id`,
      [id, leaseToken, assertText(outputDriveId, 'outputDriveId'), assertText(outputItemId, 'outputItemId'),
        outputVersionId, assertText(outputEtag, 'outputEtag'), outputSize, outputQuickXorHash],
    ));
  }

  /** processing -> failed. Clears the lease and the sealed upload URL; cleanup of the Sandbox is the sweep's job. */
  async function failPresentationVideoSplit({ id, leaseToken, failureCode }) {
    return oneOrNull(await database.query(
      `UPDATE presentation_video_splits
          SET state = 'failed', failure_code = $3, upload_url_ciphertext = NULL,
              lease_token = NULL, lease_expires_at = NULL, updated_at = NOW(), completed_at = NOW()
        WHERE ${FENCE} AND state IN ${PROCESSING_SQL} RETURNING id`,
      [id, leaseToken, assertCode(failureCode)],
    ));
  }

  /** processing -> superseded (the frozen input changed). */
  async function supersedePresentationVideoSplit({ id, leaseToken, failureCode = null }) {
    return oneOrNull(await database.query(
      `UPDATE presentation_video_splits
          SET state = 'superseded', failure_code = $3, upload_url_ciphertext = NULL,
              lease_token = NULL, lease_expires_at = NULL, updated_at = NOW(), completed_at = NOW()
        WHERE ${FENCE} AND state IN ${PROCESSING_SQL} RETURNING id`,
      [id, leaseToken, failureCode == null ? null : assertCode(failureCode)],
    ));
  }

  /** Revalidation read: the source copy row's state and file identity. */
  async function getPresentationVideoSourceCopy({ copyId }) {
    return oneOrNull(await database.query(
      `SELECT state, sharepoint_drive_id, sharepoint_item_id FROM zoom_video_copies WHERE id = $1`,
      [assertGuid(copyId, 'copyId')],
    ));
  }

  /**
   * Recovery claim, independent of access: unleased (or lease-expired) processing rows that the access flag no longer
   * allows (`accessMode` off, or `test` for another request) or that have not been touched for `maxAgeSeconds`
   * (the Sandbox timeout plus slack). Healthy polled rows are recent, so they stay excluded. Takes a fresh lease.
   * Returns [{ row, leaseToken, reason }] with reason `access_withdrawn` or `processor_expired`.
   */
  async function claimPresentationVideoSplitRecovery({ accessMode, testRequestId = null, maxAgeSeconds, leaseSeconds, limit = 2 }) {
    if (!['off', 'on', 'test'].includes(accessMode)) throw new TypeError('accessMode must be off, on or test.');
    const leaseToken = crypto.randomUUID();
    const result = await database.query(
      `WITH due AS (
         SELECT id,
                CASE WHEN $2 = 'off' OR ($2 = 'test' AND request_id <> $3::uuid) THEN 'access_withdrawn' ELSE 'processor_expired' END AS reason
           FROM presentation_video_splits
          WHERE state IN ${PROCESSING_SQL}
            AND (lease_token IS NULL OR lease_expires_at <= NOW())
            AND ($2 = 'off' OR ($2 = 'test' AND request_id <> $3::uuid)
                 OR updated_at < NOW() - ($4 || ' seconds')::INTERVAL)
          ORDER BY updated_at
          LIMIT $1
          FOR UPDATE SKIP LOCKED
       )
       UPDATE presentation_video_splits s
          SET lease_token = $5, lease_expires_at = NOW() + ($6 || ' seconds')::INTERVAL, updated_at = NOW()
         FROM due WHERE s.id = due.id
       RETURNING s.*, due.reason AS recovery_reason`,
      [Math.min(Math.max(Number(limit) | 0, 1), 5), accessMode, testRequestId, assertSeconds(maxAgeSeconds), leaseToken, assertSeconds(leaseSeconds)],
    );
    return result.rows.map(row => ({ row: normalizeSplit(row), leaseToken, reason: row.recovery_reason }));
  }

  // --- slice 3: Sandbox cleanup ledger ---------------------------------------------------------------------------

  /**
   * Claim up to `limit` rows whose Sandbox is not yet cleaned and whose processing is over (state outside
   * queued/cutting/uploading), bumping the attempt count and next due time (1 min, 10 min, then 1 h) in the same
   * statement. Returns the rows (id, request_id, sandbox_name, cleanup_attempts after the bump).
   */
  async function claimPresentationVideoSplitCleanup({ limit = 2 } = {}) {
    return (await database.query(
      `WITH due AS (
         SELECT id FROM presentation_video_splits
          WHERE sandbox_name IS NOT NULL AND sandbox_cleaned_at IS NULL
            AND state NOT IN ${PROCESSING_SQL}
            AND (next_cleanup_at IS NULL OR next_cleanup_at <= NOW())
          ORDER BY next_cleanup_at NULLS FIRST
          LIMIT $1
          FOR UPDATE SKIP LOCKED
       )
       UPDATE presentation_video_splits s
          SET cleanup_attempts = s.cleanup_attempts + 1, next_cleanup_at = NOW() + ${CLEANUP_BACKOFF_SQL}, updated_at = NOW()
         FROM due WHERE s.id = due.id
       RETURNING s.id, s.request_id, s.sandbox_name, s.cleanup_attempts`,
      [Math.min(Math.max(Number(limit) | 0, 1), 5)],
    )).rows;
  }

  /** Persisted before the Sandbox is deleted, so the cost record survives a failed delete. */
  async function recordPresentationVideoSandboxUsage({ id, activeCpuMs, provisionedMs, vcpus }) {
    const nonNegative = value => (Number.isSafeInteger(value) && value >= 0 ? value : null);
    return oneOrNull(await database.query(
      `UPDATE presentation_video_splits
          SET sandbox_active_cpu_ms = $2, sandbox_provisioned_ms = $3, sandbox_vcpus = $4, updated_at = NOW()
        WHERE id = $1 AND sandbox_cleaned_at IS NULL RETURNING id`,
      [id, nonNegative(activeCpuMs), nonNegative(provisionedMs), vcpus >= 1 && vcpus <= 8 ? vcpus : null],
    ));
  }

  async function markPresentationVideoSandboxCleaned({ id, cleanupReceipt }) {
    return oneOrNull(await database.query(
      `UPDATE presentation_video_splits SET sandbox_cleaned_at = NOW(), cleanup_receipt = $2::jsonb, updated_at = NOW()
        WHERE id = $1 AND sandbox_name IS NOT NULL AND sandbox_cleaned_at IS NULL AND state NOT IN ${PROCESSING_SQL}
       RETURNING id`,
      [id, JSON.stringify(cleanupReceipt || {})],
    ));
  }

  /** Orphan sweep: of the given Sandbox names, those that still have an uncleaned row (those must not be touched). */
  async function listUncleanedPresentationVideoSandboxNames({ names }) {
    if (!Array.isArray(names) || names.length === 0) return [];
    return (await database.query(
      `SELECT sandbox_name FROM presentation_video_splits
        WHERE sandbox_name = ANY($1::text[]) AND sandbox_cleaned_at IS NULL`,
      [names],
    )).rows.map(row => row.sandbox_name);
  }

  return {
    startPresentationVideoSplit, findCopiedZoomVideoCopyForDocument, listPresentationVideoSplitSnapshotsForRequest,
    claimPresentationVideoSplitWork, renewPresentationVideoSplitLease, releasePresentationVideoSplitLease,
    deferPresentationVideoSplitAttempt, recordPresentationVideoSandboxName, recordPresentationVideoSandboxCreated,
    recordPresentationVideoCutStarted, recordPresentationVideoCutReceiptAndUploadStarted, markPresentationVideoSplitReview,
    failPresentationVideoSplit, supersedePresentationVideoSplit, getPresentationVideoSourceCopy,
    claimPresentationVideoSplitRecovery, claimPresentationVideoSplitCleanup, recordPresentationVideoSandboxUsage, markPresentationVideoSandboxCleaned,
    listUncleanedPresentationVideoSandboxNames,
  };
}

const productionStore = createPresentationVideoSplitStore(vercelPostgresAdapter());
export const startPresentationVideoSplit = (...args) => productionStore.startPresentationVideoSplit(...args);
export const findCopiedZoomVideoCopyForDocument = (...args) => productionStore.findCopiedZoomVideoCopyForDocument(...args);
export const listPresentationVideoSplitSnapshotsForRequest = (...args) => productionStore.listPresentationVideoSplitSnapshotsForRequest(...args);
export const claimPresentationVideoSplitWork = (...args) => productionStore.claimPresentationVideoSplitWork(...args);
export const renewPresentationVideoSplitLease = (...args) => productionStore.renewPresentationVideoSplitLease(...args);
export const releasePresentationVideoSplitLease = (...args) => productionStore.releasePresentationVideoSplitLease(...args);
export const deferPresentationVideoSplitAttempt = (...args) => productionStore.deferPresentationVideoSplitAttempt(...args);
export const recordPresentationVideoSandboxName = (...args) => productionStore.recordPresentationVideoSandboxName(...args);
export const recordPresentationVideoSandboxCreated = (...args) => productionStore.recordPresentationVideoSandboxCreated(...args);
export const recordPresentationVideoCutStarted = (...args) => productionStore.recordPresentationVideoCutStarted(...args);
export const recordPresentationVideoCutReceiptAndUploadStarted = (...args) => productionStore.recordPresentationVideoCutReceiptAndUploadStarted(...args);
export const markPresentationVideoSplitReview = (...args) => productionStore.markPresentationVideoSplitReview(...args);
export const failPresentationVideoSplit = (...args) => productionStore.failPresentationVideoSplit(...args);
export const supersedePresentationVideoSplit = (...args) => productionStore.supersedePresentationVideoSplit(...args);
export const getPresentationVideoSourceCopy = (...args) => productionStore.getPresentationVideoSourceCopy(...args);
export const claimPresentationVideoSplitCleanup = (...args) => productionStore.claimPresentationVideoSplitCleanup(...args);
export const recordPresentationVideoSandboxUsage = (...args) => productionStore.recordPresentationVideoSandboxUsage(...args);
export const markPresentationVideoSandboxCleaned = (...args) => productionStore.markPresentationVideoSandboxCleaned(...args);
export const listUncleanedPresentationVideoSandboxNames = (...args) => productionStore.listUncleanedPresentationVideoSandboxNames(...args);
export const claimPresentationVideoSplitRecovery = (...args) => productionStore.claimPresentationVideoSplitRecovery(...args);
