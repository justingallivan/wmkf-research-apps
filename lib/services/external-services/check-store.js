/** Latest check only (four allowlisted rows). Lease fences concurrent/expired writers.
 * Check writes never alter service versions, review dates, decisions, or provider settings.
 */
import crypto from 'node:crypto';
import { sql } from '@vercel/postgres';
import { invalid } from './model';
export const CHECK_IDS = ['assemblyai', 'anthropic', 'serpapi', 'openai'];
export function assertCheckId(id) {
  if (typeof id !== 'string' || !CHECK_IDS.includes(id)) throw invalid('Update checks are available for AssemblyAI, Anthropic, SerpAPI, and OpenAI only.');
}
export async function readCheck(id) {
  if (!CHECK_IDS.includes(id)) return null;
  let rows;
  try { ({ rows } = await sql.query('SELECT snapshot, lease_expires_at, lease_expires_at > now() AS running FROM external_service_checks WHERE service_id=$1', [id])); }
  catch (error) { if (error.code === '42P01') return { setupRequired:true }; throw error; }
  if (!rows.length) return null;
  return { ...rows[0].snapshot, running: rows[0].running === true, interrupted: !!rows[0].lease_expires_at && !rows[0].running };
}
export async function claimCheck(id, actorId) {
  assertCheckId(id);
  const token = crypto.randomUUID();
  const { rows } = await sql.query(`WITH claimed AS (INSERT INTO external_service_checks(service_id,lease_token,lease_expires_at,checked_by)
    SELECT id,$2,now()+interval '90 seconds',$3 FROM external_services WHERE id=$1
    ON CONFLICT(service_id) DO UPDATE SET lease_token=$2,lease_expires_at=now()+interval '90 seconds',checked_by=$3
    WHERE (external_service_checks.lease_expires_at IS NULL OR external_service_checks.lease_expires_at <= now())
      AND (external_service_checks.checked_at IS NULL OR external_service_checks.checked_at <= now()-interval '60 seconds')
    RETURNING snapshot,checked_at) SELECT claimed.snapshot,s.version,s.data,
    (SELECT max(updated_at)::text FROM external_service_reviews WHERE service_id=$1) AS review_revision,
    (SELECT max(updated_at) FROM external_service_reviews WHERE service_id=$1) > claimed.checked_at AS review_after_check
    FROM claimed CROSS JOIN external_services s WHERE s.id=$1`, [id, token, actorId]);
  if (!rows.length) {
    const latest = await readCheck(id);
    if (latest?.running) throw invalid('A check is already running. Reload results shortly.', 409);
    if (latest?.checkedAt && !latest.interrupted) return { cached: latest };
    throw invalid('Service not found or check unavailable. Reload and retry.', 404);
  }
  return { token, previous: rows[0].snapshot, service:{version:rows[0].version,data:rows[0].data}, reviewRevision:rows[0].review_revision, reviewAfterCheck:rows[0].review_after_check === true };
}
export async function finishCheck(id, token, snapshot) {
  if (Buffer.byteLength(JSON.stringify(snapshot)) > 200000) throw invalid('Check result exceeds its supported size.', 503);
  const { rows } = await sql.query(`UPDATE external_service_checks SET snapshot=$3::jsonb,checked_at=now(),lease_token=NULL,lease_expires_at=NULL
    WHERE service_id=$1 AND lease_token=$2 AND lease_expires_at > now() RETURNING service_id`, [id, token, JSON.stringify(snapshot)]);
  if (!rows.length) throw invalid('This check was superseded or timed out. Reload the latest results.', 409);
  return snapshot;
}

/** Mark a known failed attempt interrupted immediately, without touching a replacement lease. */
export async function interruptCheck(id, token) {
  await sql.query('UPDATE external_service_checks SET lease_expires_at=now() WHERE service_id=$1 AND lease_token=$2', [id, token]);
}
