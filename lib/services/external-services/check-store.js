/** Latest check only (three allowlisted rows). Lease fences concurrent/expired writers.
 * Check writes never alter service versions, review dates, decisions, or provider settings.
 */
import crypto from 'node:crypto';
import { sql } from '@vercel/postgres';
import { invalid } from './model';
export const CHECK_IDS = ['assemblyai', 'anthropic', 'serpapi'];
export function assertCheckId(id) {
  if (typeof id !== 'string' || !CHECK_IDS.includes(id)) throw invalid('Update checks are available for AssemblyAI, Anthropic, and SerpAPI only.');
}
export async function readCheck(id) {
  if (!CHECK_IDS.includes(id)) return null;
  const { rows } = await sql.query('SELECT snapshot, lease_expires_at, lease_expires_at > now() AS running FROM external_service_checks WHERE service_id=$1', [id]);
  if (!rows.length) return null;
  return { ...rows[0].snapshot, running: rows[0].running === true, interrupted: !!rows[0].lease_expires_at && !rows[0].running };
}
export async function claimCheck(id, actorId) {
  assertCheckId(id);
  const token = crypto.randomUUID();
  const { rows } = await sql.query(`INSERT INTO external_service_checks(service_id,lease_token,lease_expires_at,checked_by)
    SELECT id,$2,now()+interval '90 seconds',$3 FROM external_services WHERE id=$1
    ON CONFLICT(service_id) DO UPDATE SET lease_token=$2,lease_expires_at=now()+interval '90 seconds',checked_by=$3
    WHERE (external_service_checks.lease_expires_at IS NULL OR external_service_checks.lease_expires_at <= now())
      AND (external_service_checks.checked_at IS NULL OR external_service_checks.checked_at <= now()-interval '60 seconds')
    RETURNING snapshot`, [id, token, actorId]);
  if (!rows.length) {
    const latest = await readCheck(id);
    if (latest?.running) throw invalid('A check is already running. Reload results shortly.', 409);
    if (latest?.checkedAt && !latest.interrupted) return { cached: latest };
    throw invalid('Service not found or check unavailable. Reload and retry.', 404);
  }
  const service = (await sql.query('SELECT version,data FROM external_services WHERE id=$1', [id])).rows[0];
  return { token, previous: rows[0].snapshot, service };
}
export async function finishCheck(id, token, snapshot) {
  if (Buffer.byteLength(JSON.stringify(snapshot)) > 200000) throw invalid('Check result exceeds its supported size.', 503);
  const { rows } = await sql.query(`UPDATE external_service_checks SET snapshot=$3::jsonb,checked_at=now(),lease_token=NULL,lease_expires_at=NULL
    WHERE service_id=$1 AND lease_token=$2 AND lease_expires_at > now() RETURNING service_id`, [id, token, JSON.stringify(snapshot)]);
  if (!rows.length) throw invalid('This check was superseded or timed out. Reload the latest results.', 409);
  return snapshot;
}
