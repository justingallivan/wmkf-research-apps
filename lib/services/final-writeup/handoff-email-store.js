/**
 * Postgres ledger for the group-review handoff email
 * (`final_writeup_handoff_emails`, migration 072).
 *
 * One row per Final document. Insert is the send intent and is idempotent on
 * the primary key. A send claims the row with a short lease that only a
 * `pending` row whose lease is absent or expired can take, so two live
 * invocations never both send. `sent` and `skipped` are terminal.
 */

import { sql } from '@vercel/postgres';

export const HANDOFF_EMAIL_LEASE_MINUTES = 5;

export async function insertHandoffEmailIntent({
  finalDocumentId, requestId, grantProgramId, leadSystemUserId,
}) {
  const result = await sql`
    INSERT INTO final_writeup_handoff_emails (
      final_document_id, request_id, grant_program_id, lead_systemuser_id
    ) VALUES (
      ${finalDocumentId}, ${requestId}, ${grantProgramId}, ${leadSystemUserId}
    )
    ON CONFLICT (final_document_id) DO NOTHING
    RETURNING final_document_id
  `;
  return { inserted: result.rows.length === 1 };
}

export async function getHandoffEmail(finalDocumentId) {
  const result = await sql`
    SELECT * FROM final_writeup_handoff_emails
     WHERE final_document_id = ${finalDocumentId}
     LIMIT 1
  `;
  return result.rows[0] || null;
}

/** Returns the claimed row, or null when it is terminal or another call holds the lease. */
export async function claimHandoffEmail(finalDocumentId) {
  const result = await sql`
    UPDATE final_writeup_handoff_emails
       SET locked_until = NOW() + make_interval(mins => ${HANDOFF_EMAIL_LEASE_MINUTES}),
           attempt_count = attempt_count + 1,
           updated_at = NOW()
     WHERE final_document_id = ${finalDocumentId}
       AND state = 'pending'
       AND (locked_until IS NULL OR locked_until < NOW())
     RETURNING *
  `;
  return result.rows[0] || null;
}

/** Persist the Dynamics activity identity and frozen recipients before transport. */
export async function recordHandoffEmailActivity(finalDocumentId, { emailId, toRecipients, skippedRecipientCount }) {
  await sql`
    UPDATE final_writeup_handoff_emails
       SET dynamics_email_id = ${emailId},
           to_recipients = ${JSON.stringify(toRecipients)}::jsonb,
           skipped_recipient_count = ${skippedRecipientCount},
           updated_at = NOW()
     WHERE final_document_id = ${finalDocumentId}
       AND state = 'pending'
  `;
}

export async function markHandoffEmailSent(finalDocumentId, emailId) {
  await sql`
    UPDATE final_writeup_handoff_emails
       SET state = 'sent',
           dynamics_email_id = COALESCE(dynamics_email_id, ${emailId}),
           sent_at = COALESCE(sent_at, NOW()),
           locked_until = NULL,
           last_error_code = NULL,
           updated_at = NOW()
     WHERE final_document_id = ${finalDocumentId}
       AND state IN ('pending', 'sent')
  `;
}

export async function markHandoffEmailSkipped(finalDocumentId, skipReason) {
  await sql`
    UPDATE final_writeup_handoff_emails
       SET state = 'skipped',
           skip_reason = ${skipReason},
           locked_until = NULL,
           updated_at = NOW()
     WHERE final_document_id = ${finalDocumentId}
       AND state = 'pending'
  `;
}

/** Retryable failure: the row stays pending and the lease is released. */
export async function recordHandoffEmailFailure(finalDocumentId, errorCode) {
  await sql`
    UPDATE final_writeup_handoff_emails
       SET last_error_code = ${String(errorCode || 'handoff_email_failed').slice(0, 120)},
           last_failed_at = NOW(),
           locked_until = NULL,
           updated_at = NOW()
     WHERE final_document_id = ${finalDocumentId}
       AND state = 'pending'
  `;
}

export async function listPendingHandoffEmails({ limit = 25 } = {}) {
  const bounded = Math.max(1, Math.min(Number(limit) || 25, 100));
  const result = await sql`
    SELECT * FROM final_writeup_handoff_emails
     WHERE state = 'pending'
       AND (locked_until IS NULL OR locked_until < NOW())
     ORDER BY created_at ASC
     LIMIT ${bounded}
  `;
  return result.rows;
}
