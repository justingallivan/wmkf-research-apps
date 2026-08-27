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

export async function listDueScheduledEmails({ limit = 100 } = {}) {
  const bounded = Math.min(200, Math.max(1, Number(limit) || 100));
  const result = await sql`
    SELECT * FROM scheduled_email_messages
     WHERE status IN ('scheduled', 'failed', 'sending')
       AND scheduled_send_at <= NOW()
       AND (approval_required = false OR approved_at IS NOT NULL)
       AND (locked_until IS NULL OR locked_until < NOW())
     ORDER BY scheduled_send_at ASC
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
       AND (locked_until IS NULL OR locked_until < NOW())
     RETURNING *
  `;
  return result.rows[0] || null;
}

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

export async function cancelScheduledEmailForSource(id, reason = 'source_no_longer_eligible') {
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
     RETURNING *
  `;
  return result.rows[0] || null;
}

/**
 * Revive a STOPPED, never-transported row whose source became eligible again
 * (reviewer re-invite after token expiry, reminder config re-enabled, manual
 * marker reset). The draft, send time, PD identity, and approval posture are
 * re-frozen from current state, exactly like creation. Refuses any row that
 * ever started transport (dynamics_email_id / send_requested_at) — a sent or
 * in-flight nudge is history, not a slot; a new nudge for such a source is
 * deliberately NOT possible under the (workflow_type, source_record_id)
 * uniqueness. Returns the revived row, or null when the guard refuses.
 */
export async function reviveStoppedScheduledEmail(input) {
  const result = await sql`
    UPDATE scheduled_email_messages
       SET status = 'scheduled',
           pd_systemuser_id = ${input.pdSystemUserId},
           pd_name = ${input.pdName},
           pd_email = ${input.pdEmail},
           to_recipients = ${JSON.stringify(input.toRecipients)}::jsonb,
           cc_recipients = ${JSON.stringify(input.ccRecipients || [])}::jsonb,
           recipient_name = ${input.recipientName},
           recipient_contact_ids = ${JSON.stringify(input.recipientContactIds || [])}::jsonb,
           subject = ${input.subject},
           body_text = ${input.bodyText},
           signature_text = ${input.signatureText},
           scheduled_send_at = ${input.scheduledSendAt},
           approval_required = ${input.approvalRequired === true},
           version = version + 1,
           stopped_at = NULL,
           reviewed_at = NULL,
           approved_at = NULL,
           edited_at = NULL,
           actioned_by_profile_id = NULL,
           last_error_code = NULL,
           last_error_message = NULL,
           updated_at = NOW()
     WHERE workflow_type = ${input.workflowType}
       AND source_record_id = ${input.sourceRecordId}
       AND status = 'stopped'
       AND dynamics_email_id IS NULL
       AND send_requested_at IS NULL
       AND (locked_until IS NULL OR locked_until < NOW())
     RETURNING *
  `;
  return result.rows[0] || null;
}

/**
 * Re-freeze an UNTOUCHED row's draft and send time from current source state
 * (reviewer sweeps: due-date extension, offset/lead change, template edit).
 * "Untouched" is strict: never PD-edited, never approved, no transport, no
 * lease, same PD (a PD change goes through reassignScheduledEmail instead).
 * approval_required is deliberately NOT refreshed — posture freezes at
 * creation/revive/reassign (the documented ledger invariant). Returns null
 * when the guard refuses (the PD's copy wins).
 */
export async function refreshUntouchedScheduledEmail(input) {
  const result = await sql`
    UPDATE scheduled_email_messages
       SET subject = ${input.subject},
           body_text = ${input.bodyText},
           signature_text = ${input.signatureText},
           scheduled_send_at = ${input.scheduledSendAt},
           to_recipients = ${JSON.stringify(input.toRecipients)}::jsonb,
           cc_recipients = ${JSON.stringify(input.ccRecipients || [])}::jsonb,
           recipient_name = ${input.recipientName},
           version = version + 1,
           updated_at = NOW()
     WHERE workflow_type = ${input.workflowType}
       AND source_record_id = ${input.sourceRecordId}
       AND pd_systemuser_id = ${input.pdSystemUserId}
       AND status IN ('scheduled', 'failed')
       AND edited_at IS NULL
       AND approved_at IS NULL
       AND dynamics_email_id IS NULL
       AND send_requested_at IS NULL
       AND (locked_until IS NULL OR locked_until < NOW())
       AND (subject IS DISTINCT FROM ${input.subject}
            OR body_text IS DISTINCT FROM ${input.bodyText}
            OR signature_text IS DISTINCT FROM ${input.signatureText}
            OR scheduled_send_at IS DISTINCT FROM ${input.scheduledSendAt}::timestamptz
            OR to_recipients IS DISTINCT FROM ${JSON.stringify(input.toRecipients)}::jsonb
            OR recipient_name IS DISTINCT FROM ${input.recipientName})
     RETURNING *
  `;
  return result.rows[0] || null;
}

/**
 * Cancel a queued row by its source identity (manual-nudge supersession: a
 * staff "send reminder now" makes the queued cron nudge redundant). Unlike
 * cancelScheduledEmailForSource, this deliberately refuses 'sending' rows and
 * held leases — nulling a live worker's lease would produce a sent-but-stopped
 * row; an in-flight send is left to resolve on its own.
 */
export async function cancelScheduledEmailBySource(workflowType, sourceRecordId, reason = 'superseded_by_manual_send') {
  const result = await sql`
    UPDATE scheduled_email_messages
       SET status = 'stopped',
           stopped_at = COALESCE(stopped_at, NOW()),
           last_error_code = ${String(reason).slice(0, 100)},
           last_error_message = 'A staff member sent this reminder manually; the scheduled copy was cancelled.',
           updated_at = NOW()
     WHERE workflow_type = ${workflowType}
       AND source_record_id = ${sourceRecordId}
       AND status IN ('scheduled', 'failed')
       AND (locked_until IS NULL OR locked_until < NOW())
     RETURNING *
  `;
  return result.rows[0] || null;
}

/**
 * Defer a claimed row to a later send time and release its lease (send-time
 * drift: the recomputed deadline moved into the future — due-date extension,
 * offset/lead config change, or a not-yet-expired hold). Lease-guarded so only
 * the claiming worker can defer its own row.
 */
export async function deferScheduledEmailSend(message, scheduledSendAt) {
  const result = await sql`
    UPDATE scheduled_email_messages
       SET status = 'scheduled',
           scheduled_send_at = ${scheduledSendAt},
           lease_token = NULL,
           locked_until = NULL,
           last_error_code = NULL,
           last_error_message = NULL,
           updated_at = NOW()
     WHERE id = ${message.id}
       AND lease_token = ${message.lease_token}
       AND status = 'sending'
       AND dynamics_email_id IS NULL
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
       AND (locked_until IS NULL OR locked_until < NOW())
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
export async function listScheduledEmailDigestRows({ limit = 500 } = {}) {
  const bounded = Math.min(1000, Math.max(1, Number(limit) || 500));
  const result = await sql`
    SELECT * FROM scheduled_email_messages
     WHERE (status IN ('scheduled', 'failed'))
        OR (status = 'sent' AND digest_fyi_at IS NULL)
     ORDER BY pd_systemuser_id, scheduled_send_at ASC
     LIMIT ${bounded}
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
 * PD handoff: atomically rebuild an UNSENT row under the request's current
 * PD. Guarded in SQL — fires only when the stored PD differs, the row is
 * still scheduled/failed, no transport state exists, and no send lease is
 * held; a concurrent send or a second rebuild no-ops on the WHERE. A
 * transport-started row deliberately stays under the former PD until its
 * retry resolves, preserving honest former-PD attribution. The correlation
 * recovery backstop is generation-blind, so clearing transport fields cannot
 * safely rebuild it. Deliberately discards the former PD's edits and approval
 * (approved_at/reviewed_at/edited_at → NULL): the draft is re-personalized and
 * re-enters the NEW PD's posture. scheduled_send_at is deliberately NOT
 * rebuilt — the send time derives from the immutable invite date and a
 * handoff never moves it.
 */
export async function reassignScheduledEmail(input) {
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
           reviewed_at = NULL,
           approved_at = NULL,
           edited_at = NULL,
           actioned_by_profile_id = NULL,
           last_error_code = NULL,
           last_error_message = NULL,
           updated_at = NOW()
     WHERE workflow_type = ${input.workflowType}
       AND source_record_id = ${input.sourceRecordId}
       AND pd_systemuser_id <> ${input.pdSystemUserId}
       AND status IN ('scheduled', 'failed')
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
 * synchronously by the Invite Reviewers send flow, and by the reviewer
 * cron-reminder sweeps to freeze approval_required at ledger-row creation. */

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
 * Consumed by the reviewer cron-reminder sweeps: a flagged person's reminder
 * row is created approval_required and waits in the VIP hold instead of
 * auto-sending (docs/SCHEDULED_EMAIL_VIP_DIGEST_PLAN.md, reviewer slice).
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
