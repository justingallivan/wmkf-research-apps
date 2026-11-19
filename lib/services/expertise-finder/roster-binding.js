/**
 * Post-cutover numeric binding for a Dataverse roster profile (non-rehearsal mode).
 * Reuses an existing binding for (host, profile GUID); otherwise allocates the next ID from
 * the legacy roster sequence, which the importer advanced past every imported ID, and
 * inserts identity + binding in one transaction. No advisory locks or pending intents:
 * the owner accepted single-operator use. A unique conflict rereads the winner.
 * Plan: docs/plans/data/expertise-roster/PRODUCTION_CUTOVER_SIMPLIFICATION_2026-11-18.md.
 */
import { db } from './roster-sql.cjs';
import contract from './roster-contract.cjs';

const FIND = 'SELECT roster_id FROM expertise_roster_binding WHERE target_host = $1 AND dataverse_profile_guid = $2';

export async function ensureProfileBinding(host, profileGuid) {
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
