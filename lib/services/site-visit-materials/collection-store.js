/**
 * Postgres store for applicant materials collections (migrations 042, 044). Rows
 * hold the checklist, the contacts snapshot, the sealed contributor link, the
 * due/close window, and send receipts. Files live in SharePoint and the
 * request-document registry, never here.
 */
import crypto from 'node:crypto';
import { sql } from '@vercel/postgres';

export const SLOT_LEASE_TTL_MS = 5 * 60_000;

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

/**
 * Newest collection per request (the open one when there is one, since a new
 * collection cannot start while another is open). Explicit uuid[] cast: pg
 * cannot infer a bound array parameter's element type on its own.
 */
export async function listLatestCollectionsForRequests(requestIds) {
  const ids = [...new Set((requestIds || []).map((id) => String(id).toLowerCase()).filter(Boolean))];
  if (ids.length === 0) return [];
  const result = await sql`
    SELECT DISTINCT ON (request_id) *
      FROM site_visit_material_collections
     WHERE request_id = ANY(${ids}::uuid[])
     ORDER BY request_id, created_at DESC
  `;
  return result.rows;
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

/**
 * Automatic reminder candidates (PR 3): open, invited, past due, still inside
 * the window, and no reminder of any kind recorded on or after the due date.
 */
export async function listCollectionsDueForAutomaticReminder(now = new Date()) {
  const at = now.toISOString();
  const result = await sql`
    SELECT * FROM site_visit_material_collections
     WHERE status = 'open'
       AND invited_at IS NOT NULL
       AND due_at <= ${at}
       AND closes_at > ${at}
       AND (last_reminder_at IS NULL OR last_reminder_at < due_at)
     ORDER BY due_at ASC, created_at ASC
  `;
  return result.rows;
}

/**
 * Claim-before-send for the automatic reminder: the same predicate as the
 * candidate read, re-checked atomically, so a concurrent run or a PC reminder
 * sent in between cannot produce a second email. Null when the claim is lost.
 */
export async function claimAutomaticReminder(id, now = new Date()) {
  const at = now.toISOString();
  const result = await sql`
    UPDATE site_visit_material_collections
       SET last_reminder_at = NOW(), last_reminder_email_id = NULL, reminder_count = reminder_count + 1, updated_at = NOW()
     WHERE id = ${id}
       AND status = 'open'
       AND invited_at IS NOT NULL
       AND due_at <= ${at}
       AND closes_at > ${at}
       AND (last_reminder_at IS NULL OR last_reminder_at < due_at)
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function attachReminderEmailId(id, emailId) {
  const result = await sql`
    UPDATE site_visit_material_collections
       SET last_reminder_email_id = ${emailId}, updated_at = NOW()
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

/**
 * Acquire the request collection's lease for one canonical checklist slot.
 * The conditional UPDATE is the serialization point: only an absent or
 * expired lease can be replaced, and unrelated slot leases are preserved.
 * The two jsonb_build_object arguments carry explicit casts: it is a variadic
 * "any" function, so Postgres cannot infer a bound parameter's type there and
 * fails with "could not determine data type of parameter" (production,
 * 2026-09-10, first applicant PDF finalize).
 */
export async function acquireSlotLease({ collectionId, slotKey }) {
  if (!collectionId || typeof slotKey !== 'string' || !slotKey) {
    throw new TypeError('collectionId and slotKey are required');
  }
  const leaseToken = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SLOT_LEASE_TTL_MS);
  const expiresAtMs = expiresAt.getTime();
  const result = await sql`
    UPDATE site_visit_material_collections
       SET slot_leases = jsonb_set(
             COALESCE(slot_leases, '{}'::jsonb),
             ARRAY[${slotKey}]::text[],
             jsonb_build_object('token', ${leaseToken}::text, 'expiresAt', ${expiresAtMs}::double precision),
             true
           ),
           updated_at = NOW()
     WHERE id = ${collectionId}
       AND (
         COALESCE(slot_leases, '{}'::jsonb) -> ${slotKey} IS NULL
         OR CASE
              WHEN jsonb_typeof(COALESCE(slot_leases, '{}'::jsonb) -> ${slotKey} -> 'expiresAt') = 'number'
              THEN (COALESCE(slot_leases, '{}'::jsonb) -> ${slotKey} ->> 'expiresAt')::double precision
                   < EXTRACT(EPOCH FROM NOW()) * 1000
              ELSE FALSE
            END
       )
     RETURNING id
  `;
  return result.rows[0] ? { leaseToken, expiresAt } : null;
}

/** Release only the lease held by this caller; a successor lease is untouched. */
export async function releaseSlotLease({ collectionId, slotKey, leaseToken }) {
  if (!collectionId || typeof slotKey !== 'string' || !slotKey || !leaseToken) return false;
  const result = await sql`
    UPDATE site_visit_material_collections
       SET slot_leases = COALESCE(slot_leases, '{}'::jsonb) - ${slotKey},
           updated_at = NOW()
     WHERE id = ${collectionId}
       AND COALESCE(slot_leases, '{}'::jsonb) -> ${slotKey} ->> 'token' = ${leaseToken}
     RETURNING id
  `;
  return Boolean(result.rows[0]);
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
