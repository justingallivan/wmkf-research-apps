/** Postgres persistence for transcription_jobs. External I/O is always done by callers. */
import crypto from 'node:crypto';
import { db, sql } from '@vercel/postgres';
import { TRANSCRIPTION_JOB_STATUS } from './model';

const LEASE_SECONDS = 7 * 60;
const STATUS_VALUES = Object.values(TRANSCRIPTION_JOB_STATUS);
const MUTABLE_FIELDS = new Set([
  'status', 'non_sensitive_acknowledged_at', 'original_filename', 'verified_content_type', 'verified_bytes',
  'audio_duration_ms', 'audio_sha256', 'audio_etag', 'audio_pathname',
  'provider_upload_ref_ciphertext', 'provider_transcript_id', 'callback_candidate_transcript_id',
  'conflicting_transcript_id', 'provider_id_conflict', 'submission_intent_at', 'attempts',
  'next_attempt_at', 'sanitized_error_code', 'output_pathname', 'output_sha256',
  'diagnostic_pathname', 'diagnostic_sha256', 'ready_at', 'expires_at', 'receipt_expires_at',
  'word_accuracy_score', 'speaker_accuracy_score', 'correction_notes', 'content_purged_at',
  'reference_purged_at', 'abandonment_acknowledged', 'abandoned_at', 'cleanup_requested_at',
  'provider_cleanup_completed_at', 'local_cleanup_completed_at', 'input_cleanup_pathname',
  'output_cleanup_pathname', 'diagnostic_cleanup_pathname', 'returned_model', 'options_snapshot',
]);
const JSON_FIELDS = new Set(['options_snapshot', 'speaker_names']);

export function transcriptionStoreError(code, message, httpStatus = 409) {
  const error = new Error(message);
  error.name = 'TranscriptionStoreError';
  error.code = code;
  error.httpStatus = httpStatus;
  return error;
}

function assertUuid(value, name) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw transcriptionStoreError('transcription_invalid_value', `Invalid ${name}.`, 400);
  }
  return value.toLowerCase();
}

function assertOwner(ownerProfileId) {
  if (!Number.isSafeInteger(ownerProfileId) || ownerProfileId <= 0) {
    throw transcriptionStoreError('transcription_owner_required', 'An authenticated profile is required.', 401);
  }
}

function normalizeHash(value, name) {
  if (value == null) return null;
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/i.test(value)) {
    throw transcriptionStoreError('transcription_invalid_value', `Invalid ${name}.`, 400);
  }
  return value.toLowerCase();
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function validateStoredSpeakerNames(speakerNames) {
  if (!speakerNames || typeof speakerNames !== 'object' || Array.isArray(speakerNames)) {
    throw transcriptionStoreError('transcription_invalid_value', 'Invalid speaker names.', 400);
  }
  const prototype = Object.getPrototypeOf(speakerNames);
  const entries = Object.entries(speakerNames);
  if ((prototype !== Object.prototype && prototype !== null) || entries.length > 200) {
    throw transcriptionStoreError('transcription_invalid_value', 'Invalid speaker names.', 400);
  }
  const normalized = [];
  for (const [speakerId, rawName] of entries) {
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(speakerId) || typeof rawName !== 'string' || rawName.length > 80
      || /[\u0000-\u001f\u007f-\u009f]/.test(rawName)) {
      throw transcriptionStoreError('transcription_invalid_value', 'Invalid speaker names.', 400);
    }
    const name = rawName.trim();
    if (name) normalized.push([speakerId, name]);
  }
  return Object.fromEntries(normalized);
}

function fieldExpression(field, index) {
  return JSON_FIELDS.has(field) ? `$${index}::jsonb` : `$${index}`;
}

/** Injected query/transaction adapter keeps real Postgres tests isolated and production SQL identical. */
export function createTranscriptionPilotStore(database) {
  if (!database || typeof database.query !== 'function' || typeof database.transaction !== 'function') {
    throw new TypeError('A query/transaction database adapter is required.');
  }

  async function getJob(id) {
    const result = await database.query('SELECT * FROM transcription_jobs WHERE id = $1', [assertUuid(id, 'job id')]);
    return result.rows[0] || null;
  }

  async function getLeasedJob({ jobId, leaseToken }) {
    const result = await database.query(
      `SELECT * FROM transcription_jobs
        WHERE id = $1 AND lease_token = $2 AND lease_expires_at > NOW()`,
      [assertUuid(jobId, 'job id'), assertUuid(leaseToken, 'lease token')],
    );
    return result.rows[0] || null;
  }

  async function getOwnerJob({ jobId, ownerProfileId }) {
    assertOwner(ownerProfileId);
    const result = await database.query(
      'SELECT * FROM transcription_jobs WHERE id = $1 AND owner_profile_id = $2',
      [assertUuid(jobId, 'job id'), ownerProfileId],
    );
    return result.rows[0] || null;
  }

  async function listOwnerJobs({ ownerProfileId, limit = 50 }) {
    assertOwner(ownerProfileId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw transcriptionStoreError('transcription_invalid_value', 'Invalid job-list limit.', 400);
    }
    const result = await database.query(
      `SELECT * FROM transcription_jobs
        WHERE owner_profile_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT $2`,
      [ownerProfileId, limit],
    );
    return result.rows;
  }

  async function createJob({
    id = crypto.randomUUID(), ownerProfileId, idempotencyKey, originalFilename,
    declaredContentType, declaredBytes, inputPathname, providerRegion = 'us',
    requestedModel, optionsSnapshot = {}, expiresAt, receiptExpiresAt,
  }) {
    assertOwner(ownerProfileId);
    id = assertUuid(id, 'job id');
    idempotencyKey = assertUuid(idempotencyKey, 'idempotency key');
    if (!['us', 'eu'].includes(providerRegion)) throw transcriptionStoreError('transcription_invalid_value', 'Invalid provider region.', 400);
    if (!Number.isInteger(declaredBytes) || declaredBytes < 1 || declaredBytes > 52428800) throw transcriptionStoreError('transcription_invalid_value', 'Audio must be at most 50 MiB.', 400);
    if (typeof originalFilename !== 'string' || !originalFilename.trim() || originalFilename.length > 255
      || typeof declaredContentType !== 'string' || declaredContentType.length > 128
      || typeof inputPathname !== 'string' || !inputPathname.startsWith('transcription-pilot/')
      || typeof requestedModel !== 'string' || !requestedModel.trim() || requestedModel.length > 128
      || !optionsSnapshot || typeof optionsSnapshot !== 'object' || Array.isArray(optionsSnapshot)) {
      throw transcriptionStoreError('transcription_invalid_value', 'Invalid transcription job metadata.', 400);
    }
    const inserted = await database.query(
      `INSERT INTO transcription_jobs (
         id, owner_profile_id, idempotency_key, original_filename, declared_content_type,
         declared_bytes, input_cleanup_pathname, provider_region, requested_model,
         options_snapshot, expires_at, receipt_expires_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)
       ON CONFLICT (owner_profile_id, idempotency_key) DO NOTHING
       RETURNING *`,
      [id, ownerProfileId, idempotencyKey, originalFilename.trim(), declaredContentType,
        declaredBytes, inputPathname, providerRegion, requestedModel.trim(), JSON.stringify(optionsSnapshot), expiresAt, receiptExpiresAt],
    );
    if (inserted.rows[0]) return { job: inserted.rows[0], created: true };
    const existing = await database.query(
      'SELECT * FROM transcription_jobs WHERE owner_profile_id = $1 AND idempotency_key = $2',
      [ownerProfileId, idempotencyKey],
    );
    const row = existing.rows[0];
    if (!row || row.original_filename !== originalFilename.trim()
      || row.declared_content_type !== declaredContentType || Number(row.declared_bytes) !== declaredBytes
      || row.provider_region !== providerRegion || row.requested_model !== requestedModel.trim()
      || stableJson(row.options_snapshot) !== stableJson(optionsSnapshot)) {
      throw transcriptionStoreError('transcription_idempotency_conflict', 'That idempotency key was already used for different audio metadata.');
    }
    return { job: row, created: false };
  }

  async function reserveUploadWindow({ jobId, ownerProfileId, validUntil }) {
    assertOwner(ownerProfileId);
    const until = new Date(validUntil);
    if (!Number.isFinite(until.getTime()) || until <= new Date() || until.getTime() > Date.now() + 16 * 60_000) {
      throw transcriptionStoreError('transcription_invalid_value', 'Invalid upload window.', 400);
    }
    const result = await database.query(
      `UPDATE transcription_jobs SET upload_valid_until = GREATEST(upload_valid_until, $3),
         updated_at = NOW(), version = version + 1
       WHERE id = $1 AND owner_profile_id = $2 AND status = 'uploading'
         AND cleanup_requested_at IS NULL AND expires_at > $3 RETURNING *`,
      [assertUuid(jobId, 'job id'), ownerProfileId, until],
    );
    return result.rows[0] || null;
  }

  async function queueJob({ jobId, ownerProfileId, expectedVersion, acknowledgementAt, verifiedContentType, verifiedBytes, durationMs, sha256, etag }) {
    assertOwner(ownerProfileId);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw transcriptionStoreError('transcription_invalid_value', 'Invalid job version.', 400);
    if (!Number.isInteger(verifiedBytes) || verifiedBytes < 1 || verifiedBytes > 52428800
      || !Number.isInteger(durationMs) || durationMs < 1 || durationMs > 14400000) {
      throw transcriptionStoreError('transcription_invalid_value', 'Audio size or duration is outside the pilot limit.', 400);
    }
    const result = await database.query(
      `WITH queued AS (
       UPDATE transcription_jobs SET
         status = 'queued', non_sensitive_acknowledged_at = $4,
         verified_content_type = $5, verified_bytes = $6, audio_duration_ms = $7,
         audio_sha256 = $8, audio_etag = $9, audio_pathname = input_cleanup_pathname,
         expires_at = NOW() + INTERVAL '7 days',
         updated_at = NOW(), version = version + 1
       WHERE id = $1 AND owner_profile_id = $2 AND version = $3
         AND status = 'uploading' AND cleanup_requested_at IS NULL
         AND expires_at > NOW()
       RETURNING *
       ), dispatch AS (
         INSERT INTO transcription_workflow_dispatches (job_id)
         SELECT id FROM queued
         ON CONFLICT (job_id) DO NOTHING
         RETURNING job_id
       )
       SELECT queued.* FROM queued LEFT JOIN dispatch ON dispatch.job_id = queued.id`,
      [assertUuid(jobId, 'job id'), ownerProfileId, expectedVersion, acknowledgementAt,
        verifiedContentType, verifiedBytes, durationMs, normalizeHash(sha256, 'audio SHA-256'), etag || null],
    );
    return result.rows[0] || null;
  }

  async function getWorkflowDispatch({ jobId }) {
    const result = await database.query(
      `SELECT job_id, state, attempt_no, next_attempt_at, last_error_code
         FROM transcription_workflow_dispatches WHERE job_id = $1`,
      [assertUuid(jobId, 'job id')],
    );
    return result.rows[0] || null;
  }

  async function claimWorkflowDispatch({ jobId, ownerProfileId, leaseSeconds = 300, manual = false } = {}) {
    if (ownerProfileId != null) assertOwner(ownerProfileId);
    if (!Number.isInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 300) {
      throw transcriptionStoreError('transcription_invalid_value', 'Invalid workflow dispatch lease.', 400);
    }
    const token = crypto.randomUUID();
    const result = await database.query(
      `WITH candidate AS (
         SELECT dispatch.job_id
           FROM transcription_workflow_dispatches dispatch
           JOIN transcription_jobs job ON job.id = dispatch.job_id
          WHERE ($1::uuid IS NULL OR dispatch.job_id = $1)
            AND ($2::integer IS NULL OR job.owner_profile_id = $2)
            AND job.status IN ('queued','submitting','processing','saving','submission_uncertain')
            AND job.cleanup_requested_at IS NULL
            AND job.expires_at > NOW()
            AND ((dispatch.state = 'pending' AND ($5::boolean OR dispatch.next_attempt_at <= NOW()))
              OR (dispatch.state = 'dispatching' AND dispatch.lease_expires_at <= NOW()))
          ORDER BY dispatch.next_attempt_at, dispatch.created_at, dispatch.job_id
          FOR UPDATE OF dispatch SKIP LOCKED LIMIT 1
       )
       UPDATE transcription_workflow_dispatches dispatch SET
         state = 'dispatching', attempt_no = dispatch.attempt_no + 1,
         dispatch_token = $3, lease_expires_at = NOW() + ($4 || ' seconds')::interval,
         workflow_run_id = NULL, updated_at = NOW()
        FROM candidate WHERE dispatch.job_id = candidate.job_id
       RETURNING dispatch.job_id, dispatch.state, dispatch.attempt_no,
         dispatch.dispatch_token, dispatch.lease_expires_at, dispatch.next_attempt_at`,
      [jobId ? assertUuid(jobId, 'job id') : null, ownerProfileId ?? null, token, leaseSeconds, manual === true],
    );
    return result.rows[0] || null;
  }

  async function acknowledgeWorkflowDispatch({ jobId, dispatchToken, attemptNo, workflowRunId }) {
    if (!Number.isInteger(attemptNo) || attemptNo < 1 || typeof workflowRunId !== 'string'
      || !/^[A-Za-z0-9_-]{1,128}$/.test(workflowRunId)) {
      throw transcriptionStoreError('transcription_invalid_value', 'Invalid workflow dispatch acknowledgement.', 400);
    }
    const result = await database.query(
      `UPDATE transcription_workflow_dispatches SET state = 'running', workflow_run_id = $4,
         dispatch_token = NULL, lease_expires_at = NULL, last_error_code = NULL,
         updated_at = NOW()
       WHERE job_id = $1 AND dispatch_token = $2 AND attempt_no = $3
         AND state = 'dispatching' AND lease_expires_at > NOW()
       RETURNING job_id, state, attempt_no`,
      [assertUuid(jobId, 'job id'), assertUuid(dispatchToken, 'dispatch token'), attemptNo, workflowRunId],
    );
    return result.rows[0] || null;
  }

  async function failWorkflowDispatch({ jobId, dispatchToken, attemptNo, errorCode = 'workflow_start_failed', retryAfterSeconds = 30 }) {
    if (!/^[a-z0-9_]{1,64}$/.test(errorCode) || !Number.isInteger(attemptNo) || attemptNo < 1
      || !Number.isInteger(retryAfterSeconds) || retryAfterSeconds < 1 || retryAfterSeconds > 3600) {
      throw transcriptionStoreError('transcription_invalid_value', 'Invalid workflow dispatch failure.', 400);
    }
    const result = await database.query(
      `UPDATE transcription_workflow_dispatches SET state = 'pending', dispatch_token = NULL,
         lease_expires_at = NULL, next_attempt_at = NOW() + ($4 || ' seconds')::interval,
         last_error_code = $5, updated_at = NOW()
       WHERE job_id = $1 AND dispatch_token = $2 AND attempt_no = $3
         AND state = 'dispatching' AND lease_expires_at > NOW()
       RETURNING job_id, state, attempt_no, next_attempt_at, last_error_code`,
      [assertUuid(jobId, 'job id'), assertUuid(dispatchToken, 'dispatch token'), attemptNo, retryAfterSeconds, errorCode],
    );
    return result.rows[0] || null;
  }

  async function expireUnacknowledgedWorkflowDispatch({ jobId, attemptNo, retryAfterSeconds = 30 }) {
    if (!Number.isInteger(attemptNo) || attemptNo < 1 || !Number.isInteger(retryAfterSeconds)
      || retryAfterSeconds < 1 || retryAfterSeconds > 3600) {
      throw transcriptionStoreError('transcription_invalid_value', 'Invalid workflow acknowledgement timeout.', 400);
    }
    const result = await database.query(
      `UPDATE transcription_workflow_dispatches SET state = 'pending', dispatch_token = NULL,
         lease_expires_at = NULL, next_attempt_at = NOW() + ($3 || ' seconds')::interval,
         last_error_code = 'workflow_ack_timeout', updated_at = NOW()
       WHERE job_id = $1 AND attempt_no = $2 AND state = 'dispatching'
         AND lease_expires_at <= NOW()
       RETURNING job_id, state, attempt_no, next_attempt_at`,
      [assertUuid(jobId, 'job id'), attemptNo, retryAfterSeconds],
    );
    return result.rows[0] || null;
  }

  async function finishWorkflowDispatch({ jobId, attemptNo, retryAt = null }) {
    if (!Number.isInteger(attemptNo) || attemptNo < 1) throw transcriptionStoreError('transcription_invalid_value', 'Invalid workflow attempt.', 400);
    const result = await database.query(
      `UPDATE transcription_workflow_dispatches SET
         state = CASE WHEN $3::timestamptz IS NULL THEN 'completed' ELSE 'pending' END,
         next_attempt_at = COALESCE($3::timestamptz, next_attempt_at),
         workflow_run_id = NULL, last_error_code = NULL, updated_at = NOW()
       WHERE job_id = $1 AND attempt_no = $2 AND state = 'running'
       RETURNING job_id, state, attempt_no, next_attempt_at`,
      [assertUuid(jobId, 'job id'), attemptNo, retryAt],
    );
    return result.rows[0] || null;
  }

  async function rearmWorkflowDispatch({ jobId }) {
    const result = await database.query(
      `UPDATE transcription_workflow_dispatches dispatch SET state = 'pending',
         dispatch_token = NULL, lease_expires_at = NULL,
         next_attempt_at = NOW(), workflow_run_id = NULL, last_error_code = NULL, updated_at = NOW()
        FROM transcription_jobs job
       WHERE dispatch.job_id = $1 AND job.id = dispatch.job_id
         AND ((job.status = 'queued' AND dispatch.state IN ('completed', 'pending'))
           OR (job.status = 'submission_uncertain' AND job.provider_id_conflict = FALSE
             AND (job.provider_transcript_id IS NOT NULL OR job.callback_candidate_transcript_id IS NOT NULL)))
       RETURNING dispatch.job_id, dispatch.state, dispatch.attempt_no`,
      [assertUuid(jobId, 'job id')],
    );
    return result.rows[0] || null;
  }

  async function checkWorkflowDispatchAttempt({ jobId, attemptNo }) {
    const result = await database.query(
      `SELECT state, attempt_no FROM transcription_workflow_dispatches WHERE job_id = $1`,
      [assertUuid(jobId, 'job id')],
    );
    const row = result.rows[0];
    if (!row || Number(row.attempt_no) !== attemptNo) return 'stale';
    return row.state === 'running' ? 'running' : row.state === 'dispatching' ? 'waiting' : 'stale';
  }

  async function touchWorkflowDispatch({ jobId, attemptNo, workflowRunId = null }) {
    const result = await database.query(
      `UPDATE transcription_workflow_dispatches SET updated_at = NOW()
       WHERE job_id = $1 AND attempt_no = $2 AND state = 'running'
         AND ($3::text IS NULL OR workflow_run_id = $3)
       RETURNING job_id`,
      [assertUuid(jobId, 'job id'), attemptNo, workflowRunId],
    );
    return Boolean(result.rows[0]);
  }

  async function listRunningWorkflowDispatches({ limit = 20 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw transcriptionStoreError('transcription_invalid_value', 'Invalid workflow recovery limit.', 400);
    const result = await database.query(
      `SELECT dispatch.job_id, dispatch.workflow_run_id, dispatch.attempt_no
         FROM transcription_workflow_dispatches dispatch
         JOIN transcription_jobs job ON job.id = dispatch.job_id
        WHERE dispatch.state = 'running' AND dispatch.workflow_run_id IS NOT NULL
          AND job.expires_at > NOW()
          AND job.cleanup_requested_at IS NULL
          AND ((job.status IN ('queued','submitting','processing','saving'))
            OR (job.status = 'submission_uncertain' AND job.provider_id_conflict = FALSE
              AND (job.provider_transcript_id IS NOT NULL OR job.callback_candidate_transcript_id IS NOT NULL)))
        ORDER BY dispatch.updated_at, dispatch.job_id
        LIMIT $1`,
      [limit],
    );
    return result.rows;
  }

  async function recoverTerminalWorkflowDispatch({ jobId, workflowRunId, attemptNo, terminalStatus }) {
    if (!Number.isInteger(attemptNo) || attemptNo < 1
      || typeof workflowRunId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(workflowRunId)
      || !['completed', 'failed', 'cancelled'].includes(terminalStatus)) {
      throw transcriptionStoreError('transcription_invalid_value', 'Invalid terminal workflow recovery.', 400);
    }
    const result = await database.query(
      `UPDATE transcription_workflow_dispatches dispatch SET state = 'pending',
         dispatch_token = NULL, lease_expires_at = NULL, workflow_run_id = NULL,
         next_attempt_at = NOW(), last_error_code = $4, updated_at = NOW()
        FROM transcription_jobs job
       WHERE dispatch.job_id = $1 AND job.id = dispatch.job_id
         AND dispatch.state = 'running' AND dispatch.workflow_run_id = $2 AND dispatch.attempt_no = $3
         AND job.expires_at > NOW() AND job.cleanup_requested_at IS NULL
         AND ((job.status IN ('queued','submitting','processing','saving'))
           OR (job.status = 'submission_uncertain' AND job.provider_id_conflict = FALSE
             AND (job.provider_transcript_id IS NOT NULL OR job.callback_candidate_transcript_id IS NOT NULL)))
       RETURNING dispatch.job_id, dispatch.attempt_no`,
      [assertUuid(jobId, 'job id'), workflowRunId, attemptNo, `workflow_${terminalStatus}`],
    );
    return result.rows[0] || null;
  }

  async function claimQueuedJob({ jobId, leaseSeconds = LEASE_SECONDS } = {}) {
    if (!Number.isInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > LEASE_SECONDS) {
      throw transcriptionStoreError('transcription_invalid_value', 'Invalid lease duration.', 400);
    }
    const leaseToken = crypto.randomUUID();
    try {
      const result = await database.query(
        `UPDATE transcription_jobs SET
           status = 'submitting', lease_token = $2,
           lease_expires_at = NOW() + ($3 || ' seconds')::interval,
           attempts = attempts + 1, updated_at = NOW(), version = version + 1
         WHERE id = $1 AND status = 'queued' AND cleanup_requested_at IS NULL
           AND next_attempt_at <= NOW() AND expires_at > NOW()
           AND audio_pathname IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM transcription_jobs active
              WHERE active.status IN ('submitting','processing','saving','submission_uncertain')
           )
         RETURNING *`,
        [jobId ? assertUuid(jobId, 'job id') : null, leaseToken, leaseSeconds],
      );
      return result.rows[0] || null;
    } catch (error) {
      if (error.code === '23505' && error.constraint === 'idx_transcription_jobs_global_active_slot') return null;
      throw error;
    }
  }

  async function claimNextQueuedJob({ leaseSeconds = LEASE_SECONDS } = {}) {
    if (!Number.isInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > LEASE_SECONDS) {
      throw transcriptionStoreError('transcription_invalid_value', 'Invalid lease duration.', 400);
    }
    const leaseToken = crypto.randomUUID();
    try {
      const result = await database.query(
        `WITH candidate AS (
           SELECT id FROM transcription_jobs
            WHERE status = 'queued' AND cleanup_requested_at IS NULL
              AND next_attempt_at <= NOW() AND expires_at > NOW()
              AND audio_pathname IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM transcription_jobs active
                 WHERE active.status IN ('submitting','processing','saving','submission_uncertain')
              )
            ORDER BY created_at, id
            FOR UPDATE SKIP LOCKED LIMIT 1
         )
         UPDATE transcription_jobs job SET
           status = 'submitting', lease_token = $1,
           lease_expires_at = NOW() + ($2 || ' seconds')::interval,
           attempts = attempts + 1, updated_at = NOW(), version = version + 1
          FROM candidate WHERE job.id = candidate.id
         RETURNING job.*`,
        [leaseToken, leaseSeconds],
      );
      return result.rows[0] || null;
    } catch (error) {
      if (error.code === '23505' && error.constraint === 'idx_transcription_jobs_global_active_slot') return null;
      throw error;
    }
  }

  async function setProviderUploadReference({ jobId, leaseToken, expectedVersion, ciphertext }) {
    if (typeof ciphertext !== 'string' || ciphertext.length < 1 || ciphertext.length > 8192) {
      throw transcriptionStoreError('transcription_invalid_value', 'Invalid encrypted provider upload reference.', 400);
    }
    const result = await database.query(
      `UPDATE transcription_jobs SET provider_upload_ref_ciphertext = $4,
         updated_at = NOW(), version = version + 1
       WHERE id = $1 AND lease_token = $2 AND lease_expires_at > NOW()
         AND version = $3 AND status = 'submitting'
         AND submission_intent_at IS NULL AND provider_upload_ref_ciphertext IS NULL
         AND cleanup_requested_at IS NULL
       RETURNING *`,
      [assertUuid(jobId, 'job id'), assertUuid(leaseToken, 'lease token'), expectedVersion, ciphertext],
    );
    return result.rows[0] || null;
  }

  async function mutateLeasedJob({ jobId, leaseToken, expectedVersion, expectedStatuses, fields, allowCleanup = false }) {
    const id = assertUuid(jobId, 'job id');
    const token = assertUuid(leaseToken, 'lease token');
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw transcriptionStoreError('transcription_invalid_value', 'Invalid job version.', 400);
    if (!Array.isArray(expectedStatuses) || !expectedStatuses.length || expectedStatuses.some(status => !STATUS_VALUES.includes(status))) {
      throw transcriptionStoreError('transcription_invalid_value', 'Invalid worker states.', 400);
    }
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw transcriptionStoreError('transcription_invalid_value', 'Invalid job update.', 400);
    const entries = Object.entries(fields);
    if (!entries.length || entries.some(([field]) => !MUTABLE_FIELDS.has(field) || field === 'attempt_correlation_id')) {
      throw transcriptionStoreError('transcription_immutable_field', 'The update contains a non-mutable job field.', 400);
    }
    const params = [id, token, expectedVersion];
    const assignments = entries.map(([field, value]) => {
      params.push(JSON_FIELDS.has(field) ? JSON.stringify(value) : value);
      return `${field} = ${fieldExpression(field, params.length)}`;
    });
    assignments.push('updated_at = NOW()', 'version = version + 1');
    params.push(expectedStatuses);
    const cleanupClause = allowCleanup ? '' : 'AND cleanup_requested_at IS NULL';
    const result = await database.query(
      `UPDATE transcription_jobs SET ${assignments.join(', ')}
        WHERE id = $1 AND lease_token = $2 AND lease_expires_at > NOW()
          AND version = $3 AND status = ANY($${params.length}::text[]) ${cleanupClause}
        RETURNING *`,
      params,
    );
    return result.rows[0] || null;
  }

  async function releaseLease({ jobId, leaseToken, expectedVersion, expectedStatuses }) {
    if (!Array.isArray(expectedStatuses) || !expectedStatuses.length || expectedStatuses.some(s => !STATUS_VALUES.includes(s))) {
      throw transcriptionStoreError('transcription_invalid_value', 'Invalid worker states.', 400);
    }
    const result = await database.query(
      `UPDATE transcription_jobs SET lease_token = NULL, lease_expires_at = NULL,
         updated_at = NOW(), version = version + 1
       WHERE id = $1 AND lease_token = $2 AND lease_expires_at > NOW()
         AND version = $3 AND status = ANY($4::text[])
       RETURNING *`,
      [assertUuid(jobId, 'job id'), assertUuid(leaseToken, 'lease token'), expectedVersion, expectedStatuses],
    );
    return result.rows[0] || null;
  }

  async function beginProviderSubmission({ jobId, leaseToken, expectedVersion }) {
    const correlationId = crypto.randomUUID();
    const result = await database.query(
      `UPDATE transcription_jobs SET attempt_correlation_id = $4,
         submission_intent_at = NOW(), updated_at = NOW(), version = version + 1
       WHERE id = $1 AND lease_token = $2 AND lease_expires_at > NOW()
         AND version = $3 AND status = 'submitting'
         AND provider_upload_ref_ciphertext IS NOT NULL
         AND attempt_correlation_id IS NULL AND submission_intent_at IS NULL
         AND cleanup_requested_at IS NULL
       RETURNING *`,
      [assertUuid(jobId, 'job id'), assertUuid(leaseToken, 'lease token'), expectedVersion, correlationId],
    );
    return result.rows[0] || null;
  }

  async function requeueExpiredPreIntentSubmissions({ jobId, limit = 20 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw transcriptionStoreError('transcription_invalid_value', 'Invalid batch limit.', 400);
    const result = await database.query(
      `WITH stale AS (
         SELECT id FROM transcription_jobs
          WHERE ($1::uuid IS NULL OR id = $1)
            AND status = 'submitting' AND submission_intent_at IS NULL AND lease_expires_at <= NOW()
          ORDER BY lease_expires_at, id FOR UPDATE SKIP LOCKED LIMIT $2
       )
       UPDATE transcription_jobs job SET status = CASE WHEN job.cleanup_requested_at IS NULL THEN 'queued' ELSE 'expired' END, lease_token = NULL,
         lease_expires_at = NULL, next_attempt_at = NOW(), updated_at = NOW(), version = version + 1
        FROM stale WHERE job.id = stale.id
       RETURNING job.*`,
      [jobId ? assertUuid(jobId, 'job id') : null, limit],
    );
    return result.rows;
  }

  async function markExpiredSubmittingUncertain({ jobId, limit = 20 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw transcriptionStoreError('transcription_invalid_value', 'Invalid batch limit.', 400);
    const result = await database.query(
      `WITH stale AS (
         SELECT id FROM transcription_jobs
          WHERE ($1::uuid IS NULL OR id = $1)
            AND status = 'submitting' AND submission_intent_at IS NOT NULL AND lease_expires_at <= NOW()
          ORDER BY lease_expires_at, id
          FOR UPDATE SKIP LOCKED LIMIT $2
       )
       UPDATE transcription_jobs job SET status = 'submission_uncertain',
         lease_token = NULL, lease_expires_at = NULL, updated_at = NOW(), version = version + 1
        FROM stale WHERE job.id = stale.id
       RETURNING job.*`,
      [jobId ? assertUuid(jobId, 'job id') : null, limit],
    );
    return result.rows;
  }

  async function claimNextDueJob({ jobId, leaseSeconds = LEASE_SECONDS } = {}) {
    if (!Number.isInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > LEASE_SECONDS) {
      throw transcriptionStoreError('transcription_invalid_value', 'Invalid lease duration.', 400);
    }
    const leaseToken = crypto.randomUUID();
    const result = await database.query(
      `WITH candidate AS (
         SELECT id FROM transcription_jobs
          WHERE ($1::uuid IS NULL OR id = $1)
            AND status IN ('processing','saving','submission_uncertain')
            AND cleanup_requested_at IS NULL AND expires_at > NOW()
            AND next_attempt_at <= NOW() AND (lease_token IS NULL OR lease_expires_at <= NOW())
            AND (status <> 'submission_uncertain' OR (
              provider_id_conflict = FALSE
              AND (provider_transcript_id IS NOT NULL OR callback_candidate_transcript_id IS NOT NULL)))
          ORDER BY next_attempt_at, created_at, id
          FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE transcription_jobs job SET lease_token = $2,
         lease_expires_at = NOW() + ($3 || ' seconds')::interval,
         updated_at = NOW(), version = version + 1
        FROM candidate WHERE job.id = candidate.id
       RETURNING job.*`,
      [jobId ? assertUuid(jobId, 'job id') : null, leaseToken, leaseSeconds],
    );
    return result.rows[0] ? { job: result.rows[0], leaseToken } : null;
  }

  async function publishReady({ jobId, leaseToken, expectedVersion, outputPathname, outputSha256, diagnosticPathname = null, diagnosticSha256 = null, returnedModel = null }) {
    if (typeof outputPathname !== 'string' || !outputPathname.startsWith('transcription-pilot/')) {
      throw transcriptionStoreError('transcription_invalid_value', 'Invalid transcript output path.', 400);
    }
    if (diagnosticPathname != null && (typeof diagnosticPathname !== 'string' || !diagnosticPathname.startsWith('transcription-pilot/'))) {
      throw transcriptionStoreError('transcription_invalid_value', 'Invalid diagnostic output path.', 400);
    }
    const outputDigest = normalizeHash(outputSha256, 'transcript SHA-256');
    if (!outputDigest) throw transcriptionStoreError('transcription_invalid_value', 'Transcript output hash is required.', 400);
    const result = await database.query(
      `UPDATE transcription_jobs SET status = 'ready', output_pathname = $4,
         output_cleanup_pathname = $4, output_sha256 = $5,
         diagnostic_pathname = $6, diagnostic_cleanup_pathname = $6,
         diagnostic_sha256 = $7, returned_model = $8, ready_at = NOW(),
         expires_at = NOW() + INTERVAL '7 days',
         receipt_expires_at = NOW() + INTERVAL '30 days',
         updated_at = NOW(), version = version + 1
       WHERE id = $1 AND lease_token = $2 AND lease_expires_at > NOW()
         AND version = $3 AND status = 'saving'
         AND provider_transcript_id IS NOT NULL AND provider_id_conflict = FALSE
         AND cleanup_requested_at IS NULL
         AND output_sha256 IS NULL AND content_purged_at IS NULL
       RETURNING *`,
      [assertUuid(jobId, 'job id'), assertUuid(leaseToken, 'lease token'), expectedVersion,
        outputPathname, outputDigest, diagnosticPathname,
        normalizeHash(diagnosticSha256, 'diagnostic SHA-256'), returnedModel],
    );
    return result.rows[0] || null;
  }

  async function markAudioDeleted({ jobId, leaseToken, expectedVersion, expectedPathname }) {
    const result = await database.query(
      `UPDATE transcription_jobs SET audio_pathname = NULL,
         input_cleanup_pathname = CASE WHEN upload_valid_until IS NULL THEN NULL ELSE input_cleanup_pathname END,
         audio_deleted_at = COALESCE(audio_deleted_at, NOW()), updated_at = NOW(), version = version + 1
       WHERE id = $1 AND lease_token = $2 AND lease_expires_at > NOW()
         AND version = $3 AND status = 'ready'
         AND input_cleanup_pathname = $4
       RETURNING *`,
      [assertUuid(jobId, 'job id'), assertUuid(leaseToken, 'lease token'), expectedVersion, expectedPathname],
    );
    return result.rows[0] || null;
  }

  async function markProviderDeletionCompleted({ jobId, leaseToken, expectedVersion }) {
    const result = await database.query(
      `UPDATE transcription_jobs SET
         status = CASE WHEN cleanup_requested_at IS NOT NULL
                        AND status IN ('submitting','processing','saving','submission_uncertain')
                       THEN 'failed'
                       WHEN cleanup_requested_at IS NOT NULL AND status = 'ready' THEN 'expired'
                       ELSE status END,
         provider_cleanup_completed_at = COALESCE(provider_cleanup_completed_at, NOW()),
         provider_transcript_id = NULL, callback_candidate_transcript_id = NULL,
         conflicting_transcript_id = NULL, provider_id_conflict = FALSE,
         attempt_correlation_id = NULL, provider_upload_ref_ciphertext = NULL,
         reference_purged_at = COALESCE(reference_purged_at, NOW()),
         sanitized_error_code = CASE WHEN cleanup_requested_at IS NOT NULL
                                    THEN 'cleanup_completed' ELSE sanitized_error_code END,
         updated_at = NOW(), version = version + 1
       WHERE id = $1 AND lease_token = $2 AND lease_expires_at > NOW()
         AND version = $3 AND provider_transcript_id IS NOT NULL
         AND provider_id_conflict = FALSE
         AND provider_cleanup_completed_at IS NULL
       RETURNING *`,
      [assertUuid(jobId, 'job id'), assertUuid(leaseToken, 'lease token'), expectedVersion],
    );
    return result.rows[0] || null;
  }

  async function recordCallbackCandidate({ attemptCorrelationId, providerTranscriptId }) {
    const correlationId = assertUuid(attemptCorrelationId, 'callback correlation id');
    if (typeof providerTranscriptId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(providerTranscriptId)) {
      throw transcriptionStoreError('transcription_invalid_value', 'Invalid provider transcript ID.', 400);
    }
    const result = await database.query(
      `UPDATE transcription_jobs SET
         provider_id_conflict = provider_id_conflict
           OR (provider_transcript_id IS NOT NULL AND provider_transcript_id <> $2)
           OR (callback_candidate_transcript_id IS NOT NULL AND callback_candidate_transcript_id <> $2),
         conflicting_transcript_id = CASE
           WHEN (provider_transcript_id IS NOT NULL AND provider_transcript_id <> $2)
             THEN COALESCE(conflicting_transcript_id, $2)
           WHEN (callback_candidate_transcript_id IS NOT NULL AND callback_candidate_transcript_id <> $2)
             THEN COALESCE(conflicting_transcript_id, $2)
           ELSE conflicting_transcript_id END,
         callback_candidate_transcript_id = COALESCE(callback_candidate_transcript_id, $2),
         updated_at = NOW(), version = version + 1
       WHERE attempt_correlation_id = $1
         AND status IN ('submitting','submission_uncertain','processing','saving')
         AND (provider_transcript_id IS NULL OR provider_transcript_id = $2
           OR callback_candidate_transcript_id IS NULL OR callback_candidate_transcript_id = $2)
       RETURNING *`,
      [correlationId, providerTranscriptId],
    );
    if (result.rows[0]) return { recorded: true, job: result.rows[0] };
    // A differing callback is still durable restricted metadata: first candidate stays immutable.
    const conflict = await database.query(
      `UPDATE transcription_jobs SET provider_id_conflict = TRUE,
         conflicting_transcript_id = COALESCE(conflicting_transcript_id, $2),
         updated_at = NOW(), version = version + 1
       WHERE attempt_correlation_id = $1
         AND status IN ('submitting','submission_uncertain','processing','saving')
         AND (provider_transcript_id IS NOT NULL OR callback_candidate_transcript_id IS NOT NULL)
       RETURNING *`,
      [correlationId, providerTranscriptId],
    );
    return conflict.rows[0] ? { recorded: true, conflict: true, job: conflict.rows[0] } : { recorded: false, job: null };
  }

  async function bindVerifiedProviderId({ jobId, leaseToken, expectedVersion, providerTranscriptId }) {
    const transcriptId = String(providerTranscriptId || '');
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(transcriptId)) throw transcriptionStoreError('transcription_invalid_value', 'Invalid provider transcript ID.', 400);
    return database.transaction(async tx => {
      const current = await tx.query(
        `SELECT * FROM transcription_jobs WHERE id = $1 AND lease_token = $2
           AND lease_expires_at > NOW() AND version = $3
           AND status IN ('submitting','submission_uncertain')
         FOR UPDATE`,
        [assertUuid(jobId, 'job id'), assertUuid(leaseToken, 'lease token'), expectedVersion],
      );
      const job = current.rows[0];
      if (!job) return null;
      const callbackId = job.callback_candidate_transcript_id;
      if (job.provider_id_conflict || (callbackId && callbackId !== transcriptId)) {
        const conflict = await tx.query(
          `UPDATE transcription_jobs SET status = 'submission_uncertain',
             provider_id_conflict = TRUE, conflicting_transcript_id = COALESCE(conflicting_transcript_id, $4),
             updated_at = NOW(), version = version + 1
           WHERE id = $1 AND lease_token = $2 AND lease_expires_at > NOW() AND version = $3
           RETURNING *`,
          [job.id, leaseToken, expectedVersion, transcriptId],
        );
        return conflict.rows[0] ? { job: conflict.rows[0], conflict: true } : null;
      }
      const bound = await tx.query(
        `UPDATE transcription_jobs SET provider_transcript_id = $4,
           status = CASE WHEN status IN ('submitting','submission_uncertain')
                              AND cleanup_requested_at IS NULL THEN 'processing' ELSE status END,
           updated_at = NOW(), version = version + 1
         WHERE id = $1 AND lease_token = $2 AND lease_expires_at > NOW() AND version = $3
           AND provider_id_conflict = FALSE
           AND (provider_transcript_id IS NULL OR provider_transcript_id = $4)
         RETURNING *`,
        [job.id, leaseToken, expectedVersion, transcriptId],
      );
      if (bound.rows[0]) return { job: bound.rows[0], conflict: false };
      return null;
    }).catch(error => {
      if (error.code === '23505' && error.constraint === 'transcription_jobs_provider_transcript_id_key') {
        throw transcriptionStoreError('transcription_provider_id_conflict', 'That provider job is already bound to another transcription.');
      }
      throw error;
    });
  }

  async function reconcileVerifiedProviderId({ jobId, ownerProfileId, leaseToken, expectedVersion, providerTranscriptId }) {
    assertOwner(ownerProfileId);
    if (typeof providerTranscriptId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(providerTranscriptId)) {
      throw transcriptionStoreError('transcription_invalid_value', 'Invalid provider transcript ID.', 400);
    }
    try {
      const result = await database.query(
      `WITH reconciled AS (
       UPDATE transcription_jobs SET provider_transcript_id = $5,
           status = CASE WHEN cleanup_requested_at IS NULL THEN 'processing' ELSE status END,
           provider_id_conflict = FALSE,
           callback_candidate_transcript_id = NULL,
           conflicting_transcript_id = NULL, sanitized_error_code = NULL,
           updated_at = NOW(), version = version + 1
         WHERE id = $1 AND owner_profile_id = $2 AND lease_token = $3
           AND lease_expires_at > NOW() AND version = $4
           AND status = 'submission_uncertain'
           AND provider_upload_ref_ciphertext IS NOT NULL
         RETURNING *
       ), rearmed AS (
         UPDATE transcription_workflow_dispatches dispatch SET state = 'pending',
           dispatch_token = NULL, lease_expires_at = NULL,
           next_attempt_at = NOW(), workflow_run_id = NULL, last_error_code = NULL, updated_at = NOW()
          FROM reconciled job
         WHERE dispatch.job_id = job.id AND job.cleanup_requested_at IS NULL
         RETURNING dispatch.job_id
       )
       SELECT reconciled.* FROM reconciled`,
        [assertUuid(jobId, 'job id'), ownerProfileId, assertUuid(leaseToken, 'lease token'), expectedVersion, providerTranscriptId],
      );
      return result.rows[0] || null;
    } catch (error) {
      if (error.code === '23505' && error.constraint === 'transcription_jobs_provider_transcript_id_key') {
        throw transcriptionStoreError('transcription_provider_id_conflict', 'That provider job is already bound to another transcription.');
      }
      throw error;
    }
  }

  async function abandonUncertain({ jobId, ownerProfileId, expectedVersion, acknowledged }) {
    assertOwner(ownerProfileId);
    if (acknowledged !== true) throw transcriptionStoreError('transcription_abandon_ack_required', 'Explicit acknowledgement is required.', 400);
    const result = await database.query(
      `UPDATE transcription_jobs SET status = 'failed', lease_token = NULL, lease_expires_at = NULL,
         abandonment_acknowledged = TRUE, abandoned_at = NOW(), cleanup_requested_at = COALESCE(cleanup_requested_at, NOW()),
         original_filename = NULL, correction_notes = NULL, speaker_names = '{}'::jsonb,
         sanitized_error_code = 'submission_abandoned', updated_at = NOW(), version = version + 1
       WHERE id = $1 AND owner_profile_id = $2 AND version = $3
         AND status = 'submission_uncertain' AND (lease_token IS NULL OR lease_expires_at <= NOW())
       RETURNING *`,
      [assertUuid(jobId, 'job id'), ownerProfileId, expectedVersion],
    );
    return result.rows[0] || null;
  }

  async function claimUncertainForReconcile({ jobId, ownerProfileId, leaseSeconds = LEASE_SECONDS }) {
    assertOwner(ownerProfileId);
    if (!Number.isInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > LEASE_SECONDS) {
      throw transcriptionStoreError('transcription_invalid_value', 'Invalid lease duration.', 400);
    }
    const leaseToken = crypto.randomUUID();
    const result = await database.query(
      `UPDATE transcription_jobs SET lease_token = $3,
         lease_expires_at = NOW() + ($4 || ' seconds')::interval,
         updated_at = NOW(), version = version + 1
       WHERE id = $1 AND owner_profile_id = $2 AND status = 'submission_uncertain'
         AND provider_upload_ref_ciphertext IS NOT NULL
         AND (lease_token IS NULL OR lease_expires_at <= NOW())
       RETURNING *`,
      [assertUuid(jobId, 'job id'), ownerProfileId, leaseToken, leaseSeconds],
    );
    return result.rows[0] ? { job: result.rows[0], leaseToken } : null;
  }

  async function updateEvaluation({ jobId, ownerProfileId, expectedVersion, wordAccuracyScore, speakerAccuracyScore, correctionNotes }) {
    assertOwner(ownerProfileId);
    for (const [name, value] of [['word', wordAccuracyScore], ['speaker', speakerAccuracyScore]]) {
      if (value !== null && value !== undefined && (!Number.isInteger(value) || value < 1 || value > 5)) {
        throw transcriptionStoreError('transcription_invalid_value', `Invalid ${name} accuracy score.`, 400);
      }
    }
    if (correctionNotes !== null && correctionNotes !== undefined
      && (typeof correctionNotes !== 'string' || correctionNotes.length > 4000)) {
      throw transcriptionStoreError('transcription_invalid_value', 'Correction notes must be at most 4000 characters.', 400);
    }
    const result = await database.query(
      `UPDATE transcription_jobs SET word_accuracy_score = $4, speaker_accuracy_score = $5,
         correction_notes = $6, updated_at = NOW(), version = version + 1
       WHERE id = $1 AND owner_profile_id = $2 AND version = $3
         AND status = 'ready' AND cleanup_requested_at IS NULL
         AND expires_at > NOW() AND receipt_expires_at > NOW()
       RETURNING *`,
      [assertUuid(jobId, 'job id'), ownerProfileId, expectedVersion,
        wordAccuracyScore ?? null, speakerAccuracyScore ?? null, correctionNotes ?? null],
    );
    return result.rows[0] || null;
  }

  async function updateSpeakerNames({ jobId, ownerProfileId, expectedVersion, speakerNames }) {
    assertOwner(ownerProfileId);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw transcriptionStoreError('transcription_invalid_value', 'Invalid job version.', 400);
    }
    const normalized = validateStoredSpeakerNames(speakerNames);
    const result = await database.query(
      `UPDATE transcription_jobs SET speaker_names = $4::jsonb,
         updated_at = NOW(), version = version + 1
       WHERE id = $1 AND owner_profile_id = $2 AND version = $3
         AND status = 'ready' AND output_pathname IS NOT NULL
         AND cleanup_requested_at IS NULL AND content_purged_at IS NULL
         AND expires_at > NOW() AND receipt_expires_at > NOW()
       RETURNING *`,
      [assertUuid(jobId, 'job id'), ownerProfileId, expectedVersion, JSON.stringify(normalized)],
    );
    return result.rows[0] || null;
  }

  async function requestCleanup({ jobId, ownerProfileId, expectedVersion = null }) {
    assertOwner(ownerProfileId);
    const params = [assertUuid(jobId, 'job id'), ownerProfileId];
    const versionClause = expectedVersion == null ? '' : (params.push(expectedVersion), `AND version = $${params.length}`);
    const result = await database.query(
      `UPDATE transcription_jobs SET cleanup_requested_at = NOW(), local_cleanup_completed_at = NULL,
         original_filename = NULL, correction_notes = NULL, speaker_names = '{}'::jsonb,
         updated_at = NOW(), version = version + 1
       WHERE id = $1 AND owner_profile_id = $2 AND cleanup_requested_at IS NULL ${versionClause}
       RETURNING *`,
      params,
    );
    if (result.rows[0] || expectedVersion != null) return result.rows[0] || null;
    const existing = await database.query(
      'SELECT * FROM transcription_jobs WHERE id = $1 AND owner_profile_id = $2 AND cleanup_requested_at IS NOT NULL',
      [assertUuid(jobId, 'job id'), ownerProfileId],
    );
    return existing.rows[0] || null;
  }

  async function claimCleanup({ jobId, leaseSeconds = LEASE_SECONDS } = {}) {
    if (!Number.isInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > LEASE_SECONDS) {
      throw transcriptionStoreError('transcription_invalid_value', 'Invalid lease duration.', 400);
    }
    const leaseToken = crypto.randomUUID();
    const result = await database.query(
      `UPDATE transcription_jobs SET lease_token = $2,
         lease_expires_at = NOW() + ($3 || ' seconds')::interval,
         updated_at = NOW(), version = version + 1
       WHERE id = $1 AND (
           (cleanup_requested_at IS NOT NULL AND local_cleanup_completed_at IS NULL)
           OR (status = 'ready' AND input_cleanup_pathname IS NOT NULL)
           OR ((status IN ('ready','failed','expired') OR cleanup_requested_at IS NOT NULL)
             AND provider_transcript_id IS NOT NULL AND provider_cleanup_completed_at IS NULL)
         )
         AND (lease_token IS NULL OR lease_expires_at <= NOW())
         AND status <> 'submitting'
       RETURNING *`,
      [assertUuid(jobId, 'job id'), leaseToken, leaseSeconds],
    );
    return result.rows[0] ? { job: result.rows[0], leaseToken } : null;
  }

  async function claimNextCleanupJob({ jobId, leaseSeconds = LEASE_SECONDS } = {}) {
    if (!Number.isInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > LEASE_SECONDS) {
      throw transcriptionStoreError('transcription_invalid_value', 'Invalid lease duration.', 400);
    }
    const leaseToken = crypto.randomUUID();
    const result = await database.query(
      `WITH candidate AS (
         SELECT id FROM transcription_jobs
          WHERE ($1::uuid IS NULL OR id = $1) AND (
            (cleanup_requested_at IS NOT NULL AND local_cleanup_completed_at IS NULL)
            OR (status = 'ready' AND input_cleanup_pathname IS NOT NULL)
            OR ((status IN ('ready','failed','expired') OR cleanup_requested_at IS NOT NULL)
              AND provider_transcript_id IS NOT NULL AND provider_cleanup_completed_at IS NULL)
            OR (expires_at <= NOW() AND content_purged_at IS NULL)
            OR (receipt_expires_at <= NOW() AND receipt_purged_at IS NULL AND content_purged_at IS NOT NULL)
          )
            AND (lease_token IS NULL OR lease_expires_at <= NOW())
            AND status <> 'submitting'
          ORDER BY CASE WHEN expires_at <= NOW() AND content_purged_at IS NULL THEN 0 ELSE 1 END,
            updated_at, LEAST(expires_at, receipt_expires_at), created_at, id
          FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE transcription_jobs job SET lease_token = $2,
         lease_expires_at = NOW() + ($3 || ' seconds')::interval,
         updated_at = NOW(), version = version + 1
        FROM candidate WHERE job.id = candidate.id
       RETURNING job.*`,
      [jobId ? assertUuid(jobId, 'job id') : null, leaseToken, leaseSeconds],
    );
    return result.rows[0] ? { job: result.rows[0], leaseToken } : null;
  }

  async function claimNextExpiredContentJob({ jobId, leaseSeconds = LEASE_SECONDS } = {}) {
    if (!Number.isInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > LEASE_SECONDS) {
      throw transcriptionStoreError('transcription_invalid_value', 'Invalid lease duration.', 400);
    }
    const leaseToken = crypto.randomUUID();
    const result = await database.query(
      `WITH candidate AS (
         SELECT id FROM transcription_jobs
          WHERE ($1::uuid IS NULL OR id = $1)
            AND expires_at <= NOW() AND content_purged_at IS NULL
            AND (lease_token IS NULL OR lease_expires_at <= NOW())
            AND status <> 'submitting'
          ORDER BY updated_at, expires_at, created_at, id
          FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE transcription_jobs job SET lease_token = $2,
         lease_expires_at = NOW() + ($3 || ' seconds')::interval,
         updated_at = NOW(), version = version + 1
        FROM candidate WHERE job.id = candidate.id
       RETURNING job.*`,
      [jobId ? assertUuid(jobId, 'job id') : null, leaseToken, leaseSeconds],
    );
    return result.rows[0] ? { job: result.rows[0], leaseToken } : null;
  }

  async function finishLocalCleanup({ jobId, leaseToken, expectedVersion, deletedPaths = [], providerReferencePurged = false }) {
    const pathFields = ['input_cleanup_pathname', 'output_cleanup_pathname', 'diagnostic_cleanup_pathname'];
    const paths = new Set(deletedPaths);
    if ([...paths].some(path => !pathFields.includes(path))) throw transcriptionStoreError('transcription_invalid_value', 'Invalid cleanup path acknowledgement.', 400);
    const fields = {
      ...(paths.has('input_cleanup_pathname') ? { input_cleanup_pathname: null, audio_pathname: null } : {}),
      ...(paths.has('output_cleanup_pathname') ? { output_cleanup_pathname: null, output_pathname: null } : {}),
      ...(paths.has('diagnostic_cleanup_pathname') ? { diagnostic_cleanup_pathname: null, diagnostic_pathname: null } : {}),
      ...(providerReferencePurged ? { provider_upload_ref_ciphertext: null, reference_purged_at: new Date() } : {}),
    };
    return database.transaction(async tx => {
      const current = await tx.query(
        `SELECT * FROM transcription_jobs WHERE id = $1 AND lease_token = $2
           AND lease_expires_at > NOW() AND version = $3
           AND (cleanup_requested_at IS NOT NULL OR status = 'ready')
         FOR UPDATE`,
        [assertUuid(jobId, 'job id'), assertUuid(leaseToken, 'lease token'), expectedVersion],
      );
      const row = current.rows[0];
      if (!row) return null;
      // Expiry prevents new requests, but is not proof that remote in-flight
      // commits have finished. Retain/reap the exact target until a separately
      // verified completion protocol can close it; never invent a grace bound.
      if (row.upload_valid_until) {
        delete fields.input_cleanup_pathname;
      }
      if (providerReferencePurged && row.provider_upload_ref_ciphertext && row.expires_at > new Date() && !row.provider_cleanup_completed_at) {
        throw transcriptionStoreError('transcription_reference_retained', 'The provider reference must be retained until remote deletion or content expiry.');
      }
      const allPathsCleared = (!row.input_cleanup_pathname || fields.input_cleanup_pathname === null)
        && (!row.output_cleanup_pathname || fields.output_cleanup_pathname === null)
        && (!row.diagnostic_cleanup_pathname || fields.diagnostic_cleanup_pathname === null);
      const allPointersCleared = (!row.audio_pathname || fields.audio_pathname === null)
        && (!row.output_pathname || fields.output_pathname === null)
        && (!row.diagnostic_pathname || fields.diagnostic_pathname === null);
      const allLocalContentCleared = allPathsCleared && allPointersCleared;
      const allDeletionsAcknowledged = pathFields.every(field => !row[field] || paths.has(field));
      if (allPointersCleared && ['ready', 'uploading', 'queued'].includes(row.status)) fields.status = 'expired';
      if (allPointersCleared && allDeletionsAcknowledged && row.cleanup_requested_at != null) {
        fields.content_purged_at = new Date();
        fields.original_filename = null;
        fields.audio_sha256 = null;
        fields.audio_etag = null;
        fields.correction_notes = null;
        fields.speaker_names = {};
      }
      if (paths.has('input_cleanup_pathname') && row.status === 'ready') fields.audio_deleted_at = new Date();
      if (providerReferencePurged) fields.reference_purged_at = new Date();
      const entries = Object.entries(fields);
      const params = [row.id, leaseToken, expectedVersion];
      const assignments = entries.map(([field, value]) => {
        params.push(value);
        return `${field} = $${params.length}`;
      });
      if (allLocalContentCleared && row.cleanup_requested_at != null) assignments.push('local_cleanup_completed_at = NOW()');
      assignments.push('updated_at = NOW()', 'version = version + 1');
      const result = await tx.query(
        `UPDATE transcription_jobs SET ${assignments.join(', ')}
          WHERE id = $1 AND lease_token = $2 AND lease_expires_at > NOW()
            AND version = $3 AND (cleanup_requested_at IS NOT NULL OR status = 'ready')
          RETURNING *`,
        params,
      );
      return result.rows[0] || null;
    });
  }

  async function expireContent({ jobId, leaseToken, expectedVersion }) {
    return database.transaction(async tx => {
      const result = await tx.query(
        `UPDATE transcription_jobs SET status = CASE WHEN status IN ('ready','uploading','queued','failed') THEN 'expired' ELSE status END,
           audio_pathname = NULL, output_pathname = NULL, diagnostic_pathname = NULL,
           original_filename = NULL, audio_sha256 = NULL, audio_etag = NULL, correction_notes = NULL,
           speaker_names = '{}'::jsonb,
           provider_upload_ref_ciphertext = NULL,
           reference_purged_at = CASE WHEN provider_upload_ref_ciphertext IS NULL THEN reference_purged_at ELSE NOW() END,
           cleanup_requested_at = COALESCE(cleanup_requested_at, NOW()),
           updated_at = NOW(), version = version + 1
         WHERE id = $1 AND lease_token = $2 AND lease_expires_at > NOW() AND version = $3
           AND expires_at <= NOW() AND status <> 'submitting'
         RETURNING *`,
        [assertUuid(jobId, 'job id'), assertUuid(leaseToken, 'lease token'), expectedVersion],
      );
      return result.rows[0] || null;
    });
  }

  async function purgeExpiredReceipt({ jobId, leaseToken, expectedVersion }) {
    const result = await database.query(
      `UPDATE transcription_jobs SET
         idempotency_key = NULL, requested_model = NULL,
         provider_region = CASE WHEN provider_transcript_id IS NOT NULL OR status = 'submission_uncertain'
                                THEN provider_region ELSE NULL END,
         returned_model = NULL, options_snapshot = '{}'::jsonb,
         declared_content_type = NULL, declared_bytes = NULL,
         verified_content_type = NULL, verified_bytes = NULL, audio_duration_ms = NULL,
         word_accuracy_score = NULL, speaker_accuracy_score = NULL,
         speaker_names = '{}'::jsonb,
         receipt_purged_at = NOW(),
         updated_at = NOW(), version = version + 1
       WHERE id = $1 AND lease_token = $2 AND lease_expires_at > NOW()
         AND version = $3 AND receipt_expires_at <= NOW() AND receipt_purged_at IS NULL
         AND content_purged_at IS NOT NULL
       RETURNING *`,
      [assertUuid(jobId, 'job id'), assertUuid(leaseToken, 'lease token'), expectedVersion],
    );
    return result.rows[0] || null;
  }

  return {
    getJob, getLeasedJob, getOwnerJob, listOwnerJobs, createJob, reserveUploadWindow, queueJob,
    getWorkflowDispatch, claimWorkflowDispatch, acknowledgeWorkflowDispatch, failWorkflowDispatch,
    expireUnacknowledgedWorkflowDispatch, finishWorkflowDispatch, rearmWorkflowDispatch, checkWorkflowDispatchAttempt,
    touchWorkflowDispatch, listRunningWorkflowDispatches, recoverTerminalWorkflowDispatch,
    claimQueuedJob, claimNextQueuedJob, mutateLeasedJob, releaseLease,
    setProviderUploadReference, beginProviderSubmission, requeueExpiredPreIntentSubmissions,
    markExpiredSubmittingUncertain, claimNextDueJob, recordCallbackCandidate, bindVerifiedProviderId,
    reconcileVerifiedProviderId, abandonUncertain, claimUncertainForReconcile,
    updateEvaluation, updateSpeakerNames, publishReady, markAudioDeleted, markProviderDeletionCompleted,
    requestCleanup, claimCleanup, claimNextCleanupJob, claimNextExpiredContentJob, purgeExpiredReceipt,
    finishLocalCleanup, expireContent,
  };
}

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

const productionStore = createTranscriptionPilotStore(vercelPostgresAdapter());
export const getTranscriptionJob = (...args) => productionStore.getJob(...args);
export const getLeasedTranscriptionJob = (...args) => productionStore.getLeasedJob(...args);
export const getOwnerTranscriptionJob = (...args) => productionStore.getOwnerJob(...args);
export const listOwnerTranscriptionJobs = (...args) => productionStore.listOwnerJobs(...args);
export const createTranscriptionJob = (...args) => productionStore.createJob(...args);
export const reserveTranscriptionUploadWindow = (...args) => productionStore.reserveUploadWindow(...args);
export const queueTranscriptionJob = (...args) => productionStore.queueJob(...args);
export const getTranscriptionWorkflowDispatch = (...args) => productionStore.getWorkflowDispatch(...args);
export const claimTranscriptionWorkflowDispatch = (...args) => productionStore.claimWorkflowDispatch(...args);
export const acknowledgeTranscriptionWorkflowDispatch = (...args) => productionStore.acknowledgeWorkflowDispatch(...args);
export const failTranscriptionWorkflowDispatch = (...args) => productionStore.failWorkflowDispatch(...args);
export const expireUnacknowledgedTranscriptionWorkflowDispatch = (...args) => productionStore.expireUnacknowledgedWorkflowDispatch(...args);
export const finishTranscriptionWorkflowDispatch = (...args) => productionStore.finishWorkflowDispatch(...args);
export const rearmTranscriptionWorkflowDispatch = (...args) => productionStore.rearmWorkflowDispatch(...args);
export const checkTranscriptionWorkflowAttempt = (...args) => productionStore.checkWorkflowDispatchAttempt(...args);
export const touchTranscriptionWorkflowDispatch = (...args) => productionStore.touchWorkflowDispatch(...args);
export const listRunningTranscriptionWorkflowDispatches = (...args) => productionStore.listRunningWorkflowDispatches(...args);
export const recoverTerminalTranscriptionWorkflowDispatch = (...args) => productionStore.recoverTerminalWorkflowDispatch(...args);
export const claimTranscriptionJob = (...args) => productionStore.claimQueuedJob(...args);
export const claimNextTranscriptionJob = (...args) => productionStore.claimNextQueuedJob(...args);
export const claimNextDueTranscriptionJob = (...args) => productionStore.claimNextDueJob(...args);
export const publishReadyTranscriptionJob = (...args) => productionStore.publishReady(...args);
export const markTranscriptionAudioDeleted = (...args) => productionStore.markAudioDeleted(...args);
export const markTranscriptionProviderDeletionCompleted = (...args) => productionStore.markProviderDeletionCompleted(...args);
export const mutateLeasedTranscriptionJob = (...args) => productionStore.mutateLeasedJob(...args);
export const releaseTranscriptionLease = (...args) => productionStore.releaseLease(...args);
export const setTranscriptionProviderUploadReference = (...args) => productionStore.setProviderUploadReference(...args);
export const beginTranscriptionProviderSubmission = (...args) => productionStore.beginProviderSubmission(...args);
export const requeueExpiredPreIntentTranscriptionSubmissions = (...args) => productionStore.requeueExpiredPreIntentSubmissions(...args);
export const markExpiredTranscriptionSubmissionsUncertain = (...args) => productionStore.markExpiredSubmittingUncertain(...args);
export const recordTranscriptionCallbackCandidate = (...args) => productionStore.recordCallbackCandidate(...args);
export const bindVerifiedTranscriptionProviderId = (...args) => productionStore.bindVerifiedProviderId(...args);
export const reconcileVerifiedTranscriptionProviderId = (...args) => productionStore.reconcileVerifiedProviderId(...args);
export const abandonUncertainTranscriptionJob = (...args) => productionStore.abandonUncertain(...args);
export const claimUncertainTranscriptionJobForReconcile = (...args) => productionStore.claimUncertainForReconcile(...args);
export const updateTranscriptionEvaluation = (...args) => productionStore.updateEvaluation(...args);
export const updateTranscriptionSpeakerNames = (...args) => productionStore.updateSpeakerNames(...args);
export const requestTranscriptionCleanup = (...args) => productionStore.requestCleanup(...args);
export const claimTranscriptionCleanup = (...args) => productionStore.claimCleanup(...args);
export const claimNextCleanupTranscriptionJob = (...args) => productionStore.claimNextCleanupJob(...args);
export const claimNextExpiredContentTranscriptionJob = (...args) => productionStore.claimNextExpiredContentJob(...args);
export const finishTranscriptionLocalCleanup = (...args) => productionStore.finishLocalCleanup(...args);
export const expireTranscriptionContent = (...args) => productionStore.expireContent(...args);
export const purgeExpiredTranscriptionReceipt = (...args) => productionStore.purgeExpiredReceipt(...args);
