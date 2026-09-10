/** Postgres ledger operations for frozen deliberation-session agenda emails. */
import crypto from 'node:crypto';
import { sql } from '@vercel/postgres';

const ERROR_MAX = 1000;

export async function createOrGetAgendaSend(input) {
  const result = await sql`
    WITH inserted AS (
      INSERT INTO deliberation_agenda_sends (
        operation_id, session_id, agenda_snapshot, to_recipients,
        cc_recipients, subject, body_text, body_html, from_email,
        acting_user_system_id
      ) VALUES (
        ${input.operationId}, ${input.sessionId},
        ${JSON.stringify(input.agendaSnapshot)}::jsonb,
        ${JSON.stringify(input.toRecipients)}::jsonb,
        ${JSON.stringify(input.ccRecipients)}::jsonb,
        ${input.subject}, ${input.bodyText}, ${input.bodyHtml},
        ${input.fromEmail}, ${input.actingUserSystemId || null}
      )
      ON CONFLICT (operation_id) DO NOTHING
      RETURNING *, TRUE AS inserted
    )
    SELECT * FROM inserted
    UNION ALL
    SELECT deliberation_agenda_sends.*, FALSE AS inserted
      FROM deliberation_agenda_sends
      WHERE operation_id = ${input.operationId}
    LIMIT 1
  `;
  return result.rows[0] || null;
}

export async function getAgendaSend(operationId) {
  const result = await sql`
    SELECT * FROM deliberation_agenda_sends
     WHERE operation_id = ${operationId}
     LIMIT 1
  `;
  return result.rows[0] || null;
}

export async function getLatestSentAgendaSend(sessionId) {
  const result = await sql`
    SELECT * FROM deliberation_agenda_sends
     WHERE session_id = ${sessionId}
       AND state = 'sent'
     ORDER BY sent_at DESC NULLS LAST, created_at DESC
     LIMIT 1
  `;
  return result.rows[0] || null;
}

export async function getLatestUnresolvedAgendaSend(sessionId) {
  const result = await sql`
    SELECT * FROM deliberation_agenda_sends
     WHERE session_id = ${sessionId}
       AND state = 'send_requested'
     ORDER BY send_requested_at DESC NULLS LAST, created_at DESC
     LIMIT 1
  `;
  return result.rows[0] || null;
}

export async function claimAgendaSend(operationId, { lockSeconds = 300 } = {}) {
  const leaseToken = crypto.randomUUID();
  const seconds = Math.min(900, Math.max(30, Number(lockSeconds) || 300));
  const result = await sql`
    UPDATE deliberation_agenda_sends
       SET lease_token = ${leaseToken},
           locked_until = NOW() + (${seconds} || ' seconds')::INTERVAL,
           attempt_count = attempt_count + 1,
           last_error_code = NULL,
           last_error_message = NULL,
           updated_at = NOW()
     WHERE operation_id = ${operationId}
       AND state NOT IN ('sent', 'failed')
       AND (locked_until IS NULL OR locked_until < NOW())
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function recordAgendaEmailActivity(attempt, emailId) {
  const result = await sql`
    UPDATE deliberation_agenda_sends
       SET dynamics_email_id = COALESCE(dynamics_email_id, ${emailId}),
           state = CASE WHEN state = 'prepared' THEN 'activity_created' ELSE state END,
           updated_at = NOW()
     WHERE operation_id = ${attempt.operation_id}
       AND lease_token = ${attempt.lease_token}
       AND (dynamics_email_id IS NULL OR dynamics_email_id = ${emailId})
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function recordAgendaSendRequested(attempt) {
  const result = await sql`
    UPDATE deliberation_agenda_sends
       SET state = 'send_requested',
           send_requested_at = COALESCE(send_requested_at, NOW()),
           updated_at = NOW()
     WHERE operation_id = ${attempt.operation_id}
       AND lease_token = ${attempt.lease_token}
       AND dynamics_email_id IS NOT NULL
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function recordAgendaDraftReconciled(attempt, status = {}) {
  const result = await sql`
    UPDATE deliberation_agenda_sends
       SET state = 'activity_created',
           send_requested_at = NULL,
           dynamics_statecode = ${status.statecode ?? null},
           dynamics_statuscode = ${status.statuscode ?? null},
           updated_at = NOW()
     WHERE operation_id = ${attempt.operation_id}
       AND lease_token = ${attempt.lease_token}
       AND state = 'send_requested'
       AND dynamics_email_id IS NOT NULL
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function recordAgendaTerminalFailure(attempt, status = {}, message = 'Dynamics closed the agenda email without accepted transport.') {
  const result = await sql`
    UPDATE deliberation_agenda_sends
       SET state = 'failed',
           dynamics_statecode = ${status.statecode ?? null},
           dynamics_statuscode = ${status.statuscode ?? null},
           lease_token = NULL,
           locked_until = NULL,
           last_error_code = 'agenda_send_terminal',
           last_error_message = ${String(message).slice(0, ERROR_MAX)},
           last_failed_at = NOW(),
           updated_at = NOW()
     WHERE operation_id = ${attempt.operation_id}
       AND lease_token = ${attempt.lease_token}
       AND state = 'send_requested'
       AND dynamics_email_id IS NOT NULL
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function renewAgendaSendLease(attempt, { lockSeconds = 300 } = {}) {
  const seconds = Math.min(900, Math.max(30, Number(lockSeconds) || 300));
  const result = await sql`
    UPDATE deliberation_agenda_sends
       SET locked_until = NOW() + (${seconds} || ' seconds')::INTERVAL,
           updated_at = NOW()
     WHERE operation_id = ${attempt.operation_id}
       AND lease_token = ${attempt.lease_token}
       AND state = 'send_requested'
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function recordAgendaSent(attempt, status = {}) {
  const result = await sql`
    UPDATE deliberation_agenda_sends
       SET state = 'sent',
           send_requested_at = COALESCE(send_requested_at, NOW()),
           sent_at = COALESCE(sent_at, NOW()),
           dynamics_statecode = ${status.statecode ?? null},
           dynamics_statuscode = ${status.statuscode ?? null},
           lease_token = NULL,
           locked_until = NULL,
           last_error_code = NULL,
           last_error_message = NULL,
           updated_at = NOW()
     WHERE operation_id = ${attempt.operation_id}
       AND lease_token = ${attempt.lease_token}
       AND dynamics_email_id IS NOT NULL
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function recordAgendaFailure(attempt, error, code = 'agenda_send_failed') {
  const message = String(error?.message || error || 'Agenda send failed').slice(0, ERROR_MAX);
  const result = await sql`
    UPDATE deliberation_agenda_sends
       SET lease_token = NULL,
           locked_until = NULL,
           last_error_code = ${String(code).slice(0, 100)},
           last_error_message = ${message},
           last_failed_at = NOW(),
           updated_at = NOW()
     WHERE operation_id = ${attempt.operation_id}
       AND lease_token = ${attempt.lease_token}
     RETURNING *
  `;
  return result.rows[0] || null;
}
