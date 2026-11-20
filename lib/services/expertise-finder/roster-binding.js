/**
 * Post-cutover numeric binding for a Dataverse roster profile (production).
 * Reuses an existing binding for (host, profile GUID); otherwise allocates the next ID from
 * the legacy roster sequence, which the importer advanced past every imported ID, and
 * inserts identity + binding in one transaction. No advisory locks or pending intents:
 * the owner accepted single-operator use. A unique conflict rereads the winner.
 * Only app-created profiles (`app_` creation key) may allocate a new ID. Imported
 * (`legacy_`), direct-CRM (`direct_`) or unkeyed profiles without a binding are refused:
 * allocating would orphan an imported ID's history (plan §3 quarantine rule).
 * Plan: docs/plans/EXPERTISE_ROSTER_PRODUCTION_MIGRATION_PLAN_2026-11-19.md.
 */
import { db } from '@vercel/postgres';
import contract from './roster-contract.cjs';

const FIND = 'SELECT roster_id FROM expertise_roster_binding WHERE target_host = $1 AND dataverse_profile_guid = $2';

export async function ensureProfileBinding(host, profileGuid, creationKey) {
  if (typeof host !== 'string' || !host || !contract.guid(profileGuid)) {
    throw new Error('A target host and profile GUID are required to bind a roster profile.');
  }
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query(FIND, [host, profileGuid]);
    if (found.rows[0]) {
      await client.query('COMMIT');
      return found.rows[0].roster_id;
    }
    if (typeof creationKey !== 'string' || (!creationKey.startsWith('app_') || !contract.guid(creationKey.slice(4)))) {
      throw Object.assign(new Error('This profile needs numeric reconciliation before dependent use.'), { status: 503, code: 'roster_binding_requires_reconciliation' });
    }
    const allocated = await client.query("INSERT INTO expertise_roster_identity (id) VALUES (nextval('expertise_roster_id_seq')) RETURNING id");
    const id = allocated.rows[0].id;
    await client.query('INSERT INTO expertise_roster_binding (roster_id, target_host, dataverse_profile_guid) VALUES ($1, $2, $3)', [id, host, profileGuid]);
    await client.query('COMMIT');
    return id;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error?.code === '23505') {
      const winner = await client.query(FIND, [host, profileGuid]);
      if (winner.rows[0]) return winner.rows[0].roster_id;
    }
    throw error;
  } finally {
    client.release();
  }
}
