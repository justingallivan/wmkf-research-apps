/**
 * Postgres persistence for presentation_transcript_regenerations (migration 081; Site Visit redesign slice C1, plan
 * docs/plans/SITE_VISIT_PAGE_REDESIGN_PLAN_2026-10-10.md section 6). Parameterized SQL only; no Dataverse or Graph I/O.
 *
 * One queue row asks the cron worker to generate the presentation and staff discussion transcripts for a published
 * correction. Latest publish wins: `enqueue` upserts the request's single `pending` row. A `running` row for an older
 * artifact is left alone; its generator call fails `meeting_transcript_current_changed` and the worker marks it
 * `superseded`. Every worker transition is fenced by `lease_token = $x AND lease_expires_at > NOW()` and its own
 * from-state. `attempts` counts claims, so a worker that keeps dying cannot loop forever.
 *
 * `createPresentationTranscriptRegenerationStore(database)` takes a `{ query }` adapter like the split store's.
 */
import crypto from 'node:crypto';
import { sql } from '@vercel/postgres';

export const REGENERATION_MAX_ATTEMPTS = 3;
const UNIQUE_VIOLATION = '23505';
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FINGERPRINT = /^[0-9a-f]{64}$/;
const CODE = /^[a-z0-9_]{1,80}$/;

function assertGuid(value, label) {
  if (typeof value !== 'string' || !GUID.test(value)) throw new TypeError(`${label} must be a GUID.`);
  return value;
}
function assertCode(value) {
  if (typeof value !== 'string' || !CODE.test(value)) throw new TypeError('failureCode must be a short snake_case code.');
  return value;
}
function assertSeconds(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 86_400) throw new TypeError('seconds must be a positive integer.');
  return value;
}

const oneOrNull = result => result.rows[0] || null;
const FENCE = `id = $1 AND lease_token = $2 AND lease_expires_at > NOW()`;
// Wait after the Nth claimed attempt failed transiently (the third failure ends the row, so its wait is never used).
const BACKOFF_SQL = `CASE WHEN attempts <= 1 THEN INTERVAL '1 minute' WHEN attempts = 2 THEN INTERVAL '5 minutes' ELSE INTERVAL '15 minutes' END`;
const COLUMNS = `id, request_id, transcript_artifact_id, transcript_fingerprint, transcript_slot_version, actor_profile_id, acting_user_system_id,
  state, attempts, next_attempt_at, lease_expires_at, failure_code, created_at, updated_at, completed_at`;

export function createPresentationTranscriptRegenerationStore(database) {
  if (!database || typeof database.query !== 'function') throw new TypeError('A query database adapter is required.');

  /**
   * Latest publish wins: insert the request's `pending` row, or replace the one already waiting (new artifact,
   * fingerprint, actor, attempts back to 0). A `running` row is untouched. Ordering: the upsert only
   * replaces a waiting row whose `transcript_slot_version` (the publish's TRANSCRIPT slot fence) is lower, so a delayed
   * enqueue for an older publish returns null and leaves the newer row.
   */
  async function enqueuePresentationTranscriptRegeneration({ requestId, transcriptArtifactId, transcriptFingerprint, transcriptSlotVersion, actorProfileId, actingUserSystemId }) {
    if (!Number.isSafeInteger(transcriptSlotVersion) || transcriptSlotVersion < 1) throw new TypeError('transcriptSlotVersion must be a positive integer.');
    assertGuid(requestId, 'requestId');
    assertGuid(transcriptArtifactId, 'transcriptArtifactId');
    assertGuid(actingUserSystemId, 'actingUserSystemId');
    if (typeof transcriptFingerprint !== 'string' || !FINGERPRINT.test(transcriptFingerprint)) throw new TypeError('transcriptFingerprint must be 64 lowercase hex characters.');
    if (!Number.isSafeInteger(actorProfileId) || actorProfileId < 1) throw new TypeError('actorProfileId must be a positive integer.');
    return oneOrNull(await database.query(
      `INSERT INTO presentation_transcript_regenerations
         (id, request_id, transcript_artifact_id, transcript_fingerprint, transcript_slot_version, actor_profile_id, acting_user_system_id, state, attempts)
       VALUES ($1, $2, $3, $4, $7, $5, $6, 'pending', 0)
       ON CONFLICT (request_id) WHERE state = 'pending' DO UPDATE
         SET transcript_artifact_id = EXCLUDED.transcript_artifact_id,
             transcript_fingerprint = EXCLUDED.transcript_fingerprint,
             actor_profile_id = EXCLUDED.actor_profile_id,
             acting_user_system_id = EXCLUDED.acting_user_system_id,
             transcript_slot_version = EXCLUDED.transcript_slot_version,
             attempts = 0, next_attempt_at = NULL, failure_code = NULL, updated_at = NOW()
         WHERE presentation_transcript_regenerations.transcript_slot_version < EXCLUDED.transcript_slot_version
       RETURNING ${COLUMNS}`,
      [crypto.randomUUID(), requestId, transcriptArtifactId, transcriptFingerprint, actorProfileId, actingUserSystemId, transcriptSlotVersion],
    ));
  }

  /** Card read: the artifact ids a pending or running row is generating for. Never lease data. */
  async function listActivePresentationTranscriptRegenerations({ requestId }) {
    const result = await database.query(
      `SELECT transcript_artifact_id FROM presentation_transcript_regenerations
        WHERE request_id = $1 AND state IN ('pending', 'running')`,
      [assertGuid(requestId, 'requestId')],
    );
    return result.rows;
  }

  /**
   * Claim one due `pending` row (SKIP LOCKED), skipping any request that already has a `running` row (the one-running
   * index would refuse it). Counts the attempt. Returns { row, leaseToken } or null.
   */
  async function claimPresentationTranscriptRegeneration({ leaseSeconds }) {
    const leaseToken = crypto.randomUUID();
    const result = await database.query(
      `WITH next AS (
         SELECT p.id FROM presentation_transcript_regenerations p
          WHERE p.state = 'pending'
            AND (p.next_attempt_at IS NULL OR p.next_attempt_at <= NOW())
            AND NOT EXISTS (SELECT 1 FROM presentation_transcript_regenerations r WHERE r.request_id = p.request_id AND r.state = 'running')
          ORDER BY p.created_at
          LIMIT 1
          FOR UPDATE SKIP LOCKED
       )
       UPDATE presentation_transcript_regenerations g
          SET state = 'running', attempts = g.attempts + 1, next_attempt_at = NULL,
              lease_token = $1, lease_expires_at = NOW() + ($2 || ' seconds')::INTERVAL, updated_at = NOW()
         FROM next WHERE g.id = next.id
       RETURNING g.*`,
      [leaseToken, assertSeconds(leaseSeconds)],
    );
    const row = oneOrNull(result);
    return row ? { row, leaseToken } : null;
  }

  /** running -> done. */
  async function markPresentationTranscriptRegenerationDone({ id, leaseToken }) {
    return oneOrNull(await database.query(
      `UPDATE presentation_transcript_regenerations
          SET state = 'done', lease_token = NULL, lease_expires_at = NULL, updated_at = NOW(), completed_at = NOW()
        WHERE ${FENCE} AND state = 'running' RETURNING id`,
      [id, leaseToken],
    ));
  }

  /** running -> superseded (the current transcript is no longer the one this row was queued for). */
  async function supersedePresentationTranscriptRegeneration({ id, leaseToken, failureCode = null }) {
    return oneOrNull(await database.query(
      `UPDATE presentation_transcript_regenerations
          SET state = 'superseded', failure_code = $3, lease_token = NULL, lease_expires_at = NULL, updated_at = NOW(), completed_at = NOW()
        WHERE ${FENCE} AND state = 'running' RETURNING id`,
      [id, leaseToken, failureCode == null ? null : assertCode(failureCode)],
    ));
  }

  /** running -> failed. The card falls back to Out of date with Regenerate. */
  async function failPresentationTranscriptRegeneration({ id, leaseToken, failureCode }) {
    return oneOrNull(await database.query(
      `UPDATE presentation_transcript_regenerations
          SET state = 'failed', failure_code = $3, lease_token = NULL, lease_expires_at = NULL, updated_at = NOW(), completed_at = NOW()
        WHERE ${FENCE} AND state = 'running' RETURNING id`,
      [id, leaseToken, assertCode(failureCode)],
    ));
  }

  /**
   * running -> pending with backoff after a transient fault, or -> failed with the last code once the claimed attempts
   * reach the cap. If a newer `pending` row for the request appeared meanwhile (unique violation), this row is
   * superseded instead: the newer one carries the latest artifact. Returns { state } or null (lease lost).
   */
  async function retryPresentationTranscriptRegeneration({ id, leaseToken, failureCode }) {
    assertCode(failureCode);
    const failed = oneOrNull(await database.query(
      `UPDATE presentation_transcript_regenerations
          SET state = 'failed', failure_code = $3, lease_token = NULL, lease_expires_at = NULL, updated_at = NOW(), completed_at = NOW()
        WHERE ${FENCE} AND state = 'running' AND attempts >= $4 RETURNING id`,
      [id, leaseToken, failureCode, REGENERATION_MAX_ATTEMPTS],
    ));
    if (failed) return { state: 'failed' };
    try {
      const pending = oneOrNull(await database.query(
        `UPDATE presentation_transcript_regenerations
            SET state = 'pending', next_attempt_at = NOW() + ${BACKOFF_SQL}, lease_token = NULL, lease_expires_at = NULL, updated_at = NOW()
          WHERE ${FENCE} AND state = 'running' AND attempts < $3 RETURNING id`,
        [id, leaseToken, REGENERATION_MAX_ATTEMPTS],
      ));
      return pending ? { state: 'pending' } : null;
    } catch (error) {
      if (error?.code !== UNIQUE_VIOLATION) throw error;
      const superseded = await supersedePresentationTranscriptRegeneration({ id, leaseToken, failureCode: 'presentation_transcript_regeneration_replaced' });
      return superseded ? { state: 'superseded' } : null;
    }
  }

  /**
   * Reclaim `running` rows whose lease expired (the worker died). At the attempt cap the row fails with
   * `presentation_transcript_regeneration_lease_expired`; otherwise it goes back to `pending` (or `superseded` when a
   * newer pending row exists). Returns the number of rows moved.
   */
  async function recoverExpiredPresentationTranscriptRegenerations({ limit = 5 } = {}) {
    const expired = await database.query(
      `SELECT id, attempts FROM presentation_transcript_regenerations
        WHERE state = 'running' AND lease_expires_at <= NOW()
        ORDER BY lease_expires_at LIMIT $1`,
      [Math.min(Math.max(Number(limit) | 0, 1), 20)],
    );
    let moved = 0;
    for (const { id, attempts } of expired.rows) {
      const guard = `id = $1 AND state = 'running' AND lease_expires_at <= NOW()`;
      if (attempts >= REGENERATION_MAX_ATTEMPTS) {
        moved += (await database.query(
          `UPDATE presentation_transcript_regenerations
              SET state = 'failed', failure_code = 'presentation_transcript_regeneration_lease_expired',
                  lease_token = NULL, lease_expires_at = NULL, updated_at = NOW(), completed_at = NOW()
            WHERE ${guard} RETURNING id`, [id])).rowCount || 0;
        continue;
      }
      try {
        moved += (await database.query(
          `UPDATE presentation_transcript_regenerations
              SET state = 'pending', next_attempt_at = NOW(), lease_token = NULL, lease_expires_at = NULL, updated_at = NOW()
            WHERE ${guard} RETURNING id`, [id])).rowCount || 0;
      } catch (error) {
        if (error?.code !== UNIQUE_VIOLATION) throw error;
        moved += (await database.query(
          `UPDATE presentation_transcript_regenerations
              SET state = 'superseded', failure_code = 'presentation_transcript_regeneration_replaced',
                  lease_token = NULL, lease_expires_at = NULL, updated_at = NOW(), completed_at = NOW()
            WHERE ${guard} RETURNING id`, [id])).rowCount || 0;
      }
    }
    return moved;
  }

  return {
    enqueuePresentationTranscriptRegeneration, listActivePresentationTranscriptRegenerations,
    claimPresentationTranscriptRegeneration, markPresentationTranscriptRegenerationDone,
    supersedePresentationTranscriptRegeneration, failPresentationTranscriptRegeneration,
    retryPresentationTranscriptRegeneration, recoverExpiredPresentationTranscriptRegenerations,
  };
}

const productionStore = createPresentationTranscriptRegenerationStore({ query: (text, params = []) => sql.query(text, params) });
export const enqueuePresentationTranscriptRegeneration = (...args) => productionStore.enqueuePresentationTranscriptRegeneration(...args);
export const listActivePresentationTranscriptRegenerations = (...args) => productionStore.listActivePresentationTranscriptRegenerations(...args);
export const claimPresentationTranscriptRegeneration = (...args) => productionStore.claimPresentationTranscriptRegeneration(...args);
export const markPresentationTranscriptRegenerationDone = (...args) => productionStore.markPresentationTranscriptRegenerationDone(...args);
export const supersedePresentationTranscriptRegeneration = (...args) => productionStore.supersedePresentationTranscriptRegeneration(...args);
export const failPresentationTranscriptRegeneration = (...args) => productionStore.failPresentationTranscriptRegeneration(...args);
export const retryPresentationTranscriptRegeneration = (...args) => productionStore.retryPresentationTranscriptRegeneration(...args);
export const recoverExpiredPresentationTranscriptRegenerations = (...args) => productionStore.recoverExpiredPresentationTranscriptRegenerations(...args);
