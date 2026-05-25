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
 *     4. S184 A1 guard: reject 409 if draft.pending_attachments is non-empty
 *        (a Blob upload is mid-flight; refuse to submit and orphan the bytes).
 *     5. Validate attachments shape (every att in draft.attachments)
 *        + all scan_result === 'clean'
 *     6. Generate request GUID (UUIDv4) — written to akoya_request later
 *        by drain at request_created
 *     7. Single Postgres transaction:
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
import { resolveContactForSession } from '../../../lib/services/contact-bridge-service';
import { validateAttachmentShape, validateAttachmentSet } from '../../../lib/utils/intake-attachment-shape';
import { validateBudgetLineRow } from '../../../lib/utils/intake-budget-line-payload';
import { checkIntakeRateLimit } from '../../../lib/intake/rate-limit';

const { Pool } = pkg;

const TERMINAL_STATUSES = new Set(['failed', 'cancelled']);
const PG_UNIQUE_VIOLATION = '23505';
// Index name from migration 011 — the partial-unique on submission_jobs
// keyed (contact_oid, account_id, form_key) WHERE status NOT IN terminal.
// A 23505 against THIS constraint means another active submit exists for
// the same triple (two-tabs-different-keys race). Other 23505s (e.g., the
// idempotency_key UNIQUE) are handled by the ON CONFLICT clause and never
// surface as a thrown error.
const ACTIVE_SUBMIT_UNIQUE_INDEX = 'idx_submission_jobs_one_active_per_contact_form';

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

  // Rate limit BEFORE body validation / membership check / draft fetch /
  // submission_jobs transaction. Submit cap is tight (5/min/applicant) —
  // resubmits should be rare.
  const rl = await checkIntakeRateLimit(req, contactOid, 'submit');
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfterSeconds));
    return jsonError(res, 429, 'rate_limited', { scope: rl.scope });
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

  // 3) Bridge: resolve the External ID OID to a Dataverse `contact` GUID
  //    (auth-bridge slice — INTAKE_PORTAL_DESIGN.md:175). The membership
  //    filter `_wmkf_contact_value eq <GUID>` requires the contact GUID,
  //    NOT the OID. Calling hasSubmitterRole with an OID silently returns
  //    false for every applicant (the bug this commit fixes).
  let bridgeResult;
  try {
    bridgeResult = await resolveContactForSession({
      oid: contactOid,
      email: session.user.contactEmail,
      name: session.user.contactName,
    });
  } catch (err) {
    if (err?.altKeyNotActive) {
      // Codex round-13 Q3: alt-key probe failed → identity service can't
      // guarantee uniqueness. Fail-loud 503 with Retry-After hint.
      console.warn('[intake/submit] bridge altKeyNotActive:', err.message);
      res.setHeader('Retry-After', '30');
      return jsonError(res, 503, 'identity_service_initializing', {
        message: 'The identity service is still initializing. Please retry in a moment.',
      });
    }
    console.error('[intake/submit] bridge failed:', err);
    return jsonError(res, 502, 'Identity bridge failed; please retry');
  }
  if (!bridgeResult.ok) {
    if (bridgeResult.reason === 'conflict') {
      IntakeAuditService.log({
        actorOid: contactOid,
        actorType: 'applicant',
        action: 'bridge.conflict',
        targetEntity: 'contact',
        targetId: bridgeResult.existingContactId ?? null,
        payload: {
          message: bridgeResult.message,
          // Single-contact conflict (email→different OID): existing* are
          // populated. Multi-match conflict (email→N candidates): candidates
          // is populated. Per Codex round-13 Q4, include both in the audit so
          // staff triage distinguishes dedupe vs. stolen-identity cases.
          existingContactId: bridgeResult.existingContactId,
          existingOid: bridgeResult.existingOid,
          candidates: bridgeResult.candidates,
        },
      }).catch(() => {});
      return jsonError(res, 409, 'identity_conflict', {
        message: 'Your account is already linked to a different portal identity. Please contact staff to resolve.',
      });
    }
    return jsonError(res, 401, bridgeResult.message || 'Identity bridge invalid');
  }
  const contactId = bridgeResult.contactId;

  // 4) Membership / Submitter-role guard. Now using the resolved contactId.
  //    The membership service handles the approved+active+Submitter triple-check.
  let isSubmitter;
  try {
    isSubmitter = await hasSubmitterRole(contactId, accountId);
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

  // 4a) S184 A1: reject if a Blob upload is still in-flight. Without
  //     this guard, submit could succeed mid-/attach and orphan the
  //     in-flight Blob bytes (no path back into the application). The
  //     applicant is told to wait for the upload or remove the in-flight
  //     item before retrying.
  const pendingAttachments = Array.isArray(draft.pending_attachments) ? draft.pending_attachments : [];
  if (pendingAttachments.length > 0) {
    return jsonError(res, 409, 'pending_attachments_present', {
      pendingCount: pendingAttachments.length,
      message: 'An upload is still in progress. Wait for it to finish, or refresh and remove the in-flight item before submitting.',
    });
  }

  // 5) Validate attachments — shape + scan_result === 'clean' for all
  const attachments = Array.isArray(draft.attachments) ? draft.attachments : [];
  try {
    attachments.forEach(validateAttachmentShape);
    validateAttachmentSet(attachments); // Codex round-13 Q5 — filename uniqueness
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

  // 6a) Pre-generate child GUIDs per drain plan §5 ("GUID generation: 1 per
  //     wmkf_proposalbudgetline row; ...; all stored in the frozen payload
  //     JSONB before queue"). Pre-generation gives the drain idempotent
  //     duplicate-PK detection per child — a crash mid-POST is recoverable
  //     because the next tick's POST uses the same GUID and Dataverse 412/409s,
  //     which the classifier routes to duplicate_pk → skip-as-success.
  //
  //     Source: draft.draft_json.budget_lines — an array of flat rows
  //     (pre-unrolled per year+category). Submit-side validation rejects
  //     malformed rows with 422 before the row reaches submission_jobs.
  const draftBudgetLines = Array.isArray(draft.draft_json?.budget_lines)
    ? draft.draft_json.budget_lines
    : [];
  try {
    draftBudgetLines.forEach(validateBudgetLineRow);
  } catch (err) {
    return jsonError(res, 422, err.message);
  }
  const budgetLines = draftBudgetLines.map((row) => ({
    id: crypto.randomUUID(),
    ...row,
  }));

  // 7) Frozen payload: snapshot of draft_json + attachments + pre-gen child
  //    GUIDs. The drain reads only this, never intake_drafts (per migration
  //    009's design comment).
  const payload = {
    draft_json: draft.draft_json ?? {},
    attachments,
    children: {
      budget_lines: budgetLines,
      // persons: [] — will be added when the persons handler ships (blocked
      // on Connor Q2 for parent PI attribution + contact-resolution service).
    },
    idempotency_key: idempotencyKey,
    contact_oid: contactOid,
    // Persisted in the frozen payload so the drain doesn't need to re-call
    // the bridge for each tick — the OID→GUID mapping for the submitting
    // contact is stable once written.
    contact_id: contactId,
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

    // Codex round-12 Q1: 23505 on the partial-unique
    // (contact_oid, account_id, form_key) WHERE status NOT IN terminal means
    // a parallel submit (different idempotency_key, same triple) already
    // claimed a non-terminal job row. Don't 500 the loser — surface a
    // structured 409 the UI can poll against (mirrors the
    // `previous_submission_terminal` 409 shape from §"Draft rotation on 409").
    if (err?.code === PG_UNIQUE_VIOLATION && err?.constraint === ACTIVE_SUBMIT_UNIQUE_INDEX) {
      try {
        const existing = await client.query(
          `SELECT id, request_id, status
             FROM submission_jobs
            WHERE contact_oid = $1 AND account_id = $2 AND form_key = $3
              AND status NOT IN ('completed', 'failed', 'cancelled')
            ORDER BY created_at DESC
            LIMIT 1`,
          [contactOid, accountId, formKey],
        );
        const prior = existing.rows[0];
        IntakeAuditService.log({
          actorOid: contactOid,
          actorType: 'applicant',
          action: 'submit.blocked_in_progress',
          targetEntity: 'submission_jobs',
          targetId: prior ? String(prior.id) : null,
          payload: { priorJobId: prior?.id, priorStatus: prior?.status },
        }).catch(() => {});
        return jsonError(res, 409, 'submission_in_progress', {
          priorJobId: prior?.id ?? null,
          priorRequestId: prior?.request_id ?? null,
          priorStatus: prior?.status ?? null,
        });
      } catch (lookupErr) {
        // Lookup failed — fall through to the catch-all 500 below.
        console.error('[intake/submit] in-progress lookup failed:', lookupErr);
      }
    }

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
