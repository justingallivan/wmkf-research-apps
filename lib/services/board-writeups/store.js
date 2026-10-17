/** Serialized cycle journal. External side effects occur ONLY after the transaction commits.
 * UUID leases plus immutable upload intent fence overlapping workers. All request-keyed
 * receipts share the cycle lock with archive start, eliminating cross-table races.
 */
import { db, sql } from '@vercel/postgres';
import { PROGRAM_ID, cycleCode, fail } from './model.js';
export function emptyState() {
  return { version: 1, releases: {}, archives: {}, emails: {}, events: [], firstEventAt: null, archiveStartedAt: null, archiveCompletedAt: null, archiveManifest: null, configHistory: [], configIntent: null };
}
export async function readCycle(cycle) {
  cycleCode(cycle);
  const result = await sql`SELECT revision, state FROM board_writeup_runs WHERE program_id = ${PROGRAM_ID} AND cycle_code = ${cycle}`;
  return result.rows[0] || { revision: 0, state: emptyState() };
}
export async function mutateCycle(cycle, mutate, connect = () => db.connect()) {
  cycleCode(cycle);
  const client = await connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO board_writeup_runs (program_id,cycle_code,state) VALUES ($1,$2,$3::jsonb) ON CONFLICT DO NOTHING', [PROGRAM_ID, cycle, JSON.stringify(emptyState())]);
    const { rows } = await client.query('SELECT revision,state FROM board_writeup_runs WHERE program_id=$1 AND cycle_code=$2 FOR UPDATE', [PROGRAM_ID, cycle]);
    const { state, revision } = rows[0];
    if (state.version !== 1) fail('board_journal_version_invalid');
    // Callback must be synchronous; no external calls while the lock is held.
    const result = mutate(state, Number(revision));
    if (result && typeof result.then === 'function') fail('board_async_transaction_rejected');
    const serialized = JSON.stringify(state);
    if (Buffer.byteLength(serialized, 'utf8') > 1900000 || state.events.length > 5000) fail('board_journal_capacity', 'The cycle journal needs administrator attention.', 503);
    await client.query('UPDATE board_writeup_runs SET state=$3::jsonb,revision=revision+1,updated_at=NOW() WHERE program_id=$1 AND cycle_code=$2', [PROGRAM_ID, cycle, serialized]);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
export function audit(state, actorId, action, details, now = new Date().toISOString()) {
  state.events.push({ actorId, action, details, at: now });
}
export function firstEvent(state, at) {
  if (!at || !Number.isFinite(Date.parse(at))) return;
  if (!state.firstEventAt || Date.parse(at) < Date.parse(state.firstEventAt)) state.firstEventAt = at;
}
