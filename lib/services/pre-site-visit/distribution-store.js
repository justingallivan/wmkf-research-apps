/**
 * Postgres recovery ledger for frozen Pre-Site informational distribution.
 * Stores identities, hashes, and step receipts only; attachment bytes remain in
 * SharePoint and the email activity remains in Dynamics.
 */
import crypto from 'node:crypto';
import { sql } from '@vercel/postgres';

const ERROR_MAX = 1000;

export async function createOrGetDistributionAttempt(input) {
  const result = await sql`
    WITH inserted AS (
      INSERT INTO pre_site_distribution_attempts (
        operation_id, request_id, source_document_id, attachment_mode,
        to_recipients, cc_recipients, subject, body_text, body_html,
        from_email, acting_user_system_id, draft_hash, template_version
      ) VALUES (
        ${input.operationId}, ${input.requestId}, ${input.sourceDocumentId},
        ${input.attachmentMode}, ${JSON.stringify(input.toRecipients)}::jsonb,
        ${JSON.stringify(input.ccRecipients)}::jsonb, ${input.subject},
        ${input.bodyText}, ${input.bodyHtml}, ${input.fromEmail},
        ${input.actingUserSystemId || null}, ${input.draftHash},
        ${input.templateVersion}
      )
      ON CONFLICT (operation_id) DO NOTHING
      RETURNING *
    )
    SELECT * FROM inserted
    UNION ALL
    SELECT * FROM pre_site_distribution_attempts
      WHERE operation_id = ${input.operationId}
    LIMIT 1
  `;
  return result.rows[0] || null;
}

export async function getDistributionAttempt(operationId) {
  const result = await sql`
    SELECT * FROM pre_site_distribution_attempts
     WHERE operation_id = ${operationId}
     LIMIT 1
  `;
  return result.rows[0] || null;
}

export async function listDistributionAttempts(requestId, { limit = 25 } = {}) {
  const result = await sql`
    SELECT * FROM pre_site_distribution_attempts
     WHERE request_id = ${requestId}
     ORDER BY created_at DESC
     LIMIT ${Math.min(100, Math.max(1, Number(limit) || 25))}
  `;
  return result.rows;
}

export async function recordDistributionSource(operationId, source) {
  const result = await sql`
    UPDATE pre_site_distribution_attempts
       SET source_drive_id = COALESCE(source_drive_id, ${source.driveId}),
           source_item_id = COALESCE(source_item_id, ${source.itemId}),
           source_version_id = COALESCE(source_version_id, ${source.versionId}),
           source_content_hash = COALESCE(source_content_hash, ${source.contentHash}),
           source_byte_hash = COALESCE(source_byte_hash, ${source.byteHash}),
           source_filename = COALESCE(source_filename, ${source.filename}),
           updated_at = NOW()
     WHERE operation_id = ${operationId}
       AND state = 'preparing'
       AND (source_version_id IS NULL OR (
         source_drive_id = ${source.driveId}
         AND source_item_id = ${source.itemId}
         AND source_version_id = ${source.versionId}
         AND source_content_hash = ${source.contentHash}
         AND source_byte_hash = ${source.byteHash}
       ))
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function recordDistributionPrepared(operationId, prepared) {
  const result = await sql`
    UPDATE pre_site_distribution_attempts
       SET docx_snapshot_document_id = ${prepared.docx.documentId},
           docx_drive_id = ${prepared.docx.driveId},
           docx_item_id = ${prepared.docx.itemId},
           docx_version_id = ${prepared.docx.versionId},
           docx_web_url = ${prepared.docx.webUrl},
           docx_filename = ${prepared.docx.filename},
           docx_content_type = ${prepared.docx.contentType},
           docx_byte_hash = ${prepared.docx.byteHash},
           docx_size = ${prepared.docx.size},
           pdf_snapshot_document_id = ${prepared.pdf?.documentId || null},
           pdf_drive_id = ${prepared.pdf?.driveId || null},
           pdf_item_id = ${prepared.pdf?.itemId || null},
           pdf_version_id = ${prepared.pdf?.versionId || null},
           pdf_web_url = ${prepared.pdf?.webUrl || null},
           pdf_filename = ${prepared.pdf?.filename || null},
           pdf_content_type = ${prepared.pdf?.contentType || null},
           pdf_byte_hash = ${prepared.pdf?.byteHash || null},
           pdf_size = ${prepared.pdf?.size || null},
           preview_hash = ${prepared.previewHash},
           state = 'prepared',
           last_error_code = NULL,
           last_error_message = NULL,
           updated_at = NOW()
     WHERE operation_id = ${operationId}
       AND state = 'preparing'
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function claimDistributionSend(operationId, { lockSeconds = 300 } = {}) {
  const leaseToken = crypto.randomUUID();
  const seconds = Math.min(900, Math.max(30, Number(lockSeconds) || 300));
  const result = await sql`
    UPDATE pre_site_distribution_attempts
       SET lease_token = ${leaseToken},
           locked_until = NOW() + (${seconds} || ' seconds')::INTERVAL,
           attempt_count = attempt_count + 1,
           last_error_code = NULL,
           last_error_message = NULL,
           updated_at = NOW()
     WHERE operation_id = ${operationId}
       AND state <> 'sent'
       AND (locked_until IS NULL OR locked_until < NOW())
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function recordDistributionEmailActivity(attempt, emailId) {
  return fencedPatch(attempt, {
    sql: sql`
      UPDATE pre_site_distribution_attempts
         SET dynamics_email_id = COALESCE(dynamics_email_id, ${emailId}),
             state = CASE WHEN state = 'prepared' THEN 'activity_created' ELSE state END,
             updated_at = NOW()
       WHERE operation_id = ${attempt.operation_id}
         AND lease_token = ${attempt.lease_token}
         AND (dynamics_email_id IS NULL OR dynamics_email_id = ${emailId})
       RETURNING *
    `,
  });
}

export async function recordDistributionAttachment(attempt, kind) {
  if (!['docx', 'pdf'].includes(kind)) throw new Error('Unknown distribution attachment kind');
  const result = kind === 'docx'
    ? await sql`
        UPDATE pre_site_distribution_attempts
           SET docx_attached_at = COALESCE(docx_attached_at, NOW()),
               state = CASE
                 WHEN attachment_mode = 'docx' OR pdf_attached_at IS NOT NULL
                   THEN 'attachments_added'
                 ELSE state
               END,
               updated_at = NOW()
         WHERE operation_id = ${attempt.operation_id}
           AND lease_token = ${attempt.lease_token}
         RETURNING *
      `
    : await sql`
        UPDATE pre_site_distribution_attempts
           SET pdf_attached_at = COALESCE(pdf_attached_at, NOW()),
               state = CASE
                 WHEN attachment_mode = 'pdf' OR docx_attached_at IS NOT NULL
                   THEN 'attachments_added'
                 ELSE state
               END,
               updated_at = NOW()
         WHERE operation_id = ${attempt.operation_id}
           AND lease_token = ${attempt.lease_token}
         RETURNING *
      `;
  return result.rows[0] || null;
}

export async function recordDistributionSendRequested(attempt) {
  const result = await sql`
    UPDATE pre_site_distribution_attempts
       SET state = 'send_requested',
           send_requested_at = COALESCE(send_requested_at, NOW()),
           updated_at = NOW()
     WHERE operation_id = ${attempt.operation_id}
       AND lease_token = ${attempt.lease_token}
       AND dynamics_email_id IS NOT NULL
       AND (
         (attachment_mode = 'docx' AND docx_attached_at IS NOT NULL)
         OR (attachment_mode = 'pdf' AND pdf_attached_at IS NOT NULL)
         OR (attachment_mode = 'both'
           AND docx_attached_at IS NOT NULL
           AND pdf_attached_at IS NOT NULL)
       )
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function recordDistributionSent(attempt, status = {}) {
  const result = await sql`
    UPDATE pre_site_distribution_attempts
       SET state = 'sent',
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
     WHERE operation_id = ${attempt.operation_id}
       AND lease_token = ${attempt.lease_token}
       AND dynamics_email_id IS NOT NULL
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function recordDistributionFailure(attempt, error, code = 'distribution_step_failed') {
  const message = String(error?.message || error || 'Distribution step failed').slice(0, ERROR_MAX);
  const result = await sql`
    UPDATE pre_site_distribution_attempts
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

async function fencedPatch(_attempt, { sql: query }) {
  const result = await query;
  return result.rows[0] || null;
}
