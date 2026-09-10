/**
 * Postgres store for deliberation briefing links (migration 038,
 * docs/DELIBERATION_BRIEFING_PAGE_PLAN.md §2.2). Rows hold link identity,
 * a token digest, the sealed token, expiry, and revocation. The raw token is
 * never written here; callers seal it before insert and unseal after read.
 */
import { db, sql } from '@vercel/postgres';

export async function getLiveLinkForRequest(requestId) {
  const result = await sql`
    SELECT * FROM deliberation_briefing_links
     WHERE request_id = ${requestId} AND revoked_at IS NULL
     LIMIT 1
  `;
  return result.rows[0] || null;
}

export async function getLinkByDigest(tokenDigest) {
  const result = await sql`
    SELECT * FROM deliberation_briefing_links
     WHERE token_digest = ${tokenDigest}
     LIMIT 1
  `;
  return result.rows[0] || null;
}

export async function getLinkById(id) {
  const result = await sql`
    SELECT * FROM deliberation_briefing_links WHERE id = ${id} LIMIT 1
  `;
  return result.rows[0] || null;
}

export async function insertLink(row) {
  const result = await sql`
    INSERT INTO deliberation_briefing_links (
      id, request_id, jti, token_digest, token_ciphertext, expires_at, created_by
    ) VALUES (
      ${row.id}, ${row.requestId}, ${row.jti}, ${row.tokenDigest},
      ${row.tokenCiphertext}, ${row.expiresAt.toISOString()}, ${row.createdBy}
    )
    RETURNING *
  `;
  return result.rows[0] || null;
}

/**
 * Revoke the live link for a request (if any) and insert its replacement in
 * one transaction, so the partial unique index never sees two live rows and
 * a reader never observes a request with no link between the two writes.
 */
export async function replaceLiveLink(requestId, replacement, { revokedBy }) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE deliberation_briefing_links
          SET revoked_at = NOW(), revoked_by = $2, superseded_by = $3
        WHERE request_id = $1 AND revoked_at IS NULL`,
      [requestId, revokedBy, replacement.id],
    );
    const inserted = await client.query(
      `INSERT INTO deliberation_briefing_links (
         id, request_id, jti, token_digest, token_ciphertext, expires_at, created_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        replacement.id, requestId, replacement.jti, replacement.tokenDigest,
        replacement.tokenCiphertext, replacement.expiresAt.toISOString(), replacement.createdBy,
      ],
    );
    await client.query('COMMIT');
    return inserted.rows[0] || null;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* connection already gone */ }
    throw error;
  } finally {
    client.release();
  }
}
