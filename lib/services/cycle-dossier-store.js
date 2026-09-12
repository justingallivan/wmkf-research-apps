/** Cycle Dossier operational persistence. Caller-authenticated routes and workers
 * own orchestration; transactions fence leases, budget updates, and private ownership.
 * The run JSON contains independently checkpointed items; only one run has a live
 * worker lease globally, and that worker fans out at most three request jobs.
 */
import { randomUUID } from 'crypto';
import { db, sql } from '@vercel/postgres';
import { ServiceHttpError } from './service-http-error';

export const dossierError = (message, httpStatus = 409) => new ServiceHttpError(message, { httpStatus });
export async function readDossierControl(client = sql) {
  return (await client.query('SELECT stop_requested, reason, updated_by, updated_at FROM cycle_dossier_control WHERE id=TRUE')).rows[0] || null;
}
export async function setDossierOperatorStop(profileId, stopRequested, reason = null) {
  return withDossierTransaction(async client => {
    await assertDossierActor(profileId, client);
    const control = (await client.query(`INSERT INTO cycle_dossier_control(id, stop_requested, reason, updated_by)
      VALUES(TRUE,$1,$2,$3) ON CONFLICT(id) DO UPDATE SET stop_requested=EXCLUDED.stop_requested,
      reason=EXCLUDED.reason,updated_by=EXCLUDED.updated_by,updated_at=NOW() RETURNING *`, [!!stopRequested, reason, profileId])).rows[0];
    if (stopRequested) {
      await client.query(`UPDATE cycle_dossier_runs SET status='paused',
      data=jsonb_set(jsonb_set(data,'{pauseReason}',to_jsonb($1::text)),'{cutPending}','false'::jsonb), updated_at=NOW()
        WHERE status IN ('queued','running')`, [reason || 'Paused by the dossier rollout operator.']);
    }
    return control;
  });
}
export async function withDossierTransaction(fn) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

export async function assertDossierActor(profileId, client = sql) {
  if (!Number.isInteger(Number(profileId)) || Number(profileId) <= 0) throw dossierError('An active superuser profile is required.', 403);
  const result = await client.query(`SELECT p.id, p.dynamics_systemuser_id
    FROM user_profiles p WHERE p.id=$1 AND p.is_active=TRUE
    AND EXISTS (SELECT 1 FROM dynamics_user_roles r WHERE r.user_profile_id=p.id AND r.role='superuser')`, [profileId]);
  if (!result.rows[0]) throw dossierError('An active superuser profile is required.', 403);
  return { profileId: result.rows[0].id, actingUserSystemId: result.rows[0].dynamics_systemuser_id || null };
}

export async function getDossier(owner) {
  const result = await sql.query(`INSERT INTO cycle_dossiers(id,owner_profile_id) VALUES($1,$2)
    ON CONFLICT(owner_profile_id,cycle) DO UPDATE SET owner_profile_id=EXCLUDED.owner_profile_id RETURNING *`, [randomUUID(), owner]);
  return result.rows[0];
}
export async function saveDossierSelection(owner, selection) {
  const result = await sql.query(`UPDATE cycle_dossiers SET selection=$2::jsonb, updated_at=NOW() WHERE owner_profile_id=$1 AND cycle='D26' RETURNING *`, [owner, JSON.stringify(selection)]);
  return result.rows[0];
}
export async function listDossierEntries() {
  return (await sql.query(`SELECT DISTINCT ON(request_id) * FROM cycle_dossier_entries WHERE ready=TRUE AND cycle='D26' ORDER BY request_id,revision DESC`)).rows;
}
export async function getDossierEntry(id, client = sql) {
  return (await client.query('SELECT * FROM cycle_dossier_entries WHERE id=$1', [id])).rows[0] || null;
}
export async function reserveDossierEntry({ id, requestId, owner, data }, client = sql) {
  return (await client.query(`INSERT INTO cycle_dossier_entries(id,request_id,created_by,data) VALUES($1,$2,$3,$4::jsonb) RETURNING *`, [id, requestId, owner, JSON.stringify(data)])).rows[0];
}
export async function finishDossierEntry(id, data, client) {
  // Must run within the worker's fenced mutateDossierRun transaction.
  if (!client) throw dossierError('Entry publication requires a fenced transaction.');
  return (await client.query(`UPDATE cycle_dossier_entries SET data=$2::jsonb, ready=TRUE WHERE id=$1 AND ready=FALSE RETURNING *`, [id, JSON.stringify(data)])).rows[0];
}
export async function createDossierPreview(owner, dossierId, data) {
  return (await sql.query(`INSERT INTO cycle_dossier_previews(id,owner_profile_id,dossier_id,data) VALUES($1,$2,$3,$4::jsonb) RETURNING *`, [randomUUID(), owner, dossierId, JSON.stringify(data)])).rows[0];
}
export async function readDossierPreview(owner, id) {
  const row = (await sql.query('SELECT * FROM cycle_dossier_previews WHERE id=$1 AND owner_profile_id=$2 AND expires_at>NOW()', [id, owner])).rows[0];
  if (!row) throw dossierError('This preview expired or is unavailable. Preview the selection again.');
  return row;
}
export async function createDossierRun({ owner, dossierId, idempotencyKey, launchHash, data }, client = sql) {
  await client.query(`INSERT INTO cycle_dossier_runs(id,owner_profile_id,dossier_id,idempotency_key,launch_hash,data)
    VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(owner_profile_id,idempotency_key) DO NOTHING`, [randomUUID(), owner, dossierId, idempotencyKey, launchHash, JSON.stringify(data)]);
  const row = (await client.query('SELECT * FROM cycle_dossier_runs WHERE owner_profile_id=$1 AND idempotency_key=$2', [owner, idempotencyKey])).rows[0];
  if (row.launch_hash !== launchHash) throw dossierError('That launch key was already used for a different selection or budget.');
  return row;
}
export async function findDossierLaunch(owner, key) {
  return (await sql.query('SELECT * FROM cycle_dossier_runs WHERE owner_profile_id=$1 AND idempotency_key=$2', [owner, key])).rows[0] || null;
}
export async function listDossierRuns(owner) {
  return (await sql.query('SELECT * FROM cycle_dossier_runs WHERE owner_profile_id=$1 ORDER BY created_at DESC LIMIT 30', [owner])).rows;
}
export async function readDossierRun(owner, id) {
  const row = (await sql.query('SELECT * FROM cycle_dossier_runs WHERE id=$1 AND owner_profile_id=$2', [id, owner])).rows[0];
  if (!row) throw dossierError('Run not found.', 404);
  return row;
}

export async function mutateDossierRun(id, fn, { owner, leaseToken } = {}) {
  return withDossierTransaction(async client => {
    const row = (await client.query('SELECT * FROM cycle_dossier_runs WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!row || (owner != null && Number(row.owner_profile_id) !== Number(owner))) throw dossierError('Run not found.', 404);
    if (leaseToken && (row.lease_token !== leaseToken || new Date(row.locked_until).getTime() <= Date.now())) throw dossierError('Worker lease expired.');
    await assertDossierActor(row.owner_profile_id, client);
    await fn(row, client);
    await client.query(`UPDATE cycle_dossier_runs SET status=$2,data=$3::jsonb,lease_token=$4,locked_until=$5,updated_at=NOW() WHERE id=$1`, [id, row.status, JSON.stringify(row.data), row.lease_token, row.locked_until]);
    return row;
  });
}

export async function claimDossierRun() {
  return withDossierTransaction(async client => {
    // Serialize global claim decisions. A run executes at most three jobs at once.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('cycle-dossier-worker'),0)");
    const control = await readDossierControl(client);
    if (!control || control.stop_requested) return null;
    const active = await client.query('SELECT id FROM cycle_dossier_runs WHERE locked_until>NOW() LIMIT 1');
    if (active.rows.length) return null;
    const row = (await client.query(`SELECT * FROM cycle_dossier_runs WHERE
      status IN ('queued','running') OR (status IN ('paused','cancelled') AND COALESCE((data->>'cutPending')::boolean,FALSE))
      ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`)).rows[0];
    if (!row) return null;
    const recovered = !!row.lease_token;
    row.lease_token = randomUUID();
    row.locked_until = new Date(Date.now() + 280000).toISOString();
    if (row.status === 'queued') row.status = 'running';
    if (recovered) {
      row.data.items = row.data.items.map(item => {
        if (item.status !== 'running') return item;
        if (!item.paidInFlight && !item.unknownCost) {
          row.data.reservedUsd = Math.max(0, row.data.reservedUsd - (item.reservationUsd || 0));
          item.reservationUsd = 0; item.reserved = false;
        }
        return { ...item, status: 'failed', error: item.paidInFlight
          ? 'A provider response was lost. A possible charge is reserved; retry explicitly.'
          : 'The worker stopped. Retry to continue from its saved checkpoint.' };
      });
    }
    await client.query(`UPDATE cycle_dossier_runs SET status=$2,lease_token=$3,locked_until=$4,data=$5::jsonb,updated_at=NOW() WHERE id=$1`, [row.id, row.status, row.lease_token, row.locked_until, JSON.stringify(row.data)]);
    return row;
  });
}
export async function releaseDossierRun(id, token) {
  // Preserve the lease marker when a stage escaped without checkpointing.
  // Expiry recovery must see it and must not silently repeat a paid attempt.
  await sql.query(`UPDATE cycle_dossier_runs SET lease_token=NULL,locked_until=NULL WHERE id=$1 AND lease_token=$2
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(data->'items') i WHERE i->>'status'='running')`, [id, token]);
}
export async function stopRevokedDossierRun(id, token) {
  await sql.query(`UPDATE cycle_dossier_runs SET status='paused',
    data=jsonb_set(jsonb_set(jsonb_set(data,'{pauseReason}','"Authorization must be restored before continuing."'),'{cutPending}','false'),'{items}',
      (SELECT jsonb_agg(CASE WHEN i->>'status'='running' THEN i || '{"status":"failed","error":"Authorization was revoked. Review and explicitly retry this entry."}'::jsonb ELSE i END)
        FROM jsonb_array_elements(data->'items') i)),
    lease_token=NULL,locked_until=NULL WHERE id=$1 AND lease_token=$2`, [id, token]);
}
export async function listDossierEditions(owner) {
  return (await sql.query('SELECT * FROM cycle_dossier_editions WHERE owner_profile_id=$1 AND ready=TRUE ORDER BY created_at DESC', [owner])).rows;
}
export async function readDossierEdition(owner, id) {
  const row = (await sql.query('SELECT * FROM cycle_dossier_editions WHERE id=$1 AND owner_profile_id=$2 AND ready=TRUE', [id, owner])).rows[0];
  if (!row) throw dossierError('Edition not found.', 404);
  return row;
}
export async function reserveDossierEdition(run, cutKey, data, client) {
  await client.query(`INSERT INTO cycle_dossier_editions(id,owner_profile_id,dossier_id,run_id,cut_key,data) VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(run_id,cut_key) DO NOTHING`, [randomUUID(), run.owner_profile_id, run.dossier_id, run.id, cutKey, JSON.stringify(data)]);
  return (await client.query('SELECT * FROM cycle_dossier_editions WHERE run_id=$1 AND cut_key=$2', [run.id, cutKey])).rows[0];
}
export async function publishDossierEdition(edition, data, client) {
  const transition = await client.query('UPDATE cycle_dossier_editions SET data=$2::jsonb,ready=TRUE WHERE id=$1 AND ready=FALSE RETURNING id', [edition.id, JSON.stringify(data)]);
  if (!transition.rows.length) return;
  await client.query(`UPDATE cycle_dossiers SET latest_edition_id=$2,updated_at=NOW()
    WHERE id=$1 AND owner_profile_id=$3 AND (latest_edition_id IS NULL OR
      (SELECT created_at FROM cycle_dossier_editions WHERE id=latest_edition_id)
        <= (SELECT created_at FROM cycle_dossier_editions WHERE id=$2))`, [edition.dossier_id, edition.id, edition.owner_profile_id]);
}
