/**
 * Postgres store for deliberation briefing links (migration 038,
 * docs/DELIBERATION_BRIEFING_PAGE_PLAN.md §2.2). Rows hold link identity,
 * a token digest, the sealed token, expiry, and revocation. The raw token is
 * never written here; callers seal it before insert and unseal after read.
 */
import { db, sql } from '@vercel/postgres';
import { ServiceHttpError } from '../service-http-error';

/**
 * Thrown by replaceLiveLink when a send bound to the live link is still
 * unresolved: it holds an unexpired lease, or it reached `send_requested`
 * recently and has not been reconciled to `sent` (an ambiguous Dynamics
 * SendEmail clears the lease but leaves the state unresolved until a retry
 * reads the status back).
 */
export function sendInProgressError() {
  const message = 'A send that carries the current briefing link has not finished. Retry it (or wait for it to reconcile) before issuing a new link.';
  return new ServiceHttpError(message, {
    httpStatus: 409,
    code: 'briefing_send_in_progress',
    body: { error: message, code: 'briefing_send_in_progress' },
  });
}

/** Thrown by replaceLiveLink when the live row is not the one the caller inspected. */
export function linkSupersededError() {
  const message = 'The briefing link was replaced by another action. Refresh to see the current link.';
  return new ServiceHttpError(message, {
    httpStatus: 409,
    code: 'briefing_link_superseded',
    body: { error: message, code: 'briefing_link_superseded' },
  });
}

// Window [ASSUMED, docs/DELIBERATION_BRIEFING_PAGE_PLAN.md §2.2] during which
// an unreconciled `send_requested` attempt still blocks reissue. Dynamics
// status readback resolves on the next retry within minutes; a preview
// abandoned after send intent stops blocking after this long.
const UNRESOLVED_SEND_WINDOW = '24 hours';

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
 *
 * Serialized against sends: inside the transaction the live link row and
 * every unsent distribution attempt bound to it are locked FOR UPDATE. A
 * concurrent `claimDistributionSend` UPDATE on those attempts waits for this
 * commit and then finds the link revoked; a send that already holds an
 * unexpired lease makes this call refuse with `briefing_send_in_progress`.
 */
export async function replaceLiveLink(requestId, replacement, { revokedBy, expectedLiveId = undefined }) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const live = await client.query(
      `SELECT id FROM deliberation_briefing_links
        WHERE request_id = $1 AND revoked_at IS NULL
        FOR UPDATE`,
      [requestId],
    );
    const liveId = live.rows[0]?.id || null;
    // Compare-and-swap: replace only the row the caller inspected, so two
    // concurrent recoveries cannot revoke each other's fresh replacement.
    if (expectedLiveId !== undefined
      && String(liveId || '').toLowerCase() !== String(expectedLiveId || '').toLowerCase()) {
      await client.query('ROLLBACK');
      throw linkSupersededError();
    }
    if (liveId) {
      // Lock EVERY unsent attempt bound to the link first, so a prepared
      // attempt cannot claim a send lease while this transaction is open;
      // only then evaluate which locked rows still block replacement.
      const bound = await client.query(
        `SELECT operation_id,
                (lease_token IS NOT NULL AND locked_until > NOW()) AS leased,
                (send_requested_at IS NOT NULL
                   AND send_requested_at > NOW() - $3::INTERVAL) AS unresolved
           FROM pre_site_distribution_attempts
          WHERE request_id = $1 AND briefing_link_id = $2
            AND state <> 'sent'
          FOR UPDATE`,
        [requestId, liveId, UNRESOLVED_SEND_WINDOW],
      );
      if (bound.rows.some((row) => row.leased === true || row.unresolved === true)) {
        await client.query('ROLLBACK');
        throw sendInProgressError();
      }
    }
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
