/** Virtual Review Panel Phase A persistence (clone of cycle-dossier-store.js's
 * shape for the panel tables — docs/plans/VIRTUAL_REVIEW_PANEL_PHASE_A_BUILD_PLAN_2026-09-12.md §5 A.5).
 *
 * Two separate fences, per the plan:
 *  (1) Run-state changes (creating an attempt, dispatching it, reaping expired
 *      attempts, selecting winners) require the CURRENT run lease — the run
 *      row is locked FOR UPDATE and its lease_token/locked_until checked in
 *      the same transaction as the write, exactly like cycle-dossier-store's
 *      mutateDossierRun.
 *  (2) Attempt finalisation (finalizeAttempt) is a single compare-and-set on
 *      the attempt's OWN dispatch_token plus its dispatch_expires_at, decided
 *      on clock_timestamp() (never now(), which is transaction-frozen) so a
 *      finaliser transaction that begins before expiry but reaches its UPDATE
 *      after expiry cannot land `completed`.
 *
 * state on review_panel_seat_attempts has exactly four writers: this file's
 * markAttemptDispatched, the two CAS UPDATEs inside finalizeAttempt, and
 * reapExpiredAttempts. dispatch_token is immutable once set: only
 * markAttemptDispatched ever assigns it, gated on state='pending'.
 */
import { randomUUID } from 'crypto';
import { db, sql } from '@vercel/postgres';
import { ServiceHttpError } from './service-http-error';

export const reviewPanelError = (message, httpStatus = 409) => new ServiceHttpError(message, { httpStatus });

export async function withReviewPanelTransaction(fn) {
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

export async function assertReviewPanelActor(profileId, client = sql) {
  if (!Number.isInteger(Number(profileId)) || Number(profileId) <= 0) throw reviewPanelError('An active superuser profile is required.', 403);
  const result = await client.query(`SELECT p.id, p.dynamics_systemuser_id
    FROM user_profiles p WHERE p.id=$1 AND p.is_active=TRUE
    AND EXISTS (SELECT 1 FROM dynamics_user_roles r WHERE r.user_profile_id=p.id AND r.role='superuser')`, [profileId]);
  if (!result.rows[0]) throw reviewPanelError('An active superuser profile is required.', 403);
  return { profileId: result.rows[0].id, actingUserSystemId: result.rows[0].dynamics_systemuser_id || null };
}

export async function readReviewPanelControl(client = sql) {
  return (await client.query('SELECT stop_requested, reason, updated_by, updated_at FROM review_panel_control WHERE id=TRUE')).rows[0] || null;
}

export async function setReviewPanelOperatorStop(profileId, stopRequested, reason = null) {
  return withReviewPanelTransaction(async client => {
    await assertReviewPanelActor(profileId, client);
    return (await client.query(`INSERT INTO review_panel_control(id, stop_requested, reason, updated_by)
      VALUES(TRUE,$1,$2,$3) ON CONFLICT(id) DO UPDATE SET stop_requested=EXCLUDED.stop_requested,
      reason=EXCLUDED.reason,updated_by=EXCLUDED.updated_by,updated_at=NOW() RETURNING *`, [!!stopRequested, reason, profileId])).rows[0];
  });
}

/** Verify the caller's leaseToken still matches the run's current, unexpired lease. Must run inside `client`'s transaction with the run row already locked. */
function assertCurrentLease(runRow, leaseToken) {
  if (!runRow || runRow.lease_token !== leaseToken || !runRow.locked_until || new Date(runRow.locked_until).getTime() <= Date.now()) {
    throw reviewPanelError('Worker lease expired.');
  }
}

/** Create a new pending attempt for a seat under the entry's run. Requires the run's current lease (retry/dispatch creation is a run-state change). */
export async function createAttempt({ entryId, seatKey, leaseToken, provider, model, promptSnapshot }) {
  return withReviewPanelTransaction(async client => {
    const entryRow = (await client.query(
      `SELECT e.id, r.lease_token, r.locked_until FROM review_panel_entries e
       JOIN review_panel_runs r ON r.id = e.run_id WHERE e.id=$1 FOR UPDATE OF r`, [entryId])).rows[0];
    if (!entryRow) throw reviewPanelError('Entry not found.', 404);
    assertCurrentLease(entryRow, leaseToken);
    return (await client.query(
      `INSERT INTO review_panel_seat_attempts(id, entry_id, seat_key, attempt_no, state, provider, model, prompt_snapshot_json)
       VALUES ($1,$2,$3,(SELECT COALESCE(MAX(attempt_no),0)+1 FROM review_panel_seat_attempts WHERE entry_id=$2 AND seat_key=$3),
         'pending',$4,$5,$6::jsonb) RETURNING *`,
      [randomUUID(), entryId, seatKey, provider, model, JSON.stringify(promptSnapshot ?? null)])).rows[0];
  });
}

/** pending -> dispatched. Requires the run's current lease; the dispatch token is set only here, only from 'pending'. */
export async function markAttemptDispatched(attemptId, { dispatchToken, leaseToken, dispatchExpiresAt }) {
  return withReviewPanelTransaction(async client => {
    const runRow = (await client.query(
      `SELECT r.lease_token, r.locked_until FROM review_panel_runs r
       JOIN review_panel_entries e ON e.run_id = r.id
       JOIN review_panel_seat_attempts a ON a.entry_id = e.id
       WHERE a.id = $1 FOR UPDATE OF r`, [attemptId])).rows[0];
    if (!runRow) throw reviewPanelError('Attempt not found.', 404);
    assertCurrentLease(runRow, leaseToken);
    const result = await client.query(
      `UPDATE review_panel_seat_attempts SET state='dispatched', dispatch_token=$2, lease_token=$3,
         dispatched_at=NOW(), dispatch_expires_at=$4, updated_at=NOW()
       WHERE id=$1 AND state='pending' RETURNING *`,
      [attemptId, dispatchToken, leaseToken, dispatchExpiresAt]);
    if (!result.rows[0]) throw reviewPanelError('Attempt is not pending.');
    return result.rows[0];
  });
}

/**
 * Finalise one attempt. In-lease CAS uses clock_timestamp() (never now(), which
 * is frozen at transaction start) so a finaliser transaction begun before
 * expiry that reaches its UPDATE after expiry cannot land `completed`. The row
 * is locked with SELECT … FOR UPDATE before either UPDATE so both run under
 * one lock: a straddling reaper cannot interleave between the CAS attempt and
 * the late-path fallback. Returns { outcome: 'finalized' | 'late' | 'no_match' }.
 */
export async function finalizeAttempt(attemptId, dispatchToken, { state, result, usage, costCents = null, costState, errorText = null } = {}) {
  return withReviewPanelTransaction(async client => {
    const locked = (await client.query('SELECT id FROM review_panel_seat_attempts WHERE id=$1 FOR UPDATE', [attemptId])).rows[0];
    if (!locked) return { outcome: 'no_match', attempt: null };
    const cas = await client.query(
      `UPDATE review_panel_seat_attempts SET state=$3, result_json=$4::jsonb, usage_json=$5::jsonb,
         cost_cents=$6, cost_state=$7, error_text=$8, updated_at=NOW()
       WHERE id=$1 AND dispatch_token=$2 AND state='dispatched' AND dispatch_expires_at > clock_timestamp()
       RETURNING *`,
      [attemptId, dispatchToken, state, JSON.stringify(result ?? null), JSON.stringify(usage ?? null), costCents, costState, errorText]);
    if (cas.rows[0]) return { outcome: 'finalized', attempt: cas.rows[0] };
    const late = await client.query(
      `UPDATE review_panel_seat_attempts
         SET state = CASE WHEN state='dispatched' THEN 'unknown_outcome' ELSE state END,
             late_result_json=$3::jsonb, late_usage_json=$4::jsonb, updated_at=NOW()
       WHERE id=$1 AND dispatch_token=$2
       RETURNING *`,
      [attemptId, dispatchToken, JSON.stringify(result ?? null), JSON.stringify(usage ?? null)]);
    if (late.rows[0]) return { outcome: 'late', attempt: late.rows[0] };
    return { outcome: 'no_match', attempt: null };
  });
}

/** Move dispatched attempts whose lease has expired to unknown_outcome. Never retried automatically. Requires the run's current lease. */
export async function reapExpiredAttempts(runId, leaseToken) {
  return withReviewPanelTransaction(async client => {
    const runRow = (await client.query('SELECT lease_token, locked_until FROM review_panel_runs WHERE id=$1 FOR UPDATE', [runId])).rows[0];
    if (!runRow) throw reviewPanelError('Run not found.', 404);
    assertCurrentLease(runRow, leaseToken);
    return (await client.query(
      `UPDATE review_panel_seat_attempts a SET state='unknown_outcome', updated_at=NOW()
       FROM review_panel_entries e
       WHERE a.entry_id = e.id AND e.run_id = $1 AND a.state='dispatched' AND a.dispatch_expires_at <= NOW()
       RETURNING a.*`, [runId])).rows;
  });
}

/** Record, per seat, the single completed attempt with the highest attempt_no. Requires the run's current lease. */
export async function selectWinners(entryId, leaseToken) {
  return withReviewPanelTransaction(async client => {
    const entryRow = (await client.query(
      `SELECT e.id, r.lease_token, r.locked_until FROM review_panel_entries e
       JOIN review_panel_runs r ON r.id = e.run_id WHERE e.id=$1 FOR UPDATE OF r`, [entryId])).rows[0];
    if (!entryRow) throw reviewPanelError('Entry not found.', 404);
    assertCurrentLease(entryRow, leaseToken);
    const winners = (await client.query(
      `SELECT DISTINCT ON (seat_key) id, seat_key FROM review_panel_seat_attempts
       WHERE entry_id=$1 AND state='completed' ORDER BY seat_key, attempt_no DESC`, [entryId])).rows;
    const winnersJson = Object.fromEntries(winners.map(w => [w.seat_key, w.id]));
    return (await client.query(
      `UPDATE review_panel_entries SET winners_json = winners_json || $2::jsonb, updated_at=NOW()
       WHERE id=$1 RETURNING *`, [entryId, JSON.stringify(winnersJson)])).rows[0];
  });
}

/** Sum known attempt costs for a run. unknownCount > 0 means the total is withheld by the caller (any unknown-state or cost_state='unknown' attempt taints the total). */
export async function sumAttemptCosts(runId, client = sql) {
  const rows = (await client.query(
    `SELECT a.cost_cents, a.cost_state FROM review_panel_seat_attempts a
     JOIN review_panel_entries e ON e.id = a.entry_id WHERE e.run_id=$1`, [runId])).rows;
  const totalCents = rows.reduce((sum, row) => sum + (row.cost_state === 'known' ? Number(row.cost_cents || 0) : 0), 0);
  const unknownCount = rows.filter((row) => row.cost_state !== 'known').length;
  return { totalCents, unknownCount };
}
