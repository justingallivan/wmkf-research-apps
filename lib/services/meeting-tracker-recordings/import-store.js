/**
 * Postgres persistence for zoom_recording_imports (migration 074; plan
 * docs/plans/ZOOM_RECORDING_IMPORT_PLAN_2026-10-08.md). Parameterized SQL only; no Zoom,
 * Blob or Dataverse I/O happens here. The store stores identifiers and lifecycle state only.
 *
 * Lifecycle: importing (lease) -> started | failed. Every transition out of 'importing'
 * clears both lease columns and matches the lease holder, so a killed request can never
 * overwrite a takeover.
 */
import crypto from 'node:crypto';
import { sql } from '@vercel/postgres';

// Must exceed the import route's 300 s maxDuration.
export const IMPORT_LEASE_SECONDS = 10 * 60;
const FAILURE_CODE = /^[a-z0-9_]{1,80}$/;
export const FALLBACK_FAILURE_CODE = 'zoom_import_failed';

/** A code that satisfies the table CHECK; anything else collapses to the fallback. */
export function sanitizeFailureCode(code) {
  return typeof code === 'string' && FAILURE_CODE.test(code) ? code : FALLBACK_FAILURE_CODE;
}

/**
 * Insert a new 'importing' row holding a fresh lease. Returns the row, or null when the
 * partial unique index shows an importing/started row for the same request and meeting.
 */
export async function claimZoomImport({
  id = crypto.randomUUID(), requestId, siteVisitActivityId, actorProfileId, meetingUuid,
  hostId, meetingStart, includesZoomTranscript,
}) {
  const leaseToken = crypto.randomUUID();
  const result = await sql`
    INSERT INTO zoom_recording_imports (
      id, request_id, site_visit_activity_id, actor_profile_id, zoom_meeting_uuid, zoom_host_id,
      zoom_meeting_start, includes_zoom_transcript, state, lease_token, lease_expires_at
    ) VALUES (
      ${id}, ${requestId}, ${siteVisitActivityId}, ${actorProfileId}, ${meetingUuid}, ${hostId},
      ${meetingStart}, ${includesZoomTranscript === true}, 'importing', ${leaseToken},
      NOW() + (${IMPORT_LEASE_SECONDS} || ' seconds')::INTERVAL
    )
    ON CONFLICT (request_id, zoom_meeting_uuid) WHERE state IN ('importing', 'started') DO NOTHING
    RETURNING *
  `;
  return result.rows[0] || null;
}

/** The importing/started row for a request and meeting, with whether its lease has expired. */
export async function getActiveZoomImport({ requestId, meetingUuid }) {
  const result = await sql`
    SELECT r.*, (r.state = 'importing' AND r.lease_expires_at <= NOW()) AS lease_expired, j.status AS job_status
      FROM zoom_recording_imports r
      LEFT JOIN transcription_jobs j ON j.id = r.transcription_job_id
     WHERE r.request_id = ${requestId} AND r.zoom_meeting_uuid = ${meetingUuid}
       AND r.state IN ('importing', 'started')
  `;
  return result.rows[0] || null;
}

/** Read-only: the transcription job created for an import row (its idempotency key is the row id). */
export async function findJobForImport({ actorProfileId, importId }) {
  const result = await sql`
    SELECT id, status FROM transcription_jobs
     WHERE owner_profile_id = ${actorProfileId} AND idempotency_key = ${importId}
  `;
  return result.rows[0] || null;
}

/**
 * Takeover of an expired lease whose job exists past 'uploading'. Conditional on the
 * lease still being expired, so only one of two concurrent requests gets the row back.
 */
export async function takeOverExpiredAsStarted({ id, jobId }) {
  const result = await sql`
    UPDATE zoom_recording_imports
       SET state = 'started', transcription_job_id = ${jobId}, lease_token = NULL,
           lease_expires_at = NULL, updated_at = NOW()
     WHERE id = ${id} AND state = 'importing' AND lease_expires_at <= NOW()
     RETURNING *
  `;
  return result.rows[0] || null;
}

/** Takeover of an expired lease with no usable job: fail it so a new claim can proceed. */
export async function takeOverExpiredAsFailed({ id, failureCode }) {
  const result = await sql`
    UPDATE zoom_recording_imports
       SET state = 'failed', failure_code = ${sanitizeFailureCode(failureCode)}, lease_token = NULL,
           lease_expires_at = NULL, updated_at = NOW()
     WHERE id = ${id} AND state = 'importing' AND lease_expires_at <= NOW()
     RETURNING *
  `;
  return result.rows[0] || null;
}

/**
 * Release a started row whose job ended (failed/expired) or is gone, so the meeting can be imported again.
 * Conditional on the row still being started with the same job id; only one of two concurrent requests wins.
 */
export async function releaseStartedImportWithEndedJob({ id, jobId }) {
  const result = await sql`
    UPDATE zoom_recording_imports
       SET state = 'failed', failure_code = 'zoom_import_job_ended', updated_at = NOW()
     WHERE id = ${id} AND state = 'started' AND (transcription_job_id IS NOT DISTINCT FROM ${jobId})
     RETURNING *
  `;
  return result.rows[0] || null;
}

/** Final 'started' update; null (and no write) when the caller no longer holds the lease. */
export async function markZoomImportStarted({ id, leaseToken, jobId }) {
  const result = await sql`
    UPDATE zoom_recording_imports
       SET state = 'started', transcription_job_id = ${jobId}, lease_token = NULL,
           lease_expires_at = NULL, updated_at = NOW()
     WHERE id = ${id} AND lease_token = ${leaseToken} AND state = 'importing'
     RETURNING *
  `;
  return result.rows[0] || null;
}

/** Final 'failed' update; null (and no write) when the caller no longer holds the lease. */
export async function markZoomImportFailed({ id, leaseToken, failureCode }) {
  const result = await sql`
    UPDATE zoom_recording_imports
       SET state = 'failed', failure_code = ${sanitizeFailureCode(failureCode)}, lease_token = NULL,
           lease_expires_at = NULL, updated_at = NOW()
     WHERE id = ${id} AND lease_token = ${leaseToken} AND state = 'importing'
     RETURNING *
  `;
  return result.rows[0] || null;
}

/** Recent import rows for a request, newest first, for the picker's per-meeting state. */
export async function listZoomImportsForRequest({ requestId, limit = 200 }) {
  const result = await sql`
    SELECT r.id, r.zoom_meeting_uuid, r.state, r.transcription_job_id, r.failure_code, r.created_at,
           (r.state = 'importing' AND r.lease_expires_at <= NOW()) AS lease_expired, j.status AS job_status
      FROM zoom_recording_imports r
      LEFT JOIN transcription_jobs j ON j.id = r.transcription_job_id
     WHERE r.request_id = ${requestId}
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT ${limit}
  `;
  return result.rows;
}
