/**
 * Postgres ledger for the leadership daily digest
 * (`final_writeup_leadership_digests`, migration 073).
 *
 * One row per (recipient, digest day). The first claim inserts the row with
 * its frozen `membership`; a later claim on the same day only takes a fresh
 * lease and never rewrites membership. Only an unaccepted row whose lease is
 * absent or expired can be claimed. Every later write requires the caller's
 * `lease_token`, so a worker whose lease expired and was taken over can no
 * longer change the row. `accepted_at` is terminal.
 */

import { sql } from '@vercel/postgres';

export const LEADERSHIP_DIGEST_LEASE_MINUTES = 10;

export async function getLeadershipDigest(recipientSystemUserId, digestDay) {
  const result = await sql`
    SELECT * FROM final_writeup_leadership_digests
     WHERE recipient_systemuser_id = ${recipientSystemUserId} AND digest_day = ${digestDay}
     LIMIT 1
  `;
  return result.rows[0] || null;
}

/**
 * Final document ids already listed in an accepted digest to this recipient
 * on or after `sinceDay`. Unaccepted rows never count, so a digest that did
 * not go out leaves its writeups for the next one.
 */
export async function listToldFinalDocumentIds(recipientSystemUserId, sinceDay) {
  const result = await sql`
    SELECT DISTINCT lower(item->>'finalDocumentId') AS final_document_id
      FROM final_writeup_leadership_digests,
           jsonb_array_elements(membership) AS item
     WHERE recipient_systemuser_id = ${recipientSystemUserId}
       AND digest_day >= ${sinceDay}
       AND accepted_at IS NOT NULL
  `;
  return result.rows.map((row) => row.final_document_id).filter(Boolean);
}

/**
 * Claim today's digest for one recipient. Insert freezes membership; a
 * re-claim of an unaccepted row with no live lease takes a new lease only.
 * Returns { claimed, row }: claimed=false means the row is accepted or another
 * invocation holds the lease (row may be null only on a read race).
 */
export async function claimLeadershipDigest({
  recipientSystemUserId, digestDay, recipientAddress, membership,
}) {
  const result = await sql`
    INSERT INTO final_writeup_leadership_digests (
      recipient_systemuser_id, digest_day, membership, recipient_address,
      attempt_count, lease_token, locked_until
    ) VALUES (
      ${recipientSystemUserId}, ${digestDay}, ${JSON.stringify(membership)}::jsonb, ${recipientAddress},
      1, gen_random_uuid(), NOW() + make_interval(mins => ${LEADERSHIP_DIGEST_LEASE_MINUTES})
    )
    ON CONFLICT (recipient_systemuser_id, digest_day) DO UPDATE
      SET lease_token = gen_random_uuid(),
          locked_until = NOW() + make_interval(mins => ${LEADERSHIP_DIGEST_LEASE_MINUTES}),
          attempt_count = final_writeup_leadership_digests.attempt_count + 1,
          updated_at = NOW()
      WHERE final_writeup_leadership_digests.accepted_at IS NULL
        AND (final_writeup_leadership_digests.locked_until IS NULL
             OR final_writeup_leadership_digests.locked_until < NOW())
    RETURNING *
  `;
  if (result.rows[0]) return { claimed: true, row: result.rows[0] };
  return { claimed: false, row: await getLeadershipDigest(recipientSystemUserId, digestDay) };
}

/** Extend the lease as a fence before a Dynamics side effect; 0 means the lease was lost. */
export async function renewLeadershipDigestLease(recipientSystemUserId, digestDay, leaseToken) {
  const result = await sql`
    UPDATE final_writeup_leadership_digests
       SET locked_until = NOW() + make_interval(mins => ${LEADERSHIP_DIGEST_LEASE_MINUTES}),
           updated_at = NOW()
     WHERE recipient_systemuser_id = ${recipientSystemUserId} AND digest_day = ${digestDay}
       AND lease_token = ${leaseToken}
       AND accepted_at IS NULL
  `;
  return result.rowCount || 0;
}

/** Record the activity identity once, before transport; 0 means lost lease or already recorded. */
export async function recordLeadershipDigestActivity(recipientSystemUserId, digestDay, leaseToken, emailId) {
  const result = await sql`
    UPDATE final_writeup_leadership_digests
       SET dynamics_email_id = ${emailId}, updated_at = NOW()
     WHERE recipient_systemuser_id = ${recipientSystemUserId} AND digest_day = ${digestDay}
       AND lease_token = ${leaseToken}
       AND dynamics_email_id IS NULL
  `;
  return result.rowCount || 0;
}

export async function markLeadershipDigestAccepted(recipientSystemUserId, digestDay, leaseToken) {
  const result = await sql`
    UPDATE final_writeup_leadership_digests
       SET accepted_at = COALESCE(accepted_at, NOW()),
           lease_token = NULL,
           locked_until = NULL,
           last_error_code = NULL,
           updated_at = NOW()
     WHERE recipient_systemuser_id = ${recipientSystemUserId} AND digest_day = ${digestDay}
       AND lease_token = ${leaseToken}
       AND dynamics_email_id IS NOT NULL
  `;
  return result.rowCount || 0;
}

export async function recordLeadershipDigestFailure(recipientSystemUserId, digestDay, leaseToken, errorCode) {
  const result = await sql`
    UPDATE final_writeup_leadership_digests
       SET last_error_code = ${errorCode},
           last_failed_at = NOW(),
           lease_token = NULL,
           locked_until = NULL,
           updated_at = NOW()
     WHERE recipient_systemuser_id = ${recipientSystemUserId} AND digest_day = ${digestDay}
       AND lease_token = ${leaseToken}
       AND accepted_at IS NULL
  `;
  return result.rowCount || 0;
}
