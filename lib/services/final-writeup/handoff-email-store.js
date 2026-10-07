/**
 * Postgres ledger for the group-review handoff email
 * (`final_writeup_handoff_emails`, migration 072).
 *
 * One row per handed-off draft (`source_document_id`). Insert is the send
 * intent and is idempotent on the primary key. A send claims the row with a
 * short lease and a fresh `lease_token`; only a `pending` row whose lease is
 * absent or expired can be claimed. Every later write requires the caller's
 * token, so a worker whose lease expired and was taken over can no longer
 * change the row. `sent` and `skipped` are terminal.
 */

import { sql } from '@vercel/postgres';

export const HANDOFF_EMAIL_LEASE_MINUTES = 5;

export async function insertHandoffEmailIntent({
  sourceDocumentId, requestId, grantProgramId, leadSystemUserId,
}) {
  const result = await sql`
    INSERT INTO final_writeup_handoff_emails (
      source_document_id, request_id, grant_program_id, lead_systemuser_id
    ) VALUES (
      ${sourceDocumentId}, ${requestId}, ${grantProgramId}, ${leadSystemUserId}
    )
    ON CONFLICT (source_document_id) DO UPDATE
      -- Reopen only an intent that expired because its transition never
      -- committed; a sent or otherwise skipped row is never reopened.
      -- created_at restarts the 14-day wait.
      SET state = 'pending',
          skip_reason = NULL,
          request_id = EXCLUDED.request_id,
          grant_program_id = EXCLUDED.grant_program_id,
          lead_systemuser_id = EXCLUDED.lead_systemuser_id,
          lease_token = NULL,
          locked_until = NULL,
          last_error_code = NULL,
          created_at = NOW(),
          updated_at = NOW()
      WHERE final_writeup_handoff_emails.state = 'skipped'
        AND final_writeup_handoff_emails.skip_reason = 'transition_not_committed'
    RETURNING source_document_id
  `;
  return { inserted: result.rows.length === 1 };
}

export async function getHandoffEmail(sourceDocumentId) {
  const result = await sql`
    SELECT * FROM final_writeup_handoff_emails
     WHERE source_document_id = ${sourceDocumentId}
     LIMIT 1
  `;
  return result.rows[0] || null;
}

/** Returns the claimed row with its new lease_token, or null when terminal or leased. */
export async function claimHandoffEmail(sourceDocumentId) {
  const result = await sql`
    UPDATE final_writeup_handoff_emails
       SET lease_token = gen_random_uuid(),
           locked_until = NOW() + make_interval(mins => ${HANDOFF_EMAIL_LEASE_MINUTES}),
           attempt_count = attempt_count + 1,
           updated_at = NOW()
     WHERE source_document_id = ${sourceDocumentId}
       AND state = 'pending'
       AND (locked_until IS NULL OR locked_until < NOW())
     RETURNING *
  `;
  return result.rows[0] || null;
}

/**
 * Fence: extend the lease only if this token still owns an unexpired lease.
 * Returns the current row, or null when the lease was lost.
 */
export async function renewHandoffEmailLease(sourceDocumentId, leaseToken) {
  const result = await sql`
    UPDATE final_writeup_handoff_emails
       SET locked_until = NOW() + make_interval(mins => ${HANDOFF_EMAIL_LEASE_MINUTES}),
           updated_at = NOW()
     WHERE source_document_id = ${sourceDocumentId}
       AND state = 'pending'
       AND lease_token = ${leaseToken}
       AND locked_until >= NOW()
     RETURNING *
  `;
  return result.rows[0] || null;
}

/** Bind the confirmed Final document produced from this draft. */
export async function recordHandoffEmailFinal(sourceDocumentId, finalDocumentId, leaseToken) {
  await sql`
    UPDATE final_writeup_handoff_emails
       SET final_document_id = ${finalDocumentId}, updated_at = NOW()
     WHERE source_document_id = ${sourceDocumentId}
       AND state = 'pending'
       AND lease_token = ${leaseToken}
       AND (final_document_id IS NULL OR final_document_id = ${finalDocumentId})
  `;
}

/**
 * Persist the Dynamics activity identity and frozen recipients before
 * transport. Records only for the lease owner and only when no activity is
 * recorded yet (or the same one). `recorded: false` means another worker owns
 * the send; the caller must not send.
 */
export async function recordHandoffEmailActivity(
  sourceDocumentId,
  { emailId, toRecipients, skippedRecipientCount },
  leaseToken,
) {
  const result = await sql`
    UPDATE final_writeup_handoff_emails
       SET dynamics_email_id = ${emailId},
           to_recipients = ${JSON.stringify(toRecipients)}::jsonb,
           skipped_recipient_count = ${skippedRecipientCount},
           updated_at = NOW()
     WHERE source_document_id = ${sourceDocumentId}
       AND state = 'pending'
       AND lease_token = ${leaseToken}
       AND (dynamics_email_id IS NULL OR dynamics_email_id = ${emailId})
     RETURNING source_document_id
  `;
  return { recorded: result.rows.length === 1 };
}

export async function markHandoffEmailSent(sourceDocumentId, emailId, leaseToken) {
  await sql`
    UPDATE final_writeup_handoff_emails
       SET state = 'sent',
           dynamics_email_id = COALESCE(dynamics_email_id, ${emailId}),
           sent_at = COALESCE(sent_at, NOW()),
           lease_token = NULL,
           locked_until = NULL,
           last_error_code = NULL,
           updated_at = NOW()
     WHERE source_document_id = ${sourceDocumentId}
       AND state = 'pending'
       AND lease_token = ${leaseToken}
  `;
}

export async function markHandoffEmailSkipped(sourceDocumentId, skipReason, leaseToken) {
  await sql`
    UPDATE final_writeup_handoff_emails
       SET state = 'skipped',
           skip_reason = ${skipReason},
           lease_token = NULL,
           locked_until = NULL,
           updated_at = NOW()
     WHERE source_document_id = ${sourceDocumentId}
       AND state = 'pending'
       AND lease_token = ${leaseToken}
  `;
}

/** The transition has not committed yet: release the lease without an error. */
export async function releaseHandoffEmail(sourceDocumentId, leaseToken) {
  await sql`
    UPDATE final_writeup_handoff_emails
       SET lease_token = NULL, locked_until = NULL, updated_at = NOW()
     WHERE source_document_id = ${sourceDocumentId}
       AND state = 'pending'
       AND lease_token = ${leaseToken}
  `;
}

/** Retryable failure: the row stays pending and the lease is released. */
export async function recordHandoffEmailFailure(sourceDocumentId, errorCode, leaseToken) {
  await sql`
    UPDATE final_writeup_handoff_emails
       SET last_error_code = ${String(errorCode || 'handoff_email_failed').slice(0, 120)},
           last_failed_at = NOW(),
           lease_token = NULL,
           locked_until = NULL,
           updated_at = NOW()
     WHERE source_document_id = ${sourceDocumentId}
       AND state = 'pending'
       AND lease_token = ${leaseToken}
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
