/**
 * Dynamics Identity Reconciliation
 *
 * Resolves user_profiles.azure_email → Dynamics systemuser.internalemailaddress
 * and persists the mapping in user_profiles.dynamics_systemuser_id +
 * dynamics_reconciled_at.
 *
 * Used by:
 *   - NextAuth signIn callback (one profile, fire-and-forget on first login)
 *   - pages/api/cron/reconcile-identities.js (weekly batch refresh)
 *   - scripts/reconcile-dynamics-identities.js (manual backfill / CLI)
 *
 * Plan: docs/DYNAMICS_IDENTITY_RECONCILIATION_PLAN.md
 */

import { sql } from '@vercel/postgres';
import * as systemUserAdapter from '../dataverse/adapters/system-user.js';

const RESULT = {
  LINKED: 'linked',
  UNCHANGED: 'unchanged',
  NO_MATCH: 'no_match',
  DISABLED: 'disabled',
  SKIPPED_NO_EMAIL: 'skipped_no_email',
  ERROR: 'error',
};

/**
 * Look up the Dynamics systemuser for a single profile and persist the mapping.
 *
 * @param {number} profileId
 * @param {object} [opts]
 * @param {boolean} [opts.silent=false]  If true, swallow errors and return ERROR result.
 * @returns {Promise<{ profileId: number, result: string, systemuserid?: string, fullname?: string, error?: string }>}
 */
export async function reconcileProfile(profileId, { silent = false } = {}) {
  let profile;
  try {
    const { rows } = await sql`
      SELECT id, azure_email, dynamics_systemuser_id
      FROM user_profiles
      WHERE id = ${profileId} AND is_active = true
      LIMIT 1
    `;
    profile = rows[0];
  } catch (error) {
    if (silent) return { profileId, result: RESULT.ERROR, error: error.message };
    throw error;
  }

  if (!profile) {
    return { profileId, result: RESULT.ERROR, error: 'Profile not found or inactive' };
  }
  if (!profile.azure_email) {
    return { profileId, result: RESULT.SKIPPED_NO_EMAIL };
  }

  try {
    const { records } = await systemUserAdapter.findByEmail(profile.azure_email);

    if (records.length === 0) {
      // Stamp the timestamp anyway so cron knows we checked recently.
      await sql`
        UPDATE user_profiles
        SET dynamics_reconciled_at = CURRENT_TIMESTAMP
        WHERE id = ${profile.id}
      `;
      return { profileId, result: RESULT.NO_MATCH };
    }

    const user = records[0];

    if (user.isdisabled) {
      // Don't link a disabled user — they lost their license. Stamp timestamp so
      // we don't keep retrying every cron tick.
      await sql`
        UPDATE user_profiles
        SET dynamics_reconciled_at = CURRENT_TIMESTAMP
        WHERE id = ${profile.id}
      `;
      return { profileId, result: RESULT.DISABLED, fullname: user.fullname };
    }

    if (profile.dynamics_systemuser_id === user.systemuserid) {
      // Already linked to the same record — just bump the timestamp.
      await sql`
        UPDATE user_profiles
        SET dynamics_reconciled_at = CURRENT_TIMESTAMP
        WHERE id = ${profile.id}
      `;
      return { profileId, result: RESULT.UNCHANGED, systemuserid: user.systemuserid, fullname: user.fullname };
    }

    await sql`
      UPDATE user_profiles
      SET dynamics_systemuser_id = ${user.systemuserid},
          dynamics_reconciled_at = CURRENT_TIMESTAMP
      WHERE id = ${profile.id}
    `;
    return { profileId, result: RESULT.LINKED, systemuserid: user.systemuserid, fullname: user.fullname };
  } catch (error) {
    if (silent) return { profileId, result: RESULT.ERROR, error: error.message };
    throw error;
  }
}

/**
 * Reconcile every profile that needs it.
 *
 * @param {object} [opts]
 * @param {number} [opts.staleDays=30]   Re-check profiles whose last reconciliation is older than this.
 * @param {boolean} [opts.includeNull=true]  Include profiles with no systemuser_id but a non-null email.
 * @param {boolean} [opts.includeAll=false]  Override and reconcile every active profile (manual full backfill).
 * @returns {Promise<{ totalScanned: number, summary: Record<string, number>, results: Array }>}
 */
export async function reconcileBatch({ staleDays = 30, includeNull = true, includeAll = false } = {}) {
  const conditions = [];
  if (!includeAll) {
    if (includeNull) {
      conditions.push(`(dynamics_systemuser_id IS NULL AND azure_email IS NOT NULL)`);
    }
    conditions.push(`(dynamics_reconciled_at IS NULL OR dynamics_reconciled_at < NOW() - INTERVAL '${Number(staleDays)} days')`);
  }

  const where = includeAll
    ? `is_active = true AND azure_email IS NOT NULL`
    : `is_active = true AND azure_email IS NOT NULL AND (${conditions.join(' OR ')})`;

  const { rows } = await sql.query(`
    SELECT id FROM user_profiles
    WHERE ${where}
    ORDER BY id
  `);

  const summary = {
    [RESULT.LINKED]: 0,
    [RESULT.UNCHANGED]: 0,
    [RESULT.NO_MATCH]: 0,
    [RESULT.DISABLED]: 0,
    [RESULT.SKIPPED_NO_EMAIL]: 0,
    [RESULT.ERROR]: 0,
  };
  const results = [];

  for (const row of rows) {
    const r = await reconcileProfile(row.id, { silent: true });
    summary[r.result] = (summary[r.result] || 0) + 1;
    results.push(r);
  }

  return { totalScanned: rows.length, summary, results };
}

export const RECONCILE_RESULT = RESULT;

const dynamicsIdentityService = { reconcileProfile, reconcileBatch, RECONCILE_RESULT };

export default dynamicsIdentityService;
