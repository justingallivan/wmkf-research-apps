/**
 * Postgres store for applicant materials collections (migration 042). Rows
 * hold the checklist, the contacts snapshot, the sealed contributor link, the
 * due/close window, and send receipts. Files live in SharePoint and the
 * request-document registry, never here.
 */
import { sql } from '@vercel/postgres';

export async function getOpenCollectionForRequest(requestId) {
  const result = await sql`
    SELECT * FROM site_visit_material_collections
     WHERE request_id = ${requestId} AND status <> 'closed'
     ORDER BY created_at DESC LIMIT 1
  `;
  return result.rows[0] || null;
}

export async function getLatestCollectionForRequest(requestId) {
  const result = await sql`
    SELECT * FROM site_visit_material_collections
     WHERE request_id = ${requestId}
     ORDER BY created_at DESC LIMIT 1
  `;
  return result.rows[0] || null;
}

export async function getCollectionByDigest(tokenDigest) {
  const result = await sql`
    SELECT * FROM site_visit_material_collections WHERE token_digest = ${tokenDigest} LIMIT 1
  `;
  return result.rows[0] || null;
}

export async function insertCollection(row) {
  const result = await sql`
    INSERT INTO site_visit_material_collections (
      id, request_id, site_visit_activity_id, status, due_at, closes_at, checklist, contacts,
      jti, token_digest, token_ciphertext, created_by
    ) VALUES (
      ${row.id}, ${row.requestId}, ${row.siteVisitActivityId}, 'open',
      ${row.dueAt.toISOString()}, ${row.closesAt.toISOString()},
      ${JSON.stringify(row.checklist)}::jsonb, ${JSON.stringify(row.contacts)}::jsonb,
      ${row.jti}, ${row.tokenDigest}, ${row.tokenCiphertext}, ${row.createdBy}
    )
    RETURNING *
  `;
  return result.rows[0] || null;
}

export async function recordInvitation(id, emailId) {
  const result = await sql`
    UPDATE site_visit_material_collections
       SET invited_at = COALESCE(invited_at, NOW()), invitation_email_id = COALESCE(invitation_email_id, ${emailId}), updated_at = NOW()
     WHERE id = ${id}
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function recordReminder(id, emailId) {
  const result = await sql`
    UPDATE site_visit_material_collections
       SET last_reminder_at = NOW(), last_reminder_email_id = ${emailId}, reminder_count = reminder_count + 1, updated_at = NOW()
     WHERE id = ${id}
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function updateChecklist(id, checklist) {
  const result = await sql`
    UPDATE site_visit_material_collections
       SET checklist = ${JSON.stringify(checklist)}::jsonb, updated_at = NOW()
     WHERE id = ${id} AND status <> 'closed'
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function markReady(id, actorId) {
  const result = await sql`
    UPDATE site_visit_material_collections
       SET status = 'ready', ready_confirmed_at = NOW(), ready_confirmed_by = ${actorId}, updated_at = NOW()
     WHERE id = ${id} AND status = 'open'
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function reopenFromReady(id) {
  const result = await sql`
    UPDATE site_visit_material_collections
       SET status = 'open', ready_confirmed_at = NULL, ready_confirmed_by = NULL, updated_at = NOW()
     WHERE id = ${id} AND status = 'ready'
     RETURNING *
  `;
  return result.rows[0] || null;
}

/** Closes every collection past its window; returns the count. */
export async function closeExpiredCollections(now = new Date()) {
  const result = await sql`
    UPDATE site_visit_material_collections
       SET status = 'closed', updated_at = NOW()
     WHERE status <> 'closed' AND closes_at <= ${now.toISOString()}
     RETURNING id
  `;
  return result.rowCount || 0;
}
