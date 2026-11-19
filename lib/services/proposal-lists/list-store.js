/**
 * Postgres store for proposal list links and their frozen items
 * (migration 101, docs/plans/J27_PROPOSAL_LIST_EMAILS_PLAN_2026-11-18.md).
 * The raw token is never written here; callers seal it before insert and
 * unseal after read.
 */
import { db, sql } from '@vercel/postgres';

export async function getLinkByDigest(tokenDigest) {
  const result = await sql`
    SELECT * FROM proposal_list_links WHERE token_digest = ${tokenDigest} LIMIT 1
  `;
  return result.rows[0] || null;
}

export async function getLinkById(id) {
  const result = await sql`
    SELECT * FROM proposal_list_links WHERE id = ${id} LIMIT 1
  `;
  return result.rows[0] || null;
}

/** Live (unrevoked) links for one cycle and kind, with item and highlight counts. */
export async function listLiveLinks(cycleCode, listKind) {
  const result = await sql`
    SELECT l.*,
           (SELECT COUNT(*)::int FROM proposal_list_items i WHERE i.link_id = l.id) AS item_count,
           (SELECT COUNT(*)::int FROM proposal_list_items i WHERE i.link_id = l.id AND i.highlighted) AS highlighted_count
      FROM proposal_list_links l
     WHERE l.cycle_code = ${cycleCode} AND l.list_kind = ${listKind} AND l.revoked_at IS NULL
     ORDER BY l.recipient_name, l.id
  `;
  return result.rows;
}

export async function listItems(linkId) {
  const result = await sql`
    SELECT request_id, request_number, title, institution, project_leader, section, highlighted, own_institution
      FROM proposal_list_items
     WHERE link_id = ${linkId}
     ORDER BY section, request_number
  `;
  return result.rows;
}

/** One item of one link, by request number; null when that request is not on the list. */
export async function getItem(linkId, requestNumber) {
  const result = await sql`
    SELECT request_id, request_number, title
      FROM proposal_list_items
     WHERE link_id = ${linkId} AND request_number = ${requestNumber}
     LIMIT 1
  `;
  return result.rows[0] || null;
}

async function writeItems(client, linkId, items) {
  for (const item of items) {
    await client.query(
      `INSERT INTO proposal_list_items (
         link_id, request_id, request_number, title, institution, project_leader,
         section, highlighted, own_institution
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        linkId, item.requestId, item.requestNumber, item.title, item.institution,
        item.projectLeader, item.section, item.highlighted === true, item.ownInstitution === true,
      ],
    );
  }
}

async function inTransaction(work) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const value = await work(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* connection already gone */ }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Insert a link and its items in one transaction. The partial unique index
 * admits one live link per cycle, kind, and recipient; a second create raises
 * 23505, which the service reports as "already has a link".
 */
export function insertLinkWithItems(link, items) {
  return inTransaction(async (client) => {
    const inserted = await client.query(
      `INSERT INTO proposal_list_links (
         id, cycle_code, list_kind, recipient_name, recipient_email, recipient_source,
         jti, token_digest, token_ciphertext, expires_at, items_built_at, created_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11)
       RETURNING *`,
      [
        link.id, link.cycleCode, link.listKind, link.recipientName, link.recipientEmail,
        link.recipientSource, link.jti, link.tokenDigest, link.tokenCiphertext,
        link.expiresAt.toISOString(), link.createdBy,
      ],
    );
    await writeItems(client, link.id, items);
    return inserted.rows[0];
  });
}

/**
 * Replace a live link's items in one transaction, keeping the link (and so the
 * URL the recipient already holds). Returns false when the link is not live.
 */
export function replaceItems(linkId, items) {
  return inTransaction(async (client) => {
    const live = await client.query(
      `UPDATE proposal_list_links SET items_built_at = NOW()
        WHERE id = $1 AND revoked_at IS NULL
        RETURNING id`,
      [linkId],
    );
    if (!live.rows[0]) return false;
    await client.query('DELETE FROM proposal_list_items WHERE link_id = $1', [linkId]);
    await writeItems(client, linkId, items);
    return true;
  });
}

/**
 * Set the highlighted and own-institution marks for a live link. Every item not
 * named is cleared, and only requests already on this link can be marked: the
 * update joins on link_id, so a foreign request id matches no row.
 */
export function setMarks(linkId, { highlightedRequestIds, ownInstitutionRequestIds }) {
  return inTransaction(async (client) => {
    const live = await client.query(
      'SELECT id FROM proposal_list_links WHERE id = $1 AND revoked_at IS NULL FOR UPDATE',
      [linkId],
    );
    if (!live.rows[0]) return false;
    await client.query(
      `UPDATE proposal_list_items
          SET highlighted = (request_id = ANY($2::uuid[])),
              own_institution = (request_id = ANY($3::uuid[]))
        WHERE link_id = $1`,
      [linkId, highlightedRequestIds, ownInstitutionRequestIds],
    );
    return true;
  });
}

/** Revoke a live link. Returns the revoked row, or null when it was not live. */
export async function revokeLink(linkId, revokedBy) {
  const result = await sql`
    UPDATE proposal_list_links
       SET revoked_at = NOW(), revoked_by = ${revokedBy}
     WHERE id = ${linkId} AND revoked_at IS NULL
     RETURNING *
  `;
  return result.rows[0] || null;
}
