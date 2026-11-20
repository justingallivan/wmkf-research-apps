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
    SELECT request_id, request_number, title, institution, project_leader, section, subsection, highlighted, own_institution
      FROM proposal_list_items
     WHERE link_id = ${linkId}
     ORDER BY section, subsection NULLS LAST, request_number
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
         section, subsection, highlighted, own_institution
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        linkId, item.requestId, item.requestNumber, item.title, item.institution,
        item.projectLeader, item.section, item.subsection || null, item.highlighted === true, item.ownInstitution === true,
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
 * Replace a live link's items with a fresh snapshot in one transaction, keeping
 * the link (and so the URL the recipient already holds) and the marks on
 * requests that are still listed. A request new to the list takes the
 * `highlighted` the caller set from advisor picks. Returns false when the link
 * is not live.
 *
 * The marks are read here, after taking the same link lock `setMarks` takes,
 * and never passed in by the caller: the snapshot read takes seconds, and marks
 * a second staff member saves during it must survive the replacement.
 */
export function replaceItems(linkId, snapshotItems) {
  return inTransaction(async (client) => {
    const live = await client.query(
      'SELECT id FROM proposal_list_links WHERE id = $1 AND revoked_at IS NULL FOR UPDATE',
      [linkId],
    );
    if (!live.rows[0]) return false;
    const current = await client.query(
      'SELECT request_id, highlighted, own_institution FROM proposal_list_items WHERE link_id = $1',
      [linkId],
    );
    const marks = new Map(current.rows.map((row) => [String(row.request_id).toLowerCase(), row]));
    const items = snapshotItems.map((item) => {
      const before = marks.get(String(item.requestId).toLowerCase());
      // A newly listed proposal takes the caller's highlight (its advisor pick).
      if (!before) return { ...item, highlighted: item.highlighted === true, ownInstitution: false };
      return { ...item, highlighted: before.highlighted === true, ownInstitution: before.own_institution === true };
    });
    await client.query('DELETE FROM proposal_list_items WHERE link_id = $1', [linkId]);
    await writeItems(client, linkId, items);
    await client.query('UPDATE proposal_list_links SET items_built_at = NOW() WHERE id = $1', [linkId]);
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

/** Advisor picks for one request (migration 105): the roster ids ticked for it. */
export async function listPicksForRequest(requestId) {
  const result = await sql`
    SELECT roster_id FROM proposal_list_advisor_picks
     WHERE request_id = ${requestId}
     ORDER BY roster_id
  `;
  return result.rows.map((row) => Number(row.roster_id));
}

/**
 * Tick or untick one advisor on one request. A repeat tick keeps the first
 * row (ON CONFLICT DO NOTHING); an untick of an absent row changes nothing.
 */
export async function setPick(requestId, rosterId, picked, pickedBy) {
  if (picked) {
    await sql`
      INSERT INTO proposal_list_advisor_picks (request_id, roster_id, picked_by)
      VALUES (${requestId}, ${rosterId}, ${pickedBy})
      ON CONFLICT (request_id, roster_id) DO NOTHING
    `;
  } else {
    await sql`
      DELETE FROM proposal_list_advisor_picks
       WHERE request_id = ${requestId} AND roster_id = ${rosterId}
    `;
  }
}

/**
 * Request ids ticked for one advisor, or for any advisor when rosterId is null
 * (a test list goes to the signed-in staff member, so it shows every pick).
 */
export async function listPickedRequestIds(rosterId) {
  const result = rosterId === null
    ? await sql`SELECT DISTINCT request_id FROM proposal_list_advisor_picks`
    : await sql`SELECT request_id FROM proposal_list_advisor_picks WHERE roster_id = ${rosterId}`;
  return result.rows.map((row) => String(row.request_id).toLowerCase());
}
