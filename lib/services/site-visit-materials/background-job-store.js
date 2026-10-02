/** Durable Postgres ownership and leases for applicant materials jobs. */
import crypto from 'node:crypto';
import { db, sql } from '@vercel/postgres';

export const MATERIALS_JOB_ACTIVE_STATUSES = ['queued', 'processing', 'needs_attention'];
export const MATERIALS_JOB_LEASE_SECONDS = 360;
export const MATERIALS_JOB_DEADLINE_MS = 2 * 60 * 60 * 1000;
export const MATERIALS_JOB_RETRY_LIMIT = 8;
export const MATERIALS_JOB_TERMINAL_RETENTION_DAYS = 30;
export const MATERIALS_JOB_FAILED_BLOB_RETENTION_DAYS = 7;

export class MaterialsJobConflict extends Error {
  constructor(code, status = 409) {
    super(code);
    this.name = 'MaterialsJobConflict';
    this.code = code;
    this.httpStatus = status;
  }
}

export async function withMaterialsJobTransaction(fn) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function getMaterialsUploadJobForStaging({ stagingId, requestId, actorBinding }) {
  const result = await sql`
    SELECT j.*
      FROM materials_upload_jobs j
      JOIN portal_upload_staging s ON s.id = j.staging_id
     WHERE j.staging_id = ${stagingId}
       AND j.request_id = ${requestId}
       AND j.actor_binding = ${actorBinding}
       AND s.background_job_id = j.id
     LIMIT 1
  `;
  return result.rows[0] || null;
}

export async function listMaterialsUploadJobsForRequest(requestId, { collectionIds = [], limit = 100 } = {}) {
  if (!requestId) return [];
  const ids = [...new Set((collectionIds || []).filter(Boolean))];
  const bounded = Math.min(250, Math.max(1, Number.parseInt(limit, 10) || 100));
  const result = await sql`
    WITH scoped AS (
      SELECT j.*,
             ROW_NUMBER() OVER (PARTITION BY collection_id, slot ORDER BY created_at DESC, id DESC) AS slot_rank
        FROM materials_upload_jobs j
       WHERE request_id = ${requestId}
         AND (status IN ('queued', 'processing', 'needs_attention') OR collection_id = ANY(${ids}::uuid[]))
    ), selected AS (
      SELECT * FROM scoped
       WHERE status IN ('queued', 'processing', 'needs_attention')
          OR (slot <> 'other' AND slot_rank = 1)
          OR (slot = 'other' AND slot_rank <= 10)
       ORDER BY created_at DESC, id DESC
       LIMIT ${bounded}
    )
    SELECT selected.id AS job_id, selected.staging_id, selected.collection_id,
           selected.request_id, selected.slot, selected.status, staging.filename,
           selected.attempt_count, selected.error_code,
           selected.created_at, selected.updated_at
      FROM selected JOIN portal_upload_staging staging ON staging.id = selected.staging_id
     ORDER BY selected.created_at DESC, selected.id DESC
  `;
  return result.rows;
}

export async function listMaterialsUploadJobsForCollections(collectionIds, options = {}) {
  const ids = [...new Set((collectionIds || []).filter(Boolean))];
  if (!ids.length) return [];
  const bounded = Math.min(250, Math.max(1, Number.parseInt(options.limit, 10) || 100));
  const result = await sql`
    WITH requests AS (SELECT DISTINCT request_id FROM materials_upload_jobs WHERE collection_id = ANY(${ids}::uuid[])),
    scoped AS (
      SELECT j.*, ROW_NUMBER() OVER (PARTITION BY collection_id, slot ORDER BY created_at DESC, id DESC) AS slot_rank
        FROM materials_upload_jobs j JOIN requests r USING (request_id)
       WHERE status IN ('queued', 'processing', 'needs_attention') OR collection_id = ANY(${ids}::uuid[])
    ), selected AS (
      SELECT * FROM scoped
       WHERE status IN ('queued', 'processing', 'needs_attention')
          OR (slot <> 'other' AND slot_rank = 1)
          OR (slot = 'other' AND slot_rank <= 10)
       ORDER BY created_at DESC, id DESC LIMIT ${bounded}
    )
    SELECT selected.id AS job_id, selected.staging_id, selected.collection_id,
           selected.request_id, selected.slot, selected.status, staging.filename,
           selected.attempt_count, selected.error_code, selected.created_at, selected.updated_at
      FROM selected JOIN portal_upload_staging staging ON staging.id = selected.staging_id
     ORDER BY selected.created_at DESC, selected.id DESC
  `;
  return result.rows;
}

export async function enqueueMaterialsUploadJob({
  stagingId,
  stagingLeaseToken,
  requestId,
  collectionId,
  actorBinding,
  tokenDigest,
  slot,
  otherUploadsEnabled,
}) {
  const jobId = crypto.randomUUID();

  return withMaterialsJobTransaction(async (client) => {
    const collectionResult = await client.query(
      `SELECT * FROM site_visit_material_collections
        WHERE id = $1 AND request_id = $2 AND token_digest = $3
          AND status <> 'closed' AND closes_at > clock_timestamp()
        FOR UPDATE`,
      [collectionId, requestId, tokenDigest],
    );
    const collection = collectionResult.rows[0];
    if (!collection) throw new MaterialsJobConflict('collection_not_open', 409);
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext($1), 0)`,
      [`materials-upload-request:${requestId}`],
    );
    const slotOpen = slot === 'other'
      ? otherUploadsEnabled === true
      : Array.isArray(collection.checklist)
        && collection.checklist.some((item) => item?.key === slot && item.waived !== true);
    if (!slotOpen) throw new MaterialsJobConflict('slot_not_open', 400);

    const staged = await client.query(
      `SELECT * FROM portal_upload_staging
        WHERE id = $1 AND scope = 'site_visit_material'
          AND resource_id = $2 AND actor_binding = $3
        FOR UPDATE`,
      [stagingId, requestId, actorBinding],
    );
    const staging = staged.rows[0];
    if (!staging) throw new MaterialsJobConflict('staging_not_found', 404);

    if (staging.background_job_id) {
      const existing = await client.query(
        `SELECT * FROM materials_upload_jobs
          WHERE id = $1 AND staging_id = $2 AND collection_id = $3
            AND request_id = $4 AND actor_binding = $5 FOR UPDATE`,
        [staging.background_job_id, stagingId, collectionId, requestId, actorBinding],
      );
      if (!existing.rows[0]) throw new MaterialsJobConflict('staging_owner_mismatch', 409);
      return existing.rows[0];
    }

    const validityResult = await client.query('SELECT clock_timestamp() AS observed_at');
    const observedAt = new Date(validityResult.rows[0].observed_at);
    const requestCollections = await client.query(
      `SELECT slot_leases FROM site_visit_material_collections WHERE request_id = $1`,
      [requestId],
    );
    const slotLeaseHeld = requestCollections.rows.some((row) => {
      const lease = row.slot_leases?.[slot];
      const expiresAt = Number(lease?.expiresAt);
      return Boolean(lease?.token && Number.isFinite(expiresAt) && expiresAt > observedAt.getTime());
    });
    if (slotLeaseHeld) {
      throw new MaterialsJobConflict('slot_busy', 409);
    }
    if (staging.status !== 'finalizing'
      || staging.lease_token !== stagingLeaseToken
      || new Date(staging.lease_expires_at).getTime() <= observedAt.getTime()
      || new Date(staging.expires_at).getTime() <= observedAt.getTime()) {
      throw new MaterialsJobConflict('staging_lease_lost', 409);
    }
    const deadlineAt = new Date(observedAt.getTime() + MATERIALS_JOB_DEADLINE_MS);
    const stagingExpiresAt = new Date(deadlineAt.getTime() + (MATERIALS_JOB_TERMINAL_RETENTION_DAYS * 24 * 60 * 60 * 1000));

    let inserted;
    try {
      inserted = await client.query(
        `INSERT INTO materials_upload_jobs
           (id, staging_id, collection_id, request_id, slot, actor_binding,
            token_digest, status, deadline_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'queued',$8)
         RETURNING *`,
        [jobId, stagingId, collectionId, requestId, slot, actorBinding, tokenDigest, deadlineAt.toISOString()],
      );
    } catch (error) {
      if (error?.code === '23505' && String(error.constraint || '').includes('active_slot')) {
        throw new MaterialsJobConflict('slot_busy', 409);
      }
      throw error;
    }

    const marker = await client.query(
      `UPDATE portal_upload_staging
          SET background_job_id = $1, status = 'pending', lease_token = NULL,
              lease_expires_at = NULL, expires_at = $2, updated_at = NOW()
        WHERE id = $3 AND status = 'finalizing' AND lease_token = $4
          AND background_job_id IS NULL
          AND lease_expires_at > clock_timestamp() AND expires_at > clock_timestamp()
          AND EXISTS (
            SELECT 1 FROM site_visit_material_collections c
             WHERE c.id = $5 AND c.request_id = $6 AND c.token_digest = $7
               AND c.status <> 'closed' AND c.closes_at > clock_timestamp()
          )
        RETURNING id`,
      [jobId, stagingExpiresAt.toISOString(), stagingId, stagingLeaseToken, collectionId, requestId, tokenDigest],
    );
    if (!marker.rows[0]) throw new MaterialsJobConflict('staging_lease_lost', 409);

    if (collection.status === 'ready') {
      await client.query(
        `UPDATE site_visit_material_collections
            SET status = 'open', ready_confirmed_at = NULL,
                ready_confirmed_by = NULL, updated_at = NOW()
          WHERE id = $1 AND status = 'ready'`,
        [collectionId],
      );
    }
    return inserted.rows[0];
  });
}

export async function claimNextMaterialsUploadJob({ leaseSeconds = MATERIALS_JOB_LEASE_SECONDS } = {}) {
  const lockSeconds = Math.max(60, Math.min(MATERIALS_JOB_LEASE_SECONDS, Number(leaseSeconds) || MATERIALS_JOB_LEASE_SECONDS));
  const leaseToken = crypto.randomUUID();
  return withMaterialsJobTransaction(async (client) => {
    const selected = await client.query(
      `SELECT * FROM materials_upload_jobs
        WHERE ((status = 'queued' AND next_attempt_at <= NOW())
           OR (status = 'processing' AND locked_until < NOW()))
          AND EXISTS (
            SELECT 1 FROM portal_upload_staging s
             WHERE s.id = materials_upload_jobs.staging_id
               AND s.background_job_id = materials_upload_jobs.id
               AND s.scope = 'site_visit_material'
               AND s.resource_id = materials_upload_jobs.request_id
               AND s.actor_binding = materials_upload_jobs.actor_binding
               AND (s.status IN ('consumed', 'pending') OR (s.status = 'finalizing' AND s.lease_expires_at <= NOW()))
          )
        ORDER BY next_attempt_at, created_at
        LIMIT 1 FOR UPDATE SKIP LOCKED`,
    );
    const job = selected.rows[0];
    if (!job) return null;

    const staged = await client.query(
      `SELECT * FROM portal_upload_staging
        WHERE id = $1 AND background_job_id = $2
          AND scope = 'site_visit_material' AND resource_id = $3
          AND actor_binding = $4
        FOR UPDATE`,
      [job.staging_id, job.id, job.request_id, job.actor_binding],
    );
    const staging = staged.rows[0];
    if (!staging || (staging.status !== 'consumed'
      && staging.status !== 'pending'
      && !(staging.status === 'finalizing' && new Date(staging.lease_expires_at).getTime() <= Date.now()))) {
      return null;
    }

    const claimed = await client.query(
      `UPDATE materials_upload_jobs
          SET status = 'processing', attempt_count = attempt_count + 1,
              lease_token = $1,
              locked_until = NOW() + ($2::text || ' seconds')::interval,
              updated_at = NOW()
        WHERE id = $3 AND status IN ('queued', 'processing')
          AND (status = 'queued' OR locked_until < NOW())
        RETURNING *`,
      [leaseToken, lockSeconds, job.id],
    );
    if (!claimed.rows[0]) return null;
    const current = claimed.rows[0];
    if (staging.status !== 'consumed') {
      const claimedStage = await client.query(
        `UPDATE portal_upload_staging
            SET status = 'finalizing', lease_token = $1, lease_expires_at = $2,
                updated_at = NOW()
          WHERE id = $3 AND background_job_id = $4
            AND actor_binding = $5 AND resource_id = $6
            AND (status = 'pending' OR (status = 'finalizing' AND lease_expires_at <= NOW()))
          RETURNING id`,
        [leaseToken, current.locked_until, staging.id, job.id, job.actor_binding, job.request_id],
      );
      if (!claimedStage.rows[0]) throw new MaterialsJobConflict('staging_lease_lost', 409);
    }
    return { ...current, staging_status: staging.status };
  });
}

export async function getClaimedMaterialsUploadStage({ jobId, leaseToken }) {
  const result = await sql`
    SELECT s.*
      FROM materials_upload_jobs j
      JOIN portal_upload_staging s ON s.id = j.staging_id AND s.background_job_id = j.id
     WHERE j.id = ${jobId} AND j.status = 'processing'
       AND j.lease_token = ${leaseToken} AND j.locked_until > NOW()
       AND s.scope = 'site_visit_material' AND s.resource_id = j.request_id
       AND s.actor_binding = j.actor_binding
       AND (s.status = 'consumed' OR (s.status = 'finalizing' AND s.lease_token = j.lease_token))
     LIMIT 1
  `;
  return result.rows[0] || null;
}

export async function getCurrentMaterialsUploadSideEffects({ jobId, leaseToken }) {
  const result = await sql`
    SELECT j.scan_checkpoint, s.candidate_result
      FROM materials_upload_jobs j
      JOIN portal_upload_staging s ON s.id = j.staging_id AND s.background_job_id = j.id
     WHERE j.id = ${jobId} AND j.status = 'processing'
       AND j.lease_token = ${leaseToken} AND j.locked_until > NOW()
       AND s.actor_binding = j.actor_binding AND s.resource_id = j.request_id
     LIMIT 1
  `;
  return result.rows[0] || null;
}

export async function pruneMaterialsUploadJobs() {
  const result = await sql`
    DELETE FROM materials_upload_jobs
     WHERE expires_at <= NOW()
       AND status IN ('completed', 'failed', 'cancelled')
       AND NOT EXISTS (
         SELECT 1 FROM portal_upload_staging s
          WHERE s.id = materials_upload_jobs.staging_id
            AND s.background_job_id = materials_upload_jobs.id
       )
  `;
  return result.rowCount || 0;
}

export async function assertMaterialsUploadJobLease(jobId, leaseToken) {
  const result = await sql`
    SELECT id FROM materials_upload_jobs
     WHERE id = ${jobId} AND status = 'processing'
       AND lease_token = ${leaseToken} AND locked_until > NOW() AND deadline_at > NOW()
  `;
  return Boolean(result.rows[0]);
}

export async function recordMaterialsUploadJobScan({ jobId, leaseToken, sha256, policyVersion }) {
  const result = await sql`
    UPDATE materials_upload_jobs
       SET scan_checkpoint = ${JSON.stringify({ sha256, policyVersion, clean: true, recordedAt: new Date().toISOString() })}::jsonb,
           updated_at = NOW()
     WHERE id = ${jobId} AND status = 'processing'
       AND lease_token = ${leaseToken} AND locked_until > NOW() AND deadline_at > NOW()
     RETURNING id
  `;
  return Boolean(result.rows[0]);
}

export async function completeMaterialsUploadJob({ jobId, leaseToken, resultPayload }) {
  return withMaterialsJobTransaction(async (client) => {
    const result = await client.query(
      `UPDATE materials_upload_jobs
          SET status = 'completed', result_payload = $1::jsonb,
              error_code = NULL, lease_token = NULL, locked_until = NULL,
              completed_at = NOW(), expires_at = NOW() + ($4::text || ' days')::interval,
              updated_at = NOW()
        WHERE id = $2 AND status = 'processing'
          AND lease_token = $3 AND locked_until > NOW()
        RETURNING *`,
      [JSON.stringify(resultPayload || { ok: true }), jobId, leaseToken, MATERIALS_JOB_TERMINAL_RETENTION_DAYS],
    );
    if (!result.rows[0]) return null;
    await client.query(
      `UPDATE portal_upload_staging
          SET background_job_id = NULL, lease_token = NULL, lease_expires_at = NULL,
              updated_at = NOW()
        WHERE background_job_id = $1 AND status = 'consumed'`,
      [jobId],
    );
    return result.rows[0];
  });
}

export async function settleMaterialsUploadJob({
  job,
  status,
  errorCode,
  retryAt = null,
  clearStageOwner = false,
  rejectStage = false,
}) {
  return withMaterialsJobTransaction(async (client) => {
    const settled = await client.query(
      `UPDATE materials_upload_jobs
          SET status = $1,
              error_code = $2,
              next_attempt_at = COALESCE($3, next_attempt_at),
              lease_token = NULL, locked_until = NULL,
              completed_at = CASE WHEN $1 = 'queued' THEN NULL ELSE NOW() END,
              expires_at = CASE WHEN $1 = 'queued'
                                THEN GREATEST(expires_at, NOW() + ($6::text || ' days')::interval)
                                ELSE NOW() + ($6::text || ' days')::interval END,
              updated_at = NOW()
        WHERE id = $4 AND status = 'processing'
          AND lease_token = $5 AND locked_until > NOW()
        RETURNING *`,
      [status, errorCode || null, retryAt, job.id, job.lease_token, MATERIALS_JOB_TERMINAL_RETENTION_DAYS],
    );
    if (!settled.rows[0]) return null;
    await client.query(
      `UPDATE portal_upload_staging
          SET status = CASE WHEN status = 'consumed' THEN status
                            WHEN $1 OR $3 THEN 'rejected' ELSE 'pending' END,
              result_code = CASE WHEN status = 'consumed' THEN result_code
                                 WHEN $1 OR $3 THEN $2 ELSE result_code END,
              expires_at = CASE WHEN $3 AND status <> 'consumed' THEN NOW() + ($4::text || ' days')::interval ELSE expires_at END,
              lease_token = NULL, lease_expires_at = NULL,
              background_job_id = CASE WHEN $3 THEN NULL ELSE background_job_id END,
              updated_at = NOW()
        WHERE id = $5 AND background_job_id = $6 AND lease_token = $7`,
      [rejectStage, errorCode || null, clearStageOwner, MATERIALS_JOB_FAILED_BLOB_RETENTION_DAYS, job.staging_id, job.id, job.lease_token],
    );
    return settled.rows[0];
  });
}

export async function giveBackMaterialsUploadJobAttempt(job) {
  return withMaterialsJobTransaction(async (client) => {
    const settled = await client.query(
      `UPDATE materials_upload_jobs
          SET status = 'queued', attempt_count = GREATEST(0, attempt_count - 1),
              lease_token = NULL, locked_until = NULL,
              next_attempt_at = NOW() + INTERVAL '30 seconds', updated_at = NOW()
        WHERE id = $1 AND status = 'processing' AND lease_token = $2
          AND locked_until > NOW()
        RETURNING *`,
      [job.id, job.lease_token],
    );
    if (!settled.rows[0]) return null;
    await client.query(
      `UPDATE portal_upload_staging
          SET status = CASE WHEN status = 'consumed' THEN status ELSE 'pending' END,
              lease_token = NULL, lease_expires_at = NULL, updated_at = NOW()
        WHERE id = $1 AND background_job_id = $2 AND lease_token = $3`,
      [job.staging_id, job.id, job.lease_token],
    );
    return settled.rows[0];
  });
}

export async function resolveMaterialsUploadJob({ jobId, action }) {
  if (!['cancel', 'retry'].includes(action)) throw new MaterialsJobConflict('invalid_action', 400);
  return withMaterialsJobTransaction(async (client) => {
    const selected = await client.query('SELECT * FROM materials_upload_jobs WHERE id = $1 FOR UPDATE', [jobId]);
    const job = selected.rows[0];
    if (!job || job.status !== 'needs_attention' || (job.locked_until && new Date(job.locked_until).getTime() > Date.now())) {
      throw new MaterialsJobConflict('job_not_resolvable', 409);
    }
    const staged = await client.query(
      `SELECT status FROM portal_upload_staging WHERE id = $1 AND background_job_id = $2 FOR UPDATE`,
      [job.staging_id, job.id],
    );
    if (staged.rows[0]?.status === 'consumed') {
      throw new MaterialsJobConflict('durable_receipt_already_committed', 409);
    }
    if (action === 'retry') {
      if (job.error_code === 'scan_infected') throw new MaterialsJobConflict('infected_upload_cannot_retry', 409);
      if (Number(job.attempt_count) >= MATERIALS_JOB_RETRY_LIMIT) throw new MaterialsJobConflict('retry_limit_reached', 409);
      const retried = await client.query(
        `UPDATE materials_upload_jobs SET status='queued', next_attempt_at=NOW(),
             deadline_at=NOW() + INTERVAL '2 hours',
             expires_at=GREATEST(expires_at, NOW() + ($2::text || ' days')::interval),
             error_code=NULL, completed_at=NULL, updated_at=NOW()
          WHERE id=$1 AND status='needs_attention' RETURNING *`, [jobId, MATERIALS_JOB_TERMINAL_RETENTION_DAYS],
      );
      await client.query(
        `UPDATE portal_upload_staging SET status='pending', lease_token=NULL,
             lease_expires_at=NULL, updated_at=NOW()
          WHERE id=$1 AND background_job_id=$2 AND status <> 'consumed'`, [job.staging_id, job.id],
      );
      return retried.rows[0];
    }
    const cancelled = await client.query(
      `UPDATE materials_upload_jobs SET status='cancelled', completed_at=NOW(),
           expires_at=NOW() + ($2::text || ' days')::interval,
           lease_token=NULL, locked_until=NULL, error_code='operator_cancelled', updated_at=NOW()
        WHERE id=$1 AND status='needs_attention' RETURNING *`, [jobId, MATERIALS_JOB_TERMINAL_RETENTION_DAYS],
    );
    await client.query(
      `UPDATE portal_upload_staging SET status=CASE WHEN status='consumed' THEN status ELSE 'rejected' END,
           result_code=CASE WHEN status='consumed' THEN result_code ELSE 'cancelled' END,
           expires_at=CASE WHEN status='consumed' THEN expires_at ELSE NOW() + INTERVAL '7 days' END,
           lease_token=NULL, lease_expires_at=NULL, background_job_id=NULL, updated_at=NOW()
        WHERE id=$1 AND background_job_id=$2`, [job.staging_id, job.id],
    );
    return cancelled.rows[0];
  });
}
