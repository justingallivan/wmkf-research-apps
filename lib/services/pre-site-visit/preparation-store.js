/** Durable scheduler receipts. Dataverse and SharePoint remain authoritative for documents. */
import { randomUUID } from 'crypto';
import { sql } from '@vercel/postgres';

const bounded = (value, length) => String(value || '').slice(0, length) || null;

export async function upsertDuePreparation({
  requestId, programId, cycleCode, siteVisitId, scheduledEnd, eventModifiedOn,
  stateCode, statusCode, correctionEpoch = '', initialState = 'pending', errorCode = null,
  resumeCorrection = false,
}, client = sql) {
  const result = await client.query(`
    INSERT INTO staff_deliberations_preparations (
      request_id, program_id, cycle_code, site_visit_id, scheduled_end,
      event_modified_on, event_state_code, event_status_code, correction_epoch, state,
      last_error_code, last_error_message
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    ON CONFLICT (request_id, site_visit_id, scheduled_end, correction_epoch)
    DO UPDATE SET
      event_modified_on=EXCLUDED.event_modified_on,
      event_state_code=EXCLUDED.event_state_code,
      event_status_code=EXCLUDED.event_status_code,
      program_id=EXCLUDED.program_id,
      cycle_code=EXCLUDED.cycle_code,
      state=CASE
        WHEN staff_deliberations_preparations.state IN ('prepared','running','pending')
          THEN staff_deliberations_preparations.state
        WHEN staff_deliberations_preparations.state='blocked'
          AND staff_deliberations_preparations.last_error_code='correction_reopen_requires_staff'
          AND $13::boolean THEN 'pending'
        WHEN staff_deliberations_preparations.event_modified_on IS DISTINCT FROM EXCLUDED.event_modified_on
          OR staff_deliberations_preparations.event_state_code IS DISTINCT FROM EXCLUDED.event_state_code
          OR staff_deliberations_preparations.event_status_code IS DISTINCT FROM EXCLUDED.event_status_code
          THEN 'pending'
        ELSE staff_deliberations_preparations.state END,
      next_attempt_at=CASE
        WHEN staff_deliberations_preparations.state='blocked'
          AND ((staff_deliberations_preparations.last_error_code='correction_reopen_requires_staff'
              AND $13::boolean)
            OR staff_deliberations_preparations.event_modified_on IS DISTINCT FROM EXCLUDED.event_modified_on
            OR staff_deliberations_preparations.event_state_code IS DISTINCT FROM EXCLUDED.event_state_code
            OR staff_deliberations_preparations.event_status_code IS DISTINCT FROM EXCLUDED.event_status_code)
          THEN NOW()
        ELSE staff_deliberations_preparations.next_attempt_at END,
      last_error_code=CASE
        WHEN staff_deliberations_preparations.state='blocked'
          AND ((staff_deliberations_preparations.last_error_code='correction_reopen_requires_staff'
              AND $13::boolean)
            OR staff_deliberations_preparations.event_modified_on IS DISTINCT FROM EXCLUDED.event_modified_on
            OR staff_deliberations_preparations.event_state_code IS DISTINCT FROM EXCLUDED.event_state_code
            OR staff_deliberations_preparations.event_status_code IS DISTINCT FROM EXCLUDED.event_status_code)
          THEN NULL ELSE staff_deliberations_preparations.last_error_code END,
      last_error_message=CASE
        WHEN staff_deliberations_preparations.state='blocked'
          AND ((staff_deliberations_preparations.last_error_code='correction_reopen_requires_staff'
              AND $13::boolean)
            OR staff_deliberations_preparations.event_modified_on IS DISTINCT FROM EXCLUDED.event_modified_on
            OR staff_deliberations_preparations.event_state_code IS DISTINCT FROM EXCLUDED.event_state_code
            OR staff_deliberations_preparations.event_status_code IS DISTINCT FROM EXCLUDED.event_status_code)
          THEN NULL ELSE staff_deliberations_preparations.last_error_message END,
      updated_at=NOW()
    RETURNING *`, [requestId, programId, cycleCode, siteVisitId, scheduledEnd,
    eventModifiedOn, Number(stateCode), Number(statusCode), correctionEpoch, initialState,
    bounded(errorCode, 100), initialState === 'blocked' ? 'The Site Visit schedule requires staff reconciliation.' : null,
    resumeCorrection === true]);
  return result.rows[0] || null;
}

export async function claimNextPreparation({ leaseMs = 420_000 } = {}, client = sql) {
  const token = randomUUID();
  const result = await client.query(`
    WITH candidate AS (
      SELECT id FROM staff_deliberations_preparations
      WHERE state IN ('pending','running') AND next_attempt_at <= NOW()
        AND (lease_token IS NULL OR lease_expires_at <= NOW())
      ORDER BY scheduled_end, created_at
      FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE staff_deliberations_preparations AS receipt
    SET state='running', lease_token=$1, lease_expires_at=NOW()+($2::text || ' milliseconds')::interval,
        attempt_count=attempt_count+1, updated_at=NOW()
    FROM candidate WHERE receipt.id=candidate.id
    RETURNING receipt.*`, [token, Math.max(10_000, Number(leaseMs) || 420_000)]);
  return result.rows[0] || null;
}

export async function finishPreparation(id, token, {
  state, documentId = null, retryAfterMs = null, errorCode = null, errorMessage = null,
  provenance = {},
} = {}, client = sql) {
  if (!['pending', 'prepared', 'blocked'].includes(state)) throw new Error('Invalid receipt terminal state.');
  const prepared = state === 'prepared';
  const result = await client.query(`
    UPDATE staff_deliberations_preparations
    SET state=$3, document_id=COALESCE($4::uuid, document_id),
        prepared_at=CASE WHEN $3='prepared' THEN COALESCE(prepared_at,NOW()) ELSE prepared_at END,
        next_attempt_at=CASE WHEN $3='pending' AND $5::bigint IS NOT NULL
          THEN NOW()+($5::text || ' milliseconds')::interval ELSE next_attempt_at END,
        lease_token=NULL, lease_expires_at=NULL,
        last_error_code=$6, last_error_message=$7,
        provenance=provenance || $8::jsonb, updated_at=NOW()
    WHERE id=$1 AND lease_token=$2
    RETURNING *`, [id, token, state, documentId, retryAfterMs,
    bounded(errorCode, 100), bounded(errorMessage, 1000), JSON.stringify(provenance)]);
  if (!result.rows[0]) return null;
  return { ...result.rows[0], _prepared: prepared };
}

export async function listLatestPreparations(requestIds, client = sql) {
  const ids = [...new Set((requestIds || []).filter(Boolean).map((id) => String(id).toLowerCase()))];
  if (!ids.length) return new Map();
  const result = await client.query(`
    SELECT DISTINCT ON (request_id) request_id, state, site_visit_id, scheduled_end,
      document_id, attempt_count, last_error_code, last_error_message, prepared_at, updated_at
    FROM staff_deliberations_preparations
    WHERE request_id = ANY($1::uuid[])
    ORDER BY request_id, scheduled_end DESC, updated_at DESC`, [ids]);
  return new Map(result.rows.map((row) => [String(row.request_id).toLowerCase(), {
    state: row.state,
    siteVisitId: row.site_visit_id,
    scheduledEndIso: row.scheduled_end?.toISOString?.() || row.scheduled_end || null,
    documentId: row.document_id,
    attemptCount: Number(row.attempt_count || 0),
    errorCode: row.last_error_code || null,
    errorMessage: row.last_error_message || null,
    preparedAtIso: row.prepared_at?.toISOString?.() || row.prepared_at || null,
    updatedAtIso: row.updated_at?.toISOString?.() || row.updated_at || null,
  }]));
}

export async function listPreparationsForSchedules(schedules, client = sql) {
  const rows = (schedules || []).filter((item) => item?.requestId && item?.siteVisitId && item?.scheduledEnd);
  if (!rows.length) return new Map();
  const result = await client.query(`
    WITH expected AS (
      SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::timestamptz[])
        AS schedule(request_id, site_visit_id, scheduled_end)
    )
    SELECT DISTINCT ON (receipt.request_id) receipt.request_id, receipt.state,
      receipt.site_visit_id, receipt.scheduled_end, receipt.document_id,
      receipt.attempt_count, receipt.last_error_code, receipt.last_error_message,
      receipt.prepared_at, receipt.updated_at
    FROM staff_deliberations_preparations AS receipt
    JOIN expected ON expected.request_id=receipt.request_id
      AND expected.site_visit_id=receipt.site_visit_id
      AND expected.scheduled_end=receipt.scheduled_end
    ORDER BY receipt.request_id, receipt.updated_at DESC, receipt.created_at DESC`, [
    rows.map((row) => row.requestId),
    rows.map((row) => row.siteVisitId),
    rows.map((row) => row.scheduledEnd),
  ]);
  return new Map(result.rows.map((row) => [String(row.request_id).toLowerCase(), {
    state: row.state,
    siteVisitId: row.site_visit_id,
    scheduledEndIso: row.scheduled_end?.toISOString?.() || row.scheduled_end || null,
    documentId: row.document_id,
    attemptCount: Number(row.attempt_count || 0),
    errorCode: row.last_error_code || null,
    errorMessage: row.last_error_message || null,
    preparedAtIso: row.prepared_at?.toISOString?.() || row.prepared_at || null,
    updatedAtIso: row.updated_at?.toISOString?.() || row.updated_at || null,
  }]));
}

export async function retryBlockedPreparation(requestId, siteVisitId, scheduledEnd, correctionEpoch = '', client = sql) {
  const result = await client.query(`
    UPDATE staff_deliberations_preparations
    SET state='pending', next_attempt_at=NOW(), last_error_code=NULL, last_error_message=NULL,
      updated_at=NOW()
    WHERE id=(SELECT id FROM staff_deliberations_preparations
      WHERE request_id=$1 AND site_visit_id=$2 AND scheduled_end=$3
        AND correction_epoch=$4 AND state='blocked'
      ORDER BY updated_at DESC LIMIT 1)
    RETURNING id`, [requestId, siteVisitId, scheduledEnd, correctionEpoch]);
  return Boolean(result.rows[0]);
}
