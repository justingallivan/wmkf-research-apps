/**
 * POST /api/intake/submit
 *
 * Applicant intake portal — submission endpoint. Transitions a draft into
 * a `submission_jobs` row that the drain (`/api/cron/drain-submissions`)
 * will process asynchronously.
 *
 * Contract (drain plan v7 §"Build pieces" #5):
 *
 *   Request:  { accountId, formKey, idempotencyKey }
 *   Auth:     external-id session with userType='applicant' + contactOid;
 *             Submitter-role guard against the chosen accountId via
 *             wmkf_portalmemberships (live = approved + active).
 *
 *   Sequence:
 *     1. Auth → contactOid (from session)
 *     2. Membership guard: hasSubmitterRole(contactOid, accountId)
 *     3. Load draft: IntakeDraftService.getByKey({ contactOid, accountId,
 *        formKey, requestId: null }) — requestless branch (single-phase)
 *     4. Validate attachments shape (every att in draft_json.attachments)
 *        + all scan_result === 'clean'
 *     5. Generate request GUID (UUIDv4) — written to akoya_request later
 *        by drain at request_created
 *     6. Single Postgres transaction:
 *          INSERT submission_jobs (idempotency_key, ..., payload, request_id, status='queued')
 *            ON CONFLICT (idempotency_key) DO UPDATE SET attempts=attempts  -- no-op for RETURNING
 *            RETURNING id, request_id, status
 *          UPDATE intake_drafts SET request_id=<generated> WHERE id=<draft.id> AND request_id IS NULL
 *     7. Inspect returned row:
 *          terminal status (failed/cancelled) → 409 + audit
 *          non-terminal → 200 + audit
 *
 *   Responses:
 *     200 { jobId, requestId, status }
 *     400 malformed body / missing draft / attachment-shape failure / unclean scan
 *     401 not authenticated as applicant
 *     403 no Submitter-role membership on accountId
 *     409 { error: 'previous_submission_terminal', priorStatus, priorJobId, lastError }
 *     500 internal (pg or auth-layer failure)
 *
 *   Audit writes (best-effort, outside txn per plan §"Audit consistency model"):
 *     action='submit'                 (happy path)
 *     action='submit.blocked_terminal'(409 path)
 *
 * NOT IN SCOPE here (handled by the drain):
 *   - Any Dataverse write
 *   - SharePoint folder creation
 *   - Status flip on the source picklist (Connor Q1)
 */

import crypto from 'crypto';
import pkg from 'pg';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { hasSubmitterRole } from '../../../lib/services/membership-service';
import IntakeDraftService from '../../../lib/services/intake-draft-service';
import IntakeAuditService from '../../../lib/services/intake-audit-service';
import { validateAttachmentShape } from '../../../lib/utils/intake-attachment-shape';

const { Pool } = pkg;

const TERMINAL_STATUSES = new Set(['failed', 'cancelled']);

// ---------- helpers ----------

function jsonError(res, status, error, extra = {}) {
  res.status(status).json({ error, ...extra });
}

function newPool() {
  const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new Error('POSTGRES_URL not configured');
  return new Pool({ connectionString });
}

// ---------- handler ----------

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return jsonError(res, 405, 'Method not allowed');
  }

  // 1) Auth — applicant session
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user || session.user.userType !== 'applicant') {
    return jsonError(res, 401, 'Authentication required (applicant)');
  }
  const contactOid = session.user.contactOid;
  if (!contactOid) {
    return jsonError(res, 401, 'Session missing contactOid');
  }

  // 2) Body
  const { accountId, formKey, idempotencyKey } = req.body || {};
  if (!accountId || typeof accountId !== 'string') {
    return jsonError(res, 400, 'accountId is required');
  }
  if (!formKey || typeof formKey !== 'string') {
    return jsonError(res, 400, 'formKey is required');
  }
  if (!idempotencyKey || typeof idempotencyKey !== 'string') {
    return jsonError(res, 400, 'idempotencyKey is required');
  }

  // 3) Membership / Submitter-role guard. The drain plan v7 §5 makes this a
  //    Dataverse query at submit time; the membership service handles the
  //    approved+active+Submitter triple-check in one filter.
  let isSubmitter;
  try {
    isSubmitter = await hasSubmitterRole(contactOid, accountId);
  } catch (err) {
    console.error('[intake/submit] membership check failed:', err);
    return jsonError(res, 502, 'Membership lookup failed; please retry');
  }
  if (!isSubmitter) {
    return jsonError(res, 403, 'No Submitter role on this institution');
  }

  // 4) Load the draft (requestless branch — single-phase pivot)
  let draft;
  try {
    draft = await IntakeDraftService.getByKey({
      contactOid,
      accountId,
      formKey,
      requestId: null,
    });
  } catch (err) {
    console.error('[intake/submit] draft lookup failed:', err);
    return jsonError(res, 500, 'Draft lookup failed');
  }
  if (!draft) {
    return jsonError(res, 400, 'No draft found for this (account, form)');
  }

  // 5) Validate attachments — shape + scan_result === 'clean' for all
  const attachments = Array.isArray(draft.attachments) ? draft.attachments : [];
  try {
    attachments.forEach(validateAttachmentShape);
  } catch (err) {
    return jsonError(res, 422, err.message);
  }
  const unclean = attachments.filter((a) => a.scan_result !== 'clean');
  if (unclean.length) {
    return jsonError(res, 422, `Unclean attachments: ${unclean.length}`);
  }

  // 6) Pre-generate the request GUID (UUIDv4). Stored in submission_jobs.request_id
  //    and used by the drain as the akoya_request primary key for Dataverse Create.
  const requestGuid = crypto.randomUUID();

  // 7) Frozen payload: snapshot of draft_json + attachments. The drain reads
  //    only this, never intake_drafts (per migration 009's design comment).
  const payload = {
    draft_json: draft.draft_json ?? {},
    attachments,
    idempotency_key: idempotencyKey,
    contact_oid: contactOid,
    account_id: accountId,
    form_key: formKey,
    submitted_at: new Date().toISOString(),
  };

  // 8) Critical transaction: INSERT submission_jobs + UPDATE intake_drafts.request_id
  //    Atomicity matters because the terminal-collision recovery (Codex round-7 §2)
  //    depends on the terminal-tied draft having request_id populated so the
  //    requestless partial-unique index permits a fresh draft for the same
  //    (contact, account, form).
  const pool = newPool();
  const client = await pool.connect();
  let jobRow;
  try {
    await client.query('BEGIN');
    const insertRes = await client.query(
      `INSERT INTO submission_jobs (
         idempotency_key, draft_id, contact_oid, account_id, request_id,
         form_key, status, payload
       )
       VALUES ($1, $2, $3, $4, $5, $6, 'queued', $7::jsonb)
       ON CONFLICT (idempotency_key)
         DO UPDATE SET attempts = submission_jobs.attempts
       RETURNING id, request_id, status, last_error`,
      [
        idempotencyKey,
        draft.id,
        contactOid,
        accountId,
        requestGuid,
        formKey,
        JSON.stringify(payload),
      ],
    );
    jobRow = insertRes.rows[0];

    // Move the draft out of the requestless partial-unique by binding it to
    // the request_id we just claimed. Guarded by request_id IS NULL so a
    // concurrent retry that already advanced is a no-op.
    await client.query(
      `UPDATE intake_drafts
          SET request_id = $1, updated_at = now()
        WHERE id = $2 AND request_id IS NULL`,
      [jobRow.request_id, draft.id],
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[intake/submit] txn failed:', err);
    return jsonError(res, 500, 'Submission failed; please retry');
  } finally {
    client.release();
    await pool.end().catch(() => {});
  }

  // 9) Terminal-collision handling (drain plan v7 §5 — Codex round-6 §1)
  if (TERMINAL_STATUSES.has(jobRow.status)) {
    IntakeAuditService.log({
      actorOid: contactOid,
      actorType: 'applicant',
      action: 'submit.blocked_terminal',
      targetEntity: 'submission_jobs',
      targetId: String(jobRow.id),
      payload: { priorJobId: jobRow.id, priorStatus: jobRow.status },
    }).catch(() => {}); // best-effort

    return jsonError(res, 409, 'previous_submission_terminal', {
      priorJobId: jobRow.id,
      priorStatus: jobRow.status,
      lastError: jobRow.last_error ?? null,
    });
  }

  // 10) Happy-path audit
  IntakeAuditService.log({
    actorOid: contactOid,
    actorType: 'applicant',
    action: 'submit',
    targetEntity: 'submission_jobs',
    targetId: String(jobRow.id),
    payload: { jobId: jobRow.id, requestId: jobRow.request_id, accountId },
  }).catch(() => {}); // best-effort

  return res.status(200).json({
    jobId: jobRow.id,
    requestId: jobRow.request_id,
    status: jobRow.status,
  });
}
