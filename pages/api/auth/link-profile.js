/**
 * API Route: Link Azure account to existing profile
 *
 * POST /api/auth/link-profile
 * Body:
 *   - profileId: ID of existing profile to link (for linking)
 *   - createNew: true to create new profile instead
 *
 * Identity (azureId, azureEmail, displayName) is always derived from the
 * server-side session — never trusted from the request body.
 *
 * Live-active guard: the caller's azure_id is re-checked under a row lock
 * before any identity write. Zero rows, is_active = false/NULL, or a caller
 * row that is no longer in the linking state fails closed. `createNew`
 * finalizes the locked temporary row in place. The existing-profile branch
 * locks caller + target and performs the delete/update transfer in one
 * transaction, rolling the delete back if the target update cannot commit.
 */

import { getServerSession } from 'next-auth';
import { db } from '@vercel/postgres';
import { authOptions } from './[...nextauth]';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify the user is authenticated
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  // Only users in the first-login linking flow may use this endpoint.
  // Once linked (needs_linking = false), this becomes inaccessible,
  // preventing already-linked users from claiming additional profiles.
  if (!session.user.needsLinking) {
    return res.status(403).json({ error: 'Account is already linked' });
  }

  // Derive identity from the trusted session, not the request body.
  const azureId = session.user.azureId;
  const azureEmail = session.user.azureEmail;
  const displayName = session.user.name || azureEmail;
  const { profileId, createNew } = req.body;

  if (!createNew && !profileId) {
    return res.status(400).json({ error: 'Profile ID required' });
  }

  let client;
  let writePhase = false;
  let transactionOpen = false;
  let releaseError;
  try {
    client = await db.connect();
    await client.query('BEGIN');
    transactionOpen = true;

    const rollback = async () => {
      if (!transactionOpen) return;
      await client.query('ROLLBACK');
      transactionOpen = false;
    };

    // Lock the durable caller row before deciding whether linking may write.
    // An archive that commits first makes this row non-active and fails the
    // check. An archive that arrives second waits for this transaction and
    // must observe the final row-count outcome rather than falsely succeeding.
    const caller = await client.query(
      `SELECT id, is_active, needs_linking
         FROM user_profiles
        WHERE azure_id = $1
        FOR UPDATE`,
      [azureId],
    );

    if (caller.rows.length === 0 || caller.rows[0].is_active !== true) {
      await rollback();
      return res.status(403).json({ error: 'Account has been disabled' });
    }

    if (caller.rows[0].needs_linking !== true) {
      await rollback();
      return res.status(403).json({ error: 'Account is already linked' });
    }

    const callerProfileId = caller.rows[0].id;

    if (createNew) {
      // The temporary profile already IS the new user's durable identity and
      // already owns its default app grants. Finalize it in place so an
      // archive racing this request continues to address the same row.
      writePhase = true;
      const result = await client.query(
        `UPDATE user_profiles
            SET name = $1,
                display_name = $2,
                azure_email = $3,
                is_default = false,
                needs_linking = false,
                last_used_at = CURRENT_TIMESTAMP
          WHERE id = $4
            AND azure_id = $5
            AND is_active = true
            AND needs_linking = true
        RETURNING id, name, display_name`,
        [azureEmail, displayName, azureEmail, callerProfileId, azureId],
      );

      if (result.rows.length === 0) {
        await rollback();
        return res.status(409).json({ error: 'Profile could not be linked' });
      }

      await client.query('COMMIT');
      transactionOpen = false;

      return res.status(200).json({
        success: true,
        profile: result.rows[0],
        message: 'New profile created and linked',
      });
    }

    // Link to existing profile — require the profile's stored email to match
    // the caller's Azure email. This prevents a first-time user from claiming
    // another person's profile by ID. Profiles whose email does not match
    // must be linked by an admin (update the profile's azure_email first).
    // FOR UPDATE makes target disablement serialize with this transfer.
    const existing = await client.query(
      `SELECT id, azure_id, name, display_name
         FROM user_profiles
        WHERE id = $1
          AND is_active = true
          AND azure_email = $2
        FOR UPDATE`,
      [profileId, azureEmail],
    );

    if (existing.rows.length === 0) {
      await rollback();
      return res.status(404).json({ error: 'Profile not found or email does not match your account' });
    }

    if (existing.rows[0].azure_id && existing.rows[0].azure_id !== azureId) {
      await rollback();
      return res.status(400).json({ error: 'Profile is already linked to another account' });
    }

    writePhase = true;

    // Remove the locked temporary row only inside this transaction. If the
    // target update below fails, ROLLBACK restores it; there is no committed
    // rowless interval and no path from a failed claim to reprovisioning.
    if (String(callerProfileId) !== String(profileId)) {
      const deleted = await client.query(
        `DELETE FROM user_profiles
          WHERE id = $1
            AND azure_id = $2
            AND needs_linking = true
            AND is_active = true
        RETURNING id`,
        [callerProfileId, azureId],
      );

      if (deleted.rows.length === 0) {
        await rollback();
        return res.status(409).json({ error: 'Profile could not be linked' });
      }
    }

    const updated = await client.query(
      `UPDATE user_profiles
          SET azure_id = $1,
              azure_email = $2,
              needs_linking = false,
              last_login_at = CURRENT_TIMESTAMP
        WHERE id = $3
          AND is_active = true
          AND azure_email = $2
      RETURNING id, azure_id, name, display_name`,
      [azureId, azureEmail, profileId],
    );

    if (updated.rows.length === 0) {
      await rollback();
      return res.status(409).json({ error: 'Profile could not be linked' });
    }

    await client.query('COMMIT');
    transactionOpen = false;

    return res.status(200).json({
      success: true,
      profile: updated.rows[0],
      message: 'Profile linked successfully',
    });
  } catch (error) {
    if (client && transactionOpen) {
      try {
        await client.query('ROLLBACK');
        transactionOpen = false;
      } catch (rollbackError) {
        // Destroy, rather than reuse, a pooled connection whose transaction
        // could not be rolled back.
        releaseError = rollbackError;
        console.error('Error rolling back profile link transaction:', rollbackError);
      }
    }
    console.error('Error linking profile:', error);
    return writePhase
      ? res.status(500).json({ error: 'Failed to link profile' })
      : res.status(503).json({ error: 'Unable to verify account status; please retry' });
  } finally {
    client?.release(releaseError);
  }
}
