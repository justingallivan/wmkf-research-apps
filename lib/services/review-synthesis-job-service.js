import crypto from 'crypto';
import { sql } from '@vercel/postgres';
import { observeReviewerFindWarmEffect } from './workbench/reviewer-find-warm-observation.js';

const MAX_ERROR_LENGTH = 1000;

function truncateError(error) {
  return (error?.message || String(error || 'unknown error')).slice(0, MAX_ERROR_LENGTH);
}

function clampSeconds(value, fallback = 300) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return fallback;
  return Math.min(1800, Math.max(30, Math.round(seconds)));
}

function assertHash(inputHash) {
  if (!/^[0-9a-f]{64}$/.test(String(inputHash || ''))) {
    throw new Error('review-synthesis job: inputHash must be a lowercase SHA-256 hex digest');
  }
}

export async function enqueueAutomaticReviewSynthesisJob({ requestId, inputHash }) {
  assertHash(inputHash);
  const generationKey = crypto.randomUUID();
  const dedupeKey = `automatic:${requestId}:${inputHash}`;
  const result = await observeReviewerFindWarmEffect({
    effectClass: 'job_enqueue',
    operation: 'review_synthesis_job_enqueue',
  }, () => observeReviewerFindWarmEffect({
    effectClass: 'postgres_write',
    operation: 'review_synthesis_job_insert',
  }, () => sql`
    WITH inserted AS (
      INSERT INTO review_synthesis_jobs (
        generation_key, dedupe_key, request_id, input_hash, mode, status
      )
      VALUES (
        ${generationKey}, ${dedupeKey}, ${requestId}, ${inputHash}, 'automatic', 'queued'
      )
      ON CONFLICT (dedupe_key) DO NOTHING
      RETURNING *
    )
    SELECT * FROM inserted
    UNION ALL
    SELECT * FROM review_synthesis_jobs WHERE dedupe_key = ${dedupeKey}
    LIMIT 1
  `));
  return result.rows[0];
}

export async function startManualReviewSynthesisJob({
  requestId,
  inputHash,
  actingUserSystemId = null,
}) {
  assertHash(inputHash);
  const generationKey = crypto.randomUUID();
  const leaseToken = crypto.randomUUID();
  const result = await sql`
    INSERT INTO review_synthesis_jobs (
      generation_key,
      dedupe_key,
      request_id,
      input_hash,
      mode,
      status,
      acting_user_system_id,
      attempts,
      lease_token,
      locked_until,
      started_at
    )
    VALUES (
      ${generationKey},
      ${`manual:${generationKey}`},
      ${requestId},
      ${inputHash},
      'manual',
      'running',
      ${actingUserSystemId},
      1,
      ${leaseToken},
      NOW() + INTERVAL '10 minutes',
      NOW()
    )
    RETURNING *
  `;
  return result.rows[0];
}

export async function claimAutomaticReviewSynthesisJobs({ limit = 1, lockSeconds = 600 } = {}) {
  const leaseToken = crypto.randomUUID();
  const result = await sql`
    WITH claimable AS (
      SELECT id
        FROM review_synthesis_jobs
       WHERE mode = 'automatic'
         AND status = 'queued'
         AND next_attempt_at <= NOW()
         AND (locked_until IS NULL OR locked_until < NOW())
       ORDER BY next_attempt_at, created_at
       LIMIT ${Math.min(5, Math.max(1, Number(limit) || 1))}
       FOR UPDATE SKIP LOCKED
    )
    UPDATE review_synthesis_jobs rsj
       SET status = 'running',
           attempts = attempts + 1,
           locked_until = NOW() + (${clampSeconds(lockSeconds, 600)} || ' seconds')::INTERVAL,
           lease_token = ${leaseToken},
           started_at = COALESCE(started_at, NOW()),
           updated_at = NOW()
      FROM claimable
     WHERE rsj.id = claimable.id
     RETURNING rsj.*
  `;
  return result.rows;
}

export async function completeReviewSynthesisJob(job, { runId }) {
  const result = await sql`
    UPDATE review_synthesis_jobs
       SET status = 'completed',
           run_id = ${runId || null},
           last_error = NULL,
           locked_until = NULL,
           lease_token = NULL,
           completed_at = NOW(),
           updated_at = NOW()
     WHERE id = ${job.id}
       AND lease_token = ${job.lease_token}
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function cancelReviewSynthesisJob(job, reason) {
  const result = await sql`
    UPDATE review_synthesis_jobs
       SET status = 'cancelled',
           last_error = ${reason ? String(reason).slice(0, MAX_ERROR_LENGTH) : null},
           locked_until = NULL,
           lease_token = NULL,
           completed_at = NOW(),
           updated_at = NOW()
     WHERE id = ${job.id}
       AND lease_token = ${job.lease_token}
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function recordReviewSynthesisJobFailure(job, error, {
  retryable = false,
  maxAttempts = 3,
  delaySeconds = 300,
} = {}) {
  const terminal = !retryable || Number(job.attempts || 0) >= maxAttempts;
  const result = await sql`
    UPDATE review_synthesis_jobs
       SET status = CASE WHEN ${terminal} THEN 'failed' ELSE 'queued' END,
           last_error = ${truncateError(error)},
           next_attempt_at = CASE
             WHEN ${terminal} THEN next_attempt_at
             ELSE NOW() + (${clampSeconds(delaySeconds)} || ' seconds')::INTERVAL
           END,
           locked_until = NULL,
           lease_token = NULL,
           completed_at = CASE WHEN ${terminal} THEN NOW() ELSE NULL END,
           updated_at = NOW()
     WHERE id = ${job.id}
       AND lease_token = ${job.lease_token}
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function getReviewSynthesisJobState(requestId, inputHash) {
  assertHash(inputHash);
  const [latestResult, matchingResult] = await Promise.all([
    sql`
      SELECT id, mode, status, input_hash, run_id, attempts, last_error,
             created_at, updated_at, started_at, completed_at
        FROM review_synthesis_jobs
       WHERE request_id = ${requestId}
       ORDER BY created_at DESC, id DESC
       LIMIT 1
    `,
    sql`
      SELECT id, run_id, completed_at
        FROM review_synthesis_jobs
       WHERE request_id = ${requestId}
         AND input_hash = ${inputHash}
         AND status = 'completed'
       ORDER BY completed_at DESC, id DESC
       LIMIT 1
    `,
  ]);
  const latest = latestResult.rows[0] || null;
  const matchingCompleted = matchingResult.rows[0] || null;
  return {
    current: !!matchingCompleted,
    status: latest?.status || 'not_started',
    mode: latest?.mode || null,
    inputHash,
    latestInputHash: latest?.input_hash || null,
    runId: latest?.run_id || null,
    attempts: latest?.attempts || 0,
    lastError: latest?.last_error || null,
    createdAt: latest?.created_at || null,
    updatedAt: latest?.updated_at || null,
    startedAt: latest?.started_at || null,
    completedAt: latest?.completed_at || null,
    currentRunId: matchingCompleted?.run_id || null,
    currentCompletedAt: matchingCompleted?.completed_at || null,
  };
}
