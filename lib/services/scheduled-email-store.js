/**
 * Postgres ledger for personalized scheduled email, plus per-PD VIP flags.
 *
 * Dataverse remains the workflow source and Dynamics remains the transport.
 * This store owns exact draft text, approval state, review actions, leases,
 * digest receipts, and cross-system send receipts so a retry can reconcile
 * rather than blindly create another email.
 *
 * APPROVAL INVARIANT: a row with approval_required = true is never returned
 * by claimScheduledEmailSend without approved_at unless force = true (the
 * PD's own version-fenced send-now action, which IS the approval).
 */

import crypto from 'node:crypto';
import { sql } from '@vercel/postgres';

const ERROR_MAX = 1000;

/**
 * Error codes with engine semantics (docs/plans/SCHEDULED_EMAIL_READDRESS_PLAN_2026-09-29.md
 * Part A). Display/guard readers test them ONLY through
 * shared/utils/scheduled-email-attention.js; the transport guard is the
 * independent send_requested_at predicate in the SQL below.
 */
export const SCHEDULED_EMAIL_ERROR_CODES = Object.freeze({
  SEND_UNCONFIRMED: 'scheduled_email_send_unconfirmed',
  ACTIVITY_MISSING: 'scheduled_email_activity_missing',
  ACTIVITY_FORBIDDEN: 'scheduled_email_activity_forbidden',
});
const UNCONFIRMED = SCHEDULED_EMAIL_ERROR_CODES.SEND_UNCONFIRMED;
const MISSING = SCHEDULED_EMAIL_ERROR_CODES.ACTIVITY_MISSING;
const FORBIDDEN = SCHEDULED_EMAIL_ERROR_CODES.ACTIVITY_FORBIDDEN;

export async function createOrGetScheduledEmail(input) {
  const result = await sql`
    WITH inserted AS (
      INSERT INTO scheduled_email_messages (
        id, workflow_type, source_record_id, request_id, deliverable_id,
        pd_systemuser_id, pd_name, pd_email, to_recipients, cc_recipients,
        recipient_name, recipient_contact_ids, subject, body_text,
        signature_text, scheduled_send_at, approval_required
      ) VALUES (
        ${input.id}, ${input.workflowType}, ${input.sourceRecordId},
        ${input.requestId}, ${input.deliverableId}, ${input.pdSystemUserId},
        ${input.pdName}, ${input.pdEmail},
        ${JSON.stringify(input.toRecipients)}::jsonb,
        ${JSON.stringify(input.ccRecipients || [])}::jsonb,
        ${input.recipientName},
        ${JSON.stringify(input.recipientContactIds || [])}::jsonb,
        ${input.subject}, ${input.bodyText}, ${input.signatureText},
        ${input.scheduledSendAt}, ${input.approvalRequired === true}
      )
      ON CONFLICT (workflow_type, source_record_id) DO NOTHING
      RETURNING *
    )
    SELECT * FROM inserted
    UNION ALL
    SELECT * FROM scheduled_email_messages
     WHERE workflow_type = ${input.workflowType}
       AND source_record_id = ${input.sourceRecordId}
    LIMIT 1
  `;
  return result.rows[0] || null;
}

export async function getScheduledEmail(id) {
  const result = await sql`
    SELECT * FROM scheduled_email_messages WHERE id = ${id} LIMIT 1
  `;
  return result.rows[0] || null;
}

export async function getScheduledEmailForPd(id, pdSystemUserId) {
  const result = await sql`
    SELECT * FROM scheduled_email_messages
     WHERE id = ${id} AND pd_systemuser_id = ${pdSystemUserId}
     LIMIT 1
  `;
  return result.rows[0] || null;
}

export async function listScheduledEmailsForPd(pdSystemUserId, { limit = 100 } = {}) {
  const bounded = Math.min(200, Math.max(1, Number(limit) || 100));
  const result = await sql`
    SELECT * FROM scheduled_email_messages
     WHERE pd_systemuser_id = ${pdSystemUserId}
     ORDER BY
       CASE WHEN status IN ('scheduled', 'failed') THEN 0 ELSE 1 END,
       scheduled_send_at ASC,
       created_at DESC
     LIMIT ${bounded}
  `;
  return result.rows;
}

/**
 * Ordinary delivery candidates (A7). Rows with send intent and rows whose
 * stored activity read back missing/forbidden never take one of these slots:
 * the first reconcile through listScheduledEmailReconciliationCandidates,
 * the second are manual recovery or the forbidden read lane. Parity with
 * scheduledEmailAttentionReason is pinned by tests.
 */
export async function listDueScheduledEmails({ limit = 100 } = {}) {
  const bounded = Math.min(200, Math.max(1, Number(limit) || 100));
  const result = await sql`
    SELECT * FROM scheduled_email_messages
     WHERE status IN ('scheduled', 'failed', 'sending')
       AND scheduled_send_at <= NOW()
       AND (approval_required = false OR approved_at IS NOT NULL)
       AND (locked_until IS NULL OR locked_until < NOW())
       AND send_requested_at IS NULL
       AND (last_error_code IS NULL OR last_error_code NOT IN (${MISSING}, ${FORBIDDEN}))
     ORDER BY scheduled_send_at ASC
     LIMIT ${bounded}
  `;
  return result.rows;
}

/**
 * Reconciliation-style candidates (A7): at most `limit` rows, oldest
 * updated_at first, that either carry send intent (A2 reconciliation) or hold
 * a stored activity whose last read was 403 (A3 forbidden read lane). Missing
 * activities are excluded; forbidden ones included. Every successful claim
 * bumps updated_at, so a still-unresolved row rotates behind untouched ones.
 */
export async function listScheduledEmailReconciliationCandidates({ limit = 25 } = {}) {
  const bounded = Math.min(100, Math.max(1, Number(limit) || 25));
  const result = await sql`
    SELECT * FROM scheduled_email_messages
     WHERE status IN ('scheduled', 'failed', 'sending')
       AND (locked_until IS NULL OR locked_until < NOW())
       AND (last_error_code IS NULL OR last_error_code <> ${MISSING})
       AND (
         send_requested_at IS NOT NULL
         OR (dynamics_email_id IS NOT NULL
             AND send_requested_at IS NULL
             AND last_error_code = ${FORBIDDEN})
       )
     ORDER BY updated_at ASC
     LIMIT ${bounded}
  `;
  return result.rows;
}

/**
 * A2 late acceptance: stopped rows that had already requested a send within
 * the last `days` days. The daily pass reads their activity; stopped wins
 * unless Dynamics proves the email went.
 */
export async function listStoppedScheduledEmailsWithSendIntent({ days = 7, limit = 100 } = {}) {
  const bounded = Math.min(200, Math.max(1, Number(limit) || 100));
  const window = Math.min(30, Math.max(1, Number(days) || 7));
  const result = await sql`
    SELECT * FROM scheduled_email_messages
     WHERE status = 'stopped'
       AND send_requested_at IS NOT NULL
       AND dynamics_email_id IS NOT NULL
       AND stopped_at >= NOW() - make_interval(days => ${window})
     ORDER BY stopped_at ASC
     LIMIT ${bounded}
  `;
  return result.rows;
}

export async function listUnfinalizedScheduledEmails({ limit = 100 } = {}) {
  const bounded = Math.min(200, Math.max(1, Number(limit) || 100));
  const result = await sql`
    SELECT * FROM scheduled_email_messages
     WHERE status = 'sent' AND finalized_at IS NULL
     ORDER BY sent_at ASC
     LIMIT ${bounded}
  `;
  return result.rows;
}

export async function updateScheduledEmailDraft({
  id,
  pdSystemUserId,
  profileId,
  expectedVersion,
  subject,
  bodyText,
}) {
  const result = await sql`
    UPDATE scheduled_email_messages
       SET subject = ${subject},
           body_text = ${bodyText},
           version = version + 1,
           reviewed_at = COALESCE(reviewed_at, NOW()),
           edited_at = NOW(),
           approved_at = NULL,
           actioned_by_profile_id = ${profileId},
           updated_at = NOW()
     WHERE id = ${id}
       AND pd_systemuser_id = ${pdSystemUserId}
       AND version = ${expectedVersion}
       AND status IN ('scheduled', 'failed')
       AND dynamics_email_id IS NULL
       AND send_requested_at IS NULL
       AND (locked_until IS NULL OR locked_until < NOW())
     RETURNING *
  `;
  return result.rows[0] || null;
}

/** A4: no edits once a Dynamics activity exists — its content is what sends. */
export async function approveScheduledEmail({ id, pdSystemUserId, profileId, expectedVersion }) {
  const result = await sql`
    UPDATE scheduled_email_messages
       SET reviewed_at = COALESCE(reviewed_at, NOW()),
           approved_at = NOW(),
           actioned_by_profile_id = ${profileId},
           version = version + 1,
           updated_at = NOW()
     WHERE id = ${id}
       AND pd_systemuser_id = ${pdSystemUserId}
       AND version = ${expectedVersion}
       AND status IN ('scheduled', 'failed')
       AND dynamics_email_id IS NULL
       AND send_requested_at IS NULL
       AND (locked_until IS NULL OR locked_until < NOW())
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function stopScheduledEmail({ id, pdSystemUserId, profileId, expectedVersion }) {
  const result = await sql`
    UPDATE scheduled_email_messages
       SET status = 'stopped',
           stopped_at = NOW(),
           reviewed_at = COALESCE(reviewed_at, NOW()),
           actioned_by_profile_id = ${profileId},
           version = version + 1,
           lease_token = NULL,
           locked_until = NULL,
           updated_at = NOW()
     WHERE id = ${id}
       AND pd_systemuser_id = ${pdSystemUserId}
       AND version = ${expectedVersion}
       AND status IN ('scheduled', 'failed')
       AND (locked_until IS NULL OR locked_until < NOW())
     RETURNING *
  `;
  return result.rows[0] || null;
}

/**
 * A6: inside a delivery attempt the caller passes its lease token and the
 * stop is fenced on it (another worker's lease is never cleared). Without a
 * token (the pre-claim test-Request stop) the row must hold no live lease.
 */
export async function cancelScheduledEmailForSource(
  id,
  reason = 'source_no_longer_eligible',
  { leaseToken = null } = {},
) {
  const result = await sql`
    UPDATE scheduled_email_messages
       SET status = 'stopped',
           stopped_at = COALESCE(stopped_at, NOW()),
           lease_token = NULL,
           locked_until = NULL,
           last_error_code = ${String(reason).slice(0, 100)},
           last_error_message = 'The source record is no longer eligible for this scheduled email.',
           updated_at = NOW()
     WHERE id = ${id}
       AND status IN ('scheduled', 'failed', 'sending')
       AND ((${leaseToken}::uuid IS NOT NULL AND lease_token = ${leaseToken})
            OR (${leaseToken}::uuid IS NULL AND (locked_until IS NULL OR locked_until < NOW())))
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function claimScheduledEmailSend(id, {
  pdSystemUserId = null,
  expectedVersion = null,
  force = false,
  lockSeconds = 300,
} = {}) {
  const leaseToken = crypto.randomUUID();
  const seconds = Math.min(900, Math.max(30, Number(lockSeconds) || 300));
  const result = await sql`
    UPDATE scheduled_email_messages
       SET status = 'sending',
           lease_token = ${leaseToken},
           locked_until = NOW() + (${seconds} || ' seconds')::INTERVAL,
           attempt_count = attempt_count + 1,
           last_error_code = NULL,
           last_error_message = NULL,
           updated_at = NOW()
     WHERE id = ${id}
       AND (${pdSystemUserId}::uuid IS NULL OR pd_systemuser_id = ${pdSystemUserId})
       AND (${expectedVersion}::integer IS NULL OR version = ${expectedVersion})
       AND status IN ('scheduled', 'failed', 'sending')
       AND (${force}::boolean = true OR scheduled_send_at <= NOW())
       AND (${force}::boolean = true
            OR approval_required = false
            OR approved_at IS NOT NULL)
       AND send_requested_at IS NULL
       AND (locked_until IS NULL OR locked_until < NOW())
     RETURNING *
  `;
  return result.rows[0] || null;
}

/**
 * A2 reconciliation claim: a row that already requested a send may only be
 * READ back, never re-sent. Ignores schedule and approval, leaves
 * attempt_count alone, re-stamps the unconfirmed marker, and takes a lease
 * so recordScheduledEmailSent can land if Dynamics accepted it.
 */
export async function claimScheduledEmailReconciliation(id, { lockSeconds = 300 } = {}) {
  const leaseToken = crypto.randomUUID();
  const seconds = Math.min(900, Math.max(30, Number(lockSeconds) || 300));
  const result = await sql`
    UPDATE scheduled_email_messages
       SET lease_token = ${leaseToken},
           locked_until = NOW() + (${seconds} || ' seconds')::INTERVAL,
           last_error_code = ${UNCONFIRMED},
           updated_at = NOW()
     WHERE id = ${id}
       AND send_requested_at IS NOT NULL
       AND dynamics_email_id IS NOT NULL
       AND status IN ('scheduled', 'failed', 'sending')
       AND (locked_until IS NULL OR locked_until < NOW())
     RETURNING *
  `;
  return result.rows[0] || null;
}

/**
 * Releases a reconciliation claim that did not resolve: the row lands in
 * `failed` (so Stop stays available) with the unconfirmed marker retained.
 */
export async function releaseScheduledEmailReconciliation(message, error = null) {
  const text = error
    ? String(error?.message || error).slice(0, ERROR_MAX)
    : 'Dynamics has not confirmed this send yet. It is checked again each day.';
  const result = await sql`
    UPDATE scheduled_email_messages
       SET status = 'failed',
           lease_token = NULL,
           locked_until = NULL,
           last_error_code = ${UNCONFIRMED},
           last_error_message = ${text},
           updated_at = NOW()
     WHERE id = ${message.id}
       AND lease_token = ${message.lease_token}
       AND send_requested_at IS NOT NULL
     RETURNING *
  `;
  return result.rows[0] || null;
}

/**
 * A3/A7 forbidden read lane: lease-fenced claim of a row whose stored activity
 * last read back 403 and that has NOT requested a send. The claim only permits
 * reading that activity; it never sends or creates.
 */
export async function claimScheduledEmailActivityRead(id, { lockSeconds = 300 } = {}) {
  const leaseToken = crypto.randomUUID();
  const seconds = Math.min(900, Math.max(30, Number(lockSeconds) || 300));
  const result = await sql`
    UPDATE scheduled_email_messages
       SET lease_token = ${leaseToken},
           locked_until = NOW() + (${seconds} || ' seconds')::INTERVAL,
           updated_at = NOW()
     WHERE id = ${id}
       AND dynamics_email_id IS NOT NULL
       AND send_requested_at IS NULL
       AND last_error_code = ${FORBIDDEN}
       AND status IN ('scheduled', 'failed', 'sending')
       AND (locked_until IS NULL OR locked_until < NOW())
     RETURNING *
  `;
  return result.rows[0] || null;
}

/**
 * A successful read after a forbidden spell: clear the code and lease and
 * return the row to ordinary eligibility. The next ordinary run decides
 * whether the saved activity is already accepted or needs its first send.
 */
export async function clearScheduledEmailActivityCode(message) {
  const result = await sql`
    UPDATE scheduled_email_messages
       SET status = 'scheduled',
           lease_token = NULL,
           locked_until = NULL,
           last_error_code = NULL,
           last_error_message = NULL,
           updated_at = NOW()
     WHERE id = ${message.id}
       AND lease_token = ${message.lease_token}
       AND send_requested_at IS NULL
       AND last_error_code = ${FORBIDDEN}
     RETURNING *
  `;
  return result.rows[0] || null;
}

/**
 * Part B (B3): the one lease-fenced recipient/posture transition, taken after
 * an ordinary or forced claim and before any activity lookup, on a row with
 * no Dynamics activity and no send intent.
 *  - recipientDrift: rewrite Cc and the ordered [PI, Liaison?] contact ids
 *    and increment recipient_generation (so a draft created under the old
 *    recipients is never adopted).
 *  - every transition persists approval_required, clears approved_at (owner
 *    decision B-1) and increments version; subject/body/signature/edits stay.
 *  - holdForApproval: status 'scheduled', lease released, reason recorded;
 *    the caller stops this run. Otherwise the row stays 'sending' under the
 *    same lease and the caller continues with the RETURNED row.
 * A null return means the lease or version fence was lost.
 */
export async function reconcileScheduledEmailRecipients(message, {
  recipientDrift = false,
  ccRecipients = [],
  recipientContactIds = [],
  approvalRequired,
  holdForApproval = false,
  reasonCode = null,
  reasonMessage = null,
}) {
  const result = await sql`
    UPDATE scheduled_email_messages
       SET cc_recipients = CASE WHEN ${recipientDrift}::boolean
                                THEN ${JSON.stringify(ccRecipients)}::jsonb ELSE cc_recipients END,
           recipient_contact_ids = CASE WHEN ${recipientDrift}::boolean
                                        THEN ${JSON.stringify(recipientContactIds)}::jsonb ELSE recipient_contact_ids END,
           recipient_generation = recipient_generation + CASE WHEN ${recipientDrift}::boolean THEN 1 ELSE 0 END,
           approval_required = ${approvalRequired === true},
           approved_at = NULL,
           version = version + 1,
           status = CASE WHEN ${holdForApproval}::boolean THEN 'scheduled' ELSE status END,
           lease_token = CASE WHEN ${holdForApproval}::boolean THEN NULL ELSE lease_token END,
           locked_until = CASE WHEN ${holdForApproval}::boolean THEN NULL ELSE locked_until END,
           last_error_code = CASE WHEN ${holdForApproval}::boolean
                                  THEN ${reasonCode ? String(reasonCode).slice(0, 100) : null} ELSE last_error_code END,
           last_error_message = CASE WHEN ${holdForApproval}::boolean
                                     THEN ${reasonMessage ? String(reasonMessage).slice(0, ERROR_MAX) : null} ELSE last_error_message END,
           updated_at = NOW()
     WHERE id = ${message.id}
       AND lease_token = ${message.lease_token}
       AND version = ${message.version}
       AND status = 'sending'
       AND dynamics_email_id IS NULL
       AND send_requested_at IS NULL
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function recordScheduledEmailActivity(message, emailId) {
  const result = await sql`
    UPDATE scheduled_email_messages
       SET dynamics_email_id = COALESCE(dynamics_email_id, ${emailId}),
           updated_at = NOW()
     WHERE id = ${message.id}
       AND lease_token = ${message.lease_token}
       AND (dynamics_email_id IS NULL OR dynamics_email_id = ${emailId})
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function recordScheduledEmailSendRequested(message) {
  const result = await sql`
    UPDATE scheduled_email_messages
       SET send_requested_at = COALESCE(send_requested_at, NOW()),
           updated_at = NOW()
     WHERE id = ${message.id}
       AND lease_token = ${message.lease_token}
       AND status = 'sending'
       AND dynamics_email_id IS NOT NULL
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function recordScheduledEmailSent(message, status = {}) {
  const result = await sql`
    UPDATE scheduled_email_messages
       SET status = 'sent',
           send_requested_at = COALESCE(send_requested_at, NOW()),
           sent_at = COALESCE(sent_at, NOW()),
           dynamics_statecode = ${status.statecode ?? null},
           dynamics_statuscode = ${status.statuscode ?? null},
           dynamics_senton = ${status.senton || null},
           lease_token = NULL,
           locked_until = NULL,
           last_error_code = NULL,
           last_error_message = NULL,
           updated_at = NOW()
     WHERE id = ${message.id}
       AND lease_token = ${message.lease_token}
       AND dynamics_email_id IS NOT NULL
     RETURNING *
  `;
  return result.rows[0] || null;
}

/**
 * A2 late acceptance: a stopped row whose already-requested send Dynamics
 * later accepted becomes `sent`. Fenced on the stopped status, the send
 * intent and the exact stored activity; no lease exists on a stopped row.
 */
export async function recordStoppedScheduledEmailSent(message, status = {}) {
  const result = await sql`
    UPDATE scheduled_email_messages
       SET status = 'sent',
           sent_at = COALESCE(sent_at, NOW()),
           dynamics_statecode = ${status.statecode ?? null},
           dynamics_statuscode = ${status.statuscode ?? null},
           dynamics_senton = ${status.senton || null},
           last_error_code = NULL,
           last_error_message = NULL,
           updated_at = NOW()
     WHERE id = ${message.id}
       AND status = 'stopped'
       AND send_requested_at IS NOT NULL
       AND dynamics_email_id = ${message.dynamics_email_id}
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function recordScheduledEmailFailure(message, error, code = 'scheduled_email_send_failed') {
  const text = String(error?.message || error || 'Scheduled email send failed').slice(0, ERROR_MAX);
  const result = await sql`
    UPDATE scheduled_email_messages
       SET status = 'failed',
           lease_token = NULL,
           locked_until = NULL,
           last_error_code = ${String(code).slice(0, 100)},
           last_error_message = ${text},
           last_failed_at = NOW(),
           updated_at = NOW()
     WHERE id = ${message.id}
       AND lease_token = ${message.lease_token}
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function recordScheduledEmailFinalized(id) {
  const result = await sql`
    UPDATE scheduled_email_messages
       SET finalized_at = COALESCE(finalized_at, NOW()), updated_at = NOW()
     WHERE id = ${id} AND status = 'sent'
     RETURNING *
  `;
  return result.rows[0] || null;
}

/**
 * All rows any PD digest could mention, in one bounded query; the service
 * groups them per PD. Sections:
 *  - approval-pending: waits for the PD every digest until actioned;
 *  - upcoming: scheduled/failed rows that will send without further action;
 *  - FYI: sent rows not yet receipted into a digest (digest_fyi_at IS NULL).
 */
export async function listScheduledEmailDigestRows({ perPdLimit = 100 } = {}) {
  const bounded = Math.min(500, Math.max(1, Number(perPdLimit) || 100));
  // A7: per-PD window, no global cap. Every PD with eligible work is
  // represented every day with at most `perPdLimit` rows; pd_total carries the
  // PD's full eligible count so the service can warn when a PD is capped.
  const result = await sql`
    SELECT * FROM (
      SELECT m.*,
             ROW_NUMBER() OVER (
               PARTITION BY pd_systemuser_id
               ORDER BY scheduled_send_at ASC, created_at ASC, id ASC
             ) AS pd_rank,
             COUNT(*) OVER (PARTITION BY pd_systemuser_id) AS pd_total
        FROM scheduled_email_messages m
       WHERE (status IN ('scheduled', 'failed'))
          OR (status = 'sent' AND digest_fyi_at IS NULL)
    ) ranked
     WHERE pd_rank <= ${bounded}
     ORDER BY pd_systemuser_id, pd_rank ASC
  `;
  return result.rows;
}

/** Idempotent FYI receipt: stamps only rows not already receipted. */
export async function markScheduledEmailsDigestFyi(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return 0;
  const result = await sql`
    UPDATE scheduled_email_messages
       SET digest_fyi_at = COALESCE(digest_fyi_at, NOW()),
           updated_at = NOW()
     WHERE id = ANY(${ids}::uuid[])
       AND status = 'sent'
  `;
  return result.rowCount || 0;
}

/**
 * PD handoff (A5): one atomic reset of an UNSENT row under the request's
 * current PD. Fires only when the stored PD differs, the version matches the
 * one the cron just read, the row is scheduled/failed or `sending` with an
 * expired lease, no transport state exists (both dynamics_email_id and
 * send_requested_at null) and no lease is live; a concurrent send or a second
 * rebuild no-ops on the WHERE. The same write returns the row to `scheduled`,
 * clears both lease fields and increments recipient_generation, so a draft a
 * crashed worker left in Dynamics under the previous generation's correlation
 * key is never adopted (the next delivery takes a fresh claim and a fresh
 * key). A transport-started row deliberately stays under the former PD until
 * it resolves. Discards the former PD's edits/approval/error fields; keeps
 * attempt_count as claim history. scheduled_send_at is deliberately NOT
 * rebuilt — the send time derives from the immutable invite date.
 */
export async function reassignScheduledEmail(input) {
  const expectedVersion = Number.isInteger(input.expectedVersion) ? input.expectedVersion : null;
  const result = await sql`
    UPDATE scheduled_email_messages
       SET pd_systemuser_id = ${input.pdSystemUserId},
           pd_name = ${input.pdName},
           pd_email = ${input.pdEmail},
           to_recipients = ${JSON.stringify(input.toRecipients)}::jsonb,
           cc_recipients = ${JSON.stringify(input.ccRecipients || [])}::jsonb,
           recipient_name = ${input.recipientName},
           recipient_contact_ids = ${JSON.stringify(input.recipientContactIds || [])}::jsonb,
           subject = ${input.subject},
           body_text = ${input.bodyText},
           signature_text = ${input.signatureText},
           approval_required = ${input.approvalRequired === true},
           status = 'scheduled',
           version = version + 1,
           recipient_generation = recipient_generation + 1,
           lease_token = NULL,
           locked_until = NULL,
           reviewed_at = NULL,
           approved_at = NULL,
           edited_at = NULL,
           actioned_by_profile_id = NULL,
           last_error_code = NULL,
           last_error_message = NULL,
           last_failed_at = NULL,
           updated_at = NOW()
     WHERE workflow_type = ${input.workflowType}
       AND source_record_id = ${input.sourceRecordId}
       AND pd_systemuser_id <> ${input.pdSystemUserId}
       AND (${expectedVersion}::integer IS NULL OR version = ${expectedVersion})
       AND status IN ('scheduled', 'failed', 'sending')
       AND dynamics_email_id IS NULL
       AND send_requested_at IS NULL
       AND (locked_until IS NULL OR locked_until < NOW())
     RETURNING *
  `;
  return result.rows[0] || null;
}

/* --------------------------- digest run ledger --------------------------- */

const DIGEST_LEASE_MINUTES = 10;

/**
 * Claim today's digest run for a PD. The PK (pd_systemuser_id, digest_day) is
 * the one-digest-per-PD/day concurrency claim; the lease stops two live
 * invocations from both sending. MEMBERSHIP FREEZE: fyi_message_ids is set
 * ONLY on insert, never on re-claim — an unrecorded Dynamics activity may
 * already hold the first render, so recovery must stamp at most the first
 * claim's membership. A row rendered but outside it repeats tomorrow
 * (duplicate FYI, the accepted direction); a dropped FYI cannot happen.
 * Returns { claimed, run }; claimed=false means the run is accepted already
 * or another invocation holds the lease (run may be null only on a read race).
 */
export async function claimDigestRun({ pdSystemUserId, digestDay, fyiMessageIds }) {
  const membership = JSON.stringify(fyiMessageIds || []);
  const result = await sql`
    INSERT INTO scheduled_email_digest_runs (
      pd_systemuser_id, digest_day, fyi_message_ids, locked_until
    ) VALUES (
      ${pdSystemUserId}, ${digestDay}, ${membership}::jsonb,
      NOW() + make_interval(mins => ${DIGEST_LEASE_MINUTES})
    )
    ON CONFLICT (pd_systemuser_id, digest_day) DO UPDATE
      SET locked_until = NOW() + make_interval(mins => ${DIGEST_LEASE_MINUTES}),
          updated_at = NOW()
      WHERE scheduled_email_digest_runs.accepted_at IS NULL
        AND (scheduled_email_digest_runs.locked_until IS NULL
             OR scheduled_email_digest_runs.locked_until < NOW())
    RETURNING *
  `;
  if (result.rows[0]) return { claimed: true, run: result.rows[0] };
  const existing = await sql`
    SELECT * FROM scheduled_email_digest_runs
     WHERE pd_systemuser_id = ${pdSystemUserId} AND digest_day = ${digestDay}
     LIMIT 1
  `;
  return { claimed: false, run: existing.rows[0] || null };
}

export async function recordDigestRunActivity(pdSystemUserId, digestDay, activityId) {
  await sql`
    UPDATE scheduled_email_digest_runs
       SET activity_id = ${activityId}, updated_at = NOW()
     WHERE pd_systemuser_id = ${pdSystemUserId} AND digest_day = ${digestDay}
  `;
}

export async function markDigestRunAccepted(pdSystemUserId, digestDay) {
  await sql`
    UPDATE scheduled_email_digest_runs
       SET accepted_at = COALESCE(accepted_at, NOW()),
           locked_until = NULL,
           updated_at = NOW()
     WHERE pd_systemuser_id = ${pdSystemUserId} AND digest_day = ${digestDay}
  `;
}

export async function markDigestRunFyiStamped(pdSystemUserId, digestDay) {
  await sql`
    UPDATE scheduled_email_digest_runs
       SET fyi_stamped_at = COALESCE(fyi_stamped_at, NOW()),
           updated_at = NOW()
     WHERE pd_systemuser_id = ${pdSystemUserId} AND digest_day = ${digestDay}
  `;
}

/* ----------------------- per-PD VIP recipient flags ---------------------- */

export async function setScheduledEmailVipFlag(pdSystemUserId, contactId) {
  await sql`
    INSERT INTO scheduled_email_vip_flags (pd_systemuser_id, contact_id)
    VALUES (${pdSystemUserId}, ${contactId})
    ON CONFLICT (pd_systemuser_id, contact_id) DO NOTHING
  `;
  return true;
}

export async function clearScheduledEmailVipFlag(pdSystemUserId, contactId) {
  const result = await sql`
    DELETE FROM scheduled_email_vip_flags
     WHERE pd_systemuser_id = ${pdSystemUserId} AND contact_id = ${contactId}
  `;
  return result.rowCount || 0;
}

export async function listScheduledEmailVipFlags(pdSystemUserId) {
  const result = await sql`
    SELECT contact_id, created_at FROM scheduled_email_vip_flags
     WHERE pd_systemuser_id = ${pdSystemUserId}
     ORDER BY created_at DESC
  `;
  return result.rows;
}

/* ------------------ per-PD reviewer-person VIP flags --------------------- */
/* Keys on wmkf_potentialreviewersid, not contact: reviewer candidates have
 * no CRM contact until an identity-bearing acceptance (S389). Consumed
 * synchronously by the Invite Reviewers send flow; no ledger workflow reads
 * these flags. */

export async function setReviewerVipFlag(pdSystemUserId, potentialReviewerId) {
  await sql`
    INSERT INTO scheduled_email_reviewer_vip_flags (pd_systemuser_id, potential_reviewer_id)
    VALUES (${pdSystemUserId}, ${potentialReviewerId})
    ON CONFLICT (pd_systemuser_id, potential_reviewer_id) DO NOTHING
  `;
  return true;
}

export async function clearReviewerVipFlag(pdSystemUserId, potentialReviewerId) {
  const result = await sql`
    DELETE FROM scheduled_email_reviewer_vip_flags
     WHERE pd_systemuser_id = ${pdSystemUserId}
       AND potential_reviewer_id = ${potentialReviewerId}
  `;
  return result.rowCount || 0;
}

export async function listReviewerVipFlags(pdSystemUserId) {
  const result = await sql`
    SELECT potential_reviewer_id, created_at FROM scheduled_email_reviewer_vip_flags
     WHERE pd_systemuser_id = ${pdSystemUserId}
     ORDER BY created_at DESC
  `;
  return result.rows;
}

/**
 * Returns the subset of potentialReviewerIds this PD has flagged (Set of GUIDs).
 * No callers yet: built for the cron reviewer-reminder/thank-you slice, which
 * will route flagged people's reminders through the VIP hold instead of
 * auto-sending (see docs/SCHEDULED_EMAIL_VIP_DIGEST_PLAN.md, later slices).
 */
export async function filterVipFlaggedReviewers(pdSystemUserId, potentialReviewerIds) {
  const ids = (potentialReviewerIds || []).filter(Boolean);
  if (ids.length === 0) return new Set();
  const result = await sql`
    SELECT potential_reviewer_id FROM scheduled_email_reviewer_vip_flags
     WHERE pd_systemuser_id = ${pdSystemUserId}
       AND potential_reviewer_id = ANY(${ids}::uuid[])
  `;
  return new Set(result.rows.map((row) => row.potential_reviewer_id));
}

/** Returns the subset of contactIds this PD has flagged (as a Set of GUIDs). */
export async function filterVipFlaggedContacts(pdSystemUserId, contactIds) {
  const ids = (contactIds || []).filter(Boolean);
  if (ids.length === 0) return new Set();
  const result = await sql`
    SELECT contact_id FROM scheduled_email_vip_flags
     WHERE pd_systemuser_id = ${pdSystemUserId}
       AND contact_id = ANY(${ids}::uuid[])
  `;
  return new Set(result.rows.map((row) => row.contact_id));
}
