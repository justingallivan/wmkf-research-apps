/**
 * Postgres ledger for PD-reviewable scheduled email.
 *
 * Dataverse remains the workflow source and Dynamics remains the transport.
 * This store owns exact draft text, review actions, leases, and cross-system
 * receipts so a retry can reconcile rather than blindly create another email.
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
        recipient_name, subject, body_text, signature_text,
        scheduled_send_at, review_available_at, review_lead_days
      ) VALUES (
        ${input.id}, ${input.workflowType}, ${input.sourceRecordId},
        ${input.requestId}, ${input.deliverableId}, ${input.pdSystemUserId},
        ${input.pdName}, ${input.pdEmail},
        ${JSON.stringify(input.toRecipients)}::jsonb,
        ${JSON.stringify(input.ccRecipients || [])}::jsonb,
        ${input.recipientName}, ${input.subject}, ${input.bodyText},
        ${input.signatureText}, ${input.scheduledSendAt},
        ${input.reviewAvailableAt}, ${input.reviewLeadDays ?? null}
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

export async function listScheduledEmailsNeedingNotification({ limit = 100 } = {}) {
  const bounded = Math.min(200, Math.max(1, Number(limit) || 100));
  const result = await sql`
    SELECT * FROM scheduled_email_messages
     WHERE status = 'scheduled'
       AND review_lead_days IS NOT NULL
       AND review_available_at <= NOW()
       AND scheduled_send_at > NOW()
       AND notified_at IS NULL
       AND (notification_locked_until IS NULL OR notification_locked_until < NOW())
     ORDER BY review_available_at ASC
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

export async function claimScheduledEmailNotification(id, { lockSeconds = 180 } = {}) {
  const leaseToken = crypto.randomUUID();
  const seconds = Math.min(600, Math.max(30, Number(lockSeconds) || 180));
  const result = await sql`
    UPDATE scheduled_email_messages
       SET notification_lease_token = ${leaseToken},
           notification_locked_until = NOW() + (${seconds} || ' seconds')::INTERVAL,
           notification_error = NULL,
           updated_at = NOW()
     WHERE id = ${id}
       AND status = 'scheduled'
       AND review_lead_days IS NOT NULL
       AND review_available_at <= NOW()
       AND scheduled_send_at > NOW()
       AND notified_at IS NULL
       AND (notification_locked_until IS NULL OR notification_locked_until < NOW())
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function recordScheduledEmailNotificationActivity(message, emailId) {
  const result = await sql`
    UPDATE scheduled_email_messages
       SET notification_email_id = COALESCE(notification_email_id, ${emailId}),
           updated_at = NOW()
     WHERE id = ${message.id}
       AND notification_lease_token = ${message.notification_lease_token}
       AND (notification_email_id IS NULL OR notification_email_id = ${emailId})
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function recordScheduledEmailNotified(message) {
  const result = await sql`
    UPDATE scheduled_email_messages
       SET notified_at = COALESCE(notified_at, NOW()),
           notification_lease_token = NULL,
           notification_locked_until = NULL,
           notification_error = NULL,
           updated_at = NOW()
     WHERE id = ${message.id}
       AND notification_lease_token = ${message.notification_lease_token}
       AND notification_email_id IS NOT NULL
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function recordScheduledEmailNotificationFailure(message, error) {
  const text = String(error?.message || error || 'Review notification failed').slice(0, ERROR_MAX);
  const result = await sql`
    UPDATE scheduled_email_messages
       SET notification_lease_token = NULL,
           notification_locked_until = NULL,
           notification_error = ${text},
           updated_at = NOW()
     WHERE id = ${message.id}
       AND notification_lease_token = ${message.notification_lease_token}
     RETURNING *
  `;
  return result.rows[0] || null;
}
