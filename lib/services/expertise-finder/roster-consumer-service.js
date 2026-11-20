/** Numeric identity projection for existing consumers. No silent legacy fallback.
 * Caller owns auth and DAL context. Historical reads include inactive profiles.
 */
import { sql } from '@vercel/postgres';
import * as profiles from '../../dataverse/adapters/expertise-profile.js';
import contract from './roster-contract.cjs';
import { rosterTarget, usesDataverseRoster } from './roster-mode.js';
import { ServiceHttpError } from '../service-http-error.js';
export async function readConsumerRoster() {
  const { host } = rosterTarget();
  let records, bindings;
  try {
    [records, bindings] = await Promise.all([
      profiles.list(), sql.query('SELECT roster_id, dataverse_profile_guid FROM expertise_roster_binding WHERE target_host=$1', [host]),
    ]);
  } catch {
    throw new ServiceHttpError('The roster is unavailable. Try again later.', { httpStatus: 503, code: 'roster_unavailable' });
  }
  const byGuid = new Map(bindings.rows.map(r => [r.dataverse_profile_guid, Number(r.roster_id)]));
  return records.map(record => {
    const row = contract.decode(record);
    const id = byGuid.get(row.id);
    if (!Number.isSafeInteger(id) || id < 1 || !row.role_type || ![0, 1].includes(record.statecode)) {
      throw new ServiceHttpError('A roster profile needs identity reconciliation in Admin.', { httpStatus: 503, code: 'roster_identity_unavailable' });
    }
    return { ...row, id };
  });
}
export async function eligibleRoster(roles) {
  return (await readConsumerRoster()).filter(r => r.is_active && roles.includes(r.role_type))
    .sort((a, b) => a.role_type.localeCompare(b.role_type) || a.name.localeCompare(b.name) || a.id - b.id);
}
export async function matchingRoster() {
  if (usesDataverseRoster()) return eligibleRoster(['Board', 'Consultant', 'Research Program Staff']);
  return (await sql`SELECT * FROM expertise_roster WHERE is_active = true ORDER BY role_type, name`).rows;
}
export async function hydrateFeedbackAuthors(rows, snapshot = null) {
  if (!usesDataverseRoster() || !rows.some(r => r.consultant_roster_id != null)) return rows;
  const roster = new Map((snapshot || await readConsumerRoster()).map(r => [r.id, r]));
  return rows.map(row => {
    if (row.consultant_roster_id == null) return row;
    const person = roster.get(Number(row.consultant_roster_id));
    return { ...row, roster_name: person?.name ?? 'Unavailable consultant', roster_affiliation: person?.affiliation ?? null };
  });
}
