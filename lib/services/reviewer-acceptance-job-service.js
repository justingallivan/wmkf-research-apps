import crypto from 'crypto';
import { sql } from '@vercel/postgres';

export const REVIEWER_ACCEPTANCE_JOB_ACTIVE_STATUSES = ['accept_pending', 'queued'];
export const REVIEWER_ACCEPTANCE_JOB_TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'];

const MAX_ERROR_LENGTH = 1000;

function toJsonb(value) {
  return JSON.stringify(value ?? {});
}

function truncateError(error) {
  const message = error?.message || String(error || 'unknown error');
  return message.slice(0, MAX_ERROR_LENGTH);
}

function addSeconds(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return 60;
  return Math.min(3600, Math.max(15, Math.round(n)));
}

function buildPayload({
  acceptedAt,
  suggestion,
  request,
  reviewer,
  body,
  acks,
  isAcceptRepeat,
  optedOut,
  acceptedSuggestion,
  acceptOrcidRaw,
}) {
  return {
    schemaVersion: 1,
    action: 'accept',
    acceptedAt,
    isAcceptRepeat: isAcceptRepeat === true,
    optedOut: optedOut === true,
    acks: acks || null,
    acceptOrcidRaw: acceptOrcidRaw || null,
    body: {
      contactEdits: body?.contactEdits || null,
      address: body?.address || null,
      boardIdentity: body?.boardIdentity || null,
      honorariumOptOut: body?.honorariumOptOut === true,
    },
    suggestion: suggestion || null,
    acceptedSuggestion: acceptedSuggestion || suggestion || null,
    request: request || null,
    reviewer: reviewer || null,
  };
}

export async function enqueueReviewerAcceptanceJob({
  acceptanceKey = crypto.randomUUID(),
  acceptedAt,
  suggestion,
  request,
  reviewer,
  body,
  acks,
  isAcceptRepeat = false,
  optedOut = false,
  acceptedSuggestion,
  acceptOrcidRaw,
  status = 'accept_pending',
}) {
  if (!suggestion?.wmkf_appreviewersuggestionid) {
    throw new Error('enqueueReviewerAcceptanceJob: suggestion id required');
  }
  if (!acceptedAt) {
    throw new Error('enqueueReviewerAcceptanceJob: acceptedAt required');
  }
  const payload = buildPayload({
    acceptedAt,
    suggestion,
    request,
    reviewer,
    body,
    acks,
    isAcceptRepeat,
    optedOut,
    acceptedSuggestion,
    acceptOrcidRaw,
  });
  const requestId = request?.akoya_requestid || suggestion?._wmkf_request_value || null;
  const reviewerId = reviewer?.wmkf_potentialreviewersid || suggestion?._wmkf_potentialreviewer_value || null;
  const result = await sql`
    INSERT INTO reviewer_acceptance_jobs (
      acceptance_key,
      suggestion_id,
      request_id,
      reviewer_id,
      accepted_at,
      status,
      payload
    )
    VALUES (
      ${acceptanceKey},
      ${suggestion.wmkf_appreviewersuggestionid},
      ${requestId},
      ${reviewerId},
      ${acceptedAt},
      ${status},
      ${toJsonb(payload)}::jsonb
    )
    ON CONFLICT (suggestion_id, accepted_at)
    DO UPDATE SET
      status = CASE
        WHEN reviewer_acceptance_jobs.status IN ('failed', 'cancelled') THEN EXCLUDED.status
        ELSE reviewer_acceptance_jobs.status
      END,
      next_attempt_at = CASE
        WHEN reviewer_acceptance_jobs.status IN ('failed', 'cancelled') THEN NOW()
        ELSE reviewer_acceptance_jobs.next_attempt_at
      END,
      completed_at = CASE
        WHEN reviewer_acceptance_jobs.status IN ('failed', 'cancelled') THEN NULL
        ELSE reviewer_acceptance_jobs.completed_at
      END,
      locked_until = CASE
        WHEN reviewer_acceptance_jobs.status IN ('failed', 'cancelled') THEN NULL
        ELSE reviewer_acceptance_jobs.locked_until
      END,
      lease_token = CASE
        WHEN reviewer_acceptance_jobs.status IN ('failed', 'cancelled') THEN NULL
        ELSE reviewer_acceptance_jobs.lease_token
      END,
      updated_at = NOW()
    RETURNING *
  `;
  return result.rows[0];
}

export async function markReviewerAcceptanceJobQueued(id) {
  const result = await sql`
    UPDATE reviewer_acceptance_jobs
       SET status = CASE WHEN status = 'accept_pending' THEN 'queued' ELSE status END,
           next_attempt_at = CASE WHEN next_attempt_at > NOW() THEN NOW() ELSE next_attempt_at END,
           updated_at = NOW()
     WHERE id = ${id}
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function cancelReviewerAcceptanceJob(id, reason, { leaseToken } = {}) {
  const error = reason ? String(reason).slice(0, MAX_ERROR_LENGTH) : null;
  const result = leaseToken
    ? await sql`
        UPDATE reviewer_acceptance_jobs
           SET status = 'cancelled',
               last_error = ${error},
               locked_until = NULL,
               lease_token = NULL,
               completed_at = COALESCE(completed_at, NOW()),
               updated_at = NOW()
         WHERE id = ${id} AND lease_token = ${leaseToken}
         RETURNING *
      `
    : await sql`
        UPDATE reviewer_acceptance_jobs
           SET status = 'cancelled',
               last_error = ${error},
               locked_until = NULL,
               lease_token = NULL,
               completed_at = COALESCE(completed_at, NOW()),
               updated_at = NOW()
         WHERE id = ${id}
         RETURNING *
      `;
  return result.rows[0] || null;
}

export async function claimReviewerAcceptanceJobs({ limit = 5, lockSeconds = 300 } = {}) {
  const leaseToken = crypto.randomUUID();
  const result = await sql`
    WITH claimable AS (
      SELECT id
        FROM reviewer_acceptance_jobs
       WHERE status = ANY(${REVIEWER_ACCEPTANCE_JOB_ACTIVE_STATUSES})
         AND next_attempt_at <= NOW()
         AND (locked_until IS NULL OR locked_until < NOW())
       ORDER BY next_attempt_at, created_at
       LIMIT ${limit}
       FOR UPDATE SKIP LOCKED
    )
    UPDATE reviewer_acceptance_jobs raj
       SET locked_until = NOW() + (${addSeconds(lockSeconds)} || ' seconds')::INTERVAL,
           lease_token = ${leaseToken},
           updated_at = NOW()
      FROM claimable
     WHERE raj.id = claimable.id
     RETURNING raj.*
  `;
  return result.rows;
}

export async function mergeReviewerAcceptanceJobStep(id, leaseToken, stepName, patch) {
  const result = await sql`
    UPDATE reviewer_acceptance_jobs
       SET steps = jsonb_set(
             COALESCE(steps, '{}'::jsonb),
             ARRAY[${stepName}]::text[],
             COALESCE(steps -> ${stepName}, '{}'::jsonb) || ${toJsonb(patch)}::jsonb,
             true
           ),
           updated_at = NOW()
     WHERE id = ${id} AND lease_token = ${leaseToken}
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function completeReviewerAcceptanceJob(id, leaseToken, { stepsPatch } = {}) {
  const result = stepsPatch
    ? await sql`
        UPDATE reviewer_acceptance_jobs
           SET status = 'completed',
               steps = COALESCE(steps, '{}'::jsonb) || ${toJsonb(stepsPatch)}::jsonb,
               last_error = NULL,
               locked_until = NULL,
               lease_token = NULL,
               completed_at = NOW(),
               updated_at = NOW()
         WHERE id = ${id} AND lease_token = ${leaseToken}
         RETURNING *
      `
    : await sql`
        UPDATE reviewer_acceptance_jobs
           SET status = 'completed',
               last_error = NULL,
               locked_until = NULL,
               lease_token = NULL,
               completed_at = NOW(),
               updated_at = NOW()
         WHERE id = ${id} AND lease_token = ${leaseToken}
         RETURNING *
      `;
  return result.rows[0] || null;
}

export async function recordReviewerAcceptanceJobFailure(job, error, {
  retryable = true,
  maxAttempts = 8,
  delaySeconds = 60,
} = {}) {
  const attempts = Number(job?.attempts || 0) + 1;
  const terminal = !retryable || attempts >= maxAttempts;
  const result = await sql`
    UPDATE reviewer_acceptance_jobs
       SET attempts = attempts + 1,
           status = CASE WHEN ${terminal} THEN 'failed' ELSE status END,
           last_error = ${truncateError(error)},
           next_attempt_at = CASE
             WHEN ${terminal} THEN next_attempt_at
             ELSE NOW() + (${addSeconds(delaySeconds)} || ' seconds')::INTERVAL
           END,
           locked_until = NULL,
           lease_token = NULL,
           completed_at = CASE WHEN ${terminal} THEN NOW() ELSE completed_at END,
           updated_at = NOW()
     WHERE id = ${job.id} AND lease_token = ${job.lease_token}
     RETURNING *
  `;
  return result.rows[0] || null;
}
