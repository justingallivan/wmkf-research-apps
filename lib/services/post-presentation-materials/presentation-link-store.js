/** Postgres store for the independent materials-only presentation links. */
import { db, sql } from '@vercel/postgres';
import { ServiceHttpError } from '../service-http-error.js';

export function presentationLinkSupersededError() {
  const message = 'The presentation link was replaced by another action. Refresh to see the current link.';
  return new ServiceHttpError(message, {
    httpStatus: 409,
    code: 'presentation_link_superseded',
    body: { error: message, code: 'presentation_link_superseded' },
  });
}

export async function getLiveLinkForRequest(requestId) {
  const result = await sql`
    SELECT * FROM presentation_material_links
     WHERE request_id = ${requestId} AND revoked_at IS NULL
     LIMIT 1
  `;
  return result.rows[0] || null;
}

export async function getLinkByDigest(tokenDigest) {
  const result = await sql`
    SELECT * FROM presentation_material_links
     WHERE token_digest = ${tokenDigest}
     LIMIT 1
  `;
  return result.rows[0] || null;
}

export async function insertLink(row) {
  const result = await sql`
    INSERT INTO presentation_material_links (
      id, request_id, jti, token_digest, token_ciphertext, expires_at, created_by
    ) VALUES (
      ${row.id}, ${row.requestId}, ${row.jti}, ${row.tokenDigest},
      ${row.tokenCiphertext}, ${row.expiresAt.toISOString()}, ${row.createdBy}
    )
    RETURNING *
  `;
  return result.rows[0] || null;
}

/** Atomically replace exactly the live row inspected by the caller. */
export async function replaceLiveLink(requestId, replacement, { revokedBy, expectedLiveId }) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const live = await client.query(
      `SELECT id FROM presentation_material_links
        WHERE request_id = $1 AND revoked_at IS NULL
        FOR UPDATE`,
      [requestId],
    );
    const liveId = live.rows[0]?.id || null;
    if (String(liveId || '').toLowerCase() !== String(expectedLiveId || '').toLowerCase()) {
      await client.query('ROLLBACK');
      throw presentationLinkSupersededError();
    }
    await client.query(
      `UPDATE presentation_material_links
          SET revoked_at = NOW(), revoked_by = $2, superseded_by = $3
        WHERE request_id = $1 AND revoked_at IS NULL`,
      [requestId, revokedBy, replacement.id],
    );
    const inserted = await client.query(
      `INSERT INTO presentation_material_links (
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
