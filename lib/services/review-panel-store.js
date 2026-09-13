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
 * state on review_panel_seat_attempts has exactly six writers: createAttempt's
 * INSERT (the initial 'pending' row), this file's markAttemptDispatched, the
 * two CAS UPDATEs inside finalizeAttempt, reapExpiredAttempts, and the
 * lease-fenced reapAllDispatchedAttempts (owner-revocation settle). dispatch_token
 * is immutable once set: only markAttemptDispatched ever assigns it, gated on
 * state='pending' AND dispatch_token IS NULL (defense in depth: even if state
 * were somehow reset to 'pending' on a row that already has a token, dispatch
 * cannot mint a second one).
 */
import { randomUUID } from 'crypto';
import { db, sql } from '@vercel/postgres';
import { ServiceHttpError } from './service-http-error';

export const reviewPanelError = (message, httpStatus = 409) => new ServiceHttpError(message, { httpStatus });

const TERMINAL_ATTEMPT_STATES = new Set(['completed', 'failed']);
const COST_STATES = new Set(['known', 'unknown']);

/**
 * THE single definition of "this attempt's cost is unknown", used by every
 * caller that sums or reports review_panel_seat_attempts cost (this store's
 * sumAttemptCosts/sumEntryAttemptCosts, the spend-check cron, and admin
 * stats) so the definition can never drift between call sites. An attempt's
 * cost is unknown when EITHER:
 *   - its state is 'unknown_outcome' (reaped or late-finalized: the late
 *     path in finalizeAttempt never sets cost_cents/cost_state, so these
 *     rows keep whatever cost_state they had before — typically NULL from
 *     'pending'/'dispatched' — and must count as unknown regardless), OR
 *   - its cost_state is anything other than 'known' (NULL for an
 *     attempt still in flight, or the literal 'unknown' a finalized
 *     completed/failed attempt can carry when its paid-call confirmation
 *     was itself ambiguous — review-panel-generation.js's error path), OR
 *   - it is 'known' with a NULL cost_cents — defense in depth behind the
 *     DB CHECK (review_panel_seat_attempts_cost_known_has_cents), which
 *     should make this combination impossible; never trust it as $0 anyway.
 * SQL form assumes the table is aliased `a` (review_panel_seat_attempts a).
 */
export const ATTEMPT_COST_UNKNOWN_SQL = "(a.state = 'unknown_outcome' OR a.cost_state IS DISTINCT FROM 'known' OR a.cost_cents IS NULL)";

/** JS twin of ATTEMPT_COST_UNKNOWN_SQL — same predicate over an already-fetched row shape { state, cost_state, cost_cents }. */
export function isAttemptCostUnknown(row) {
  return row.state === 'unknown_outcome' || row.cost_state !== 'known' || row.cost_cents == null;
}

/** costState must be one of {known, unknown}; 'known' additionally requires a finite, non-negative cost_cents so a NULL cost never silently reads back as $0. */
function assertValidCost(costState, costCents) {
  if (!COST_STATES.has(costState)) throw reviewPanelError(`costState must be 'known' or 'unknown', got "${costState}".`, 400);
  if (costState === 'known' && !(Number.isFinite(costCents) && costCents >= 0)) {
    throw reviewPanelError('costState "known" requires a finite, non-negative costCents.', 400);
  }
}

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

/** pending -> dispatched. Requires the run's current lease; the dispatch token is set only here, only from 'pending' with no existing token. */
export async function markAttemptDispatched(attemptId, { dispatchToken, leaseToken, dispatchExpiresAt }) {
  if (typeof dispatchToken !== 'string' || !dispatchToken.trim()) throw reviewPanelError('dispatchToken must be a non-empty string.', 400);
  const expiresAt = new Date(dispatchExpiresAt);
  if (Number.isNaN(expiresAt.getTime())) throw reviewPanelError('dispatchExpiresAt must be a valid date.', 400);
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
       WHERE id=$1 AND state='pending' AND dispatch_token IS NULL RETURNING *`,
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
  if (!TERMINAL_ATTEMPT_STATES.has(state)) throw reviewPanelError(`finalizeAttempt state must be 'completed' or 'failed', got "${state}".`, 400);
  assertValidCost(costState, costCents);
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

/**
 * Reap EVERY currently-`dispatched` attempt for a run to `unknown_outcome`,
 * regardless of `dispatch_expires_at` — unlike reapExpiredAttempts, which
 * only reaps attempts whose lease has already expired (self-heals on a
 * FUTURE claim of the same run). This is for a run about to be marked
 * `failed` (owner revoked mid-drain): a `failed` run is never reclaimed by
 * claimReviewPanelRun again, so any attempt left `dispatched` here would
 * never be reaped by any future pass — it must be resolved to a terminal
 * state NOW, while the current lease is still held. Requires the run's
 * current lease.
 */
export async function reapAllDispatchedAttempts(runId, leaseToken) {
  return withReviewPanelTransaction(async client => {
    const runRow = (await client.query('SELECT lease_token, locked_until FROM review_panel_runs WHERE id=$1 FOR UPDATE', [runId])).rows[0];
    if (!runRow) throw reviewPanelError('Run not found.', 404);
    assertCurrentLease(runRow, leaseToken);
    return (await client.query(
      `UPDATE review_panel_seat_attempts a SET state='unknown_outcome', updated_at=NOW()
       FROM review_panel_entries e
       WHERE a.entry_id = e.id AND e.run_id = $1 AND a.state='dispatched'
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

/** Sum known attempt costs for a run (ALL entries in the run — a run-wide total). unknownCount > 0 means the total is withheld by the caller. Uses isAttemptCostUnknown (ATTEMPT_COST_UNKNOWN_SQL's JS twin) so this can never drift from the cron/admin-stats definition. */
export async function sumAttemptCosts(runId, client = sql) {
  const rows = (await client.query(
    `SELECT a.cost_cents, a.cost_state, a.state FROM review_panel_seat_attempts a
     JOIN review_panel_entries e ON e.id = a.entry_id WHERE e.run_id=$1`, [runId])).rows;
  const totalCents = rows.reduce((sum, row) => sum + (isAttemptCostUnknown(row) ? 0 : Number(row.cost_cents)), 0);
  const unknownCount = rows.filter(isAttemptCostUnknown).length;
  return { totalCents, unknownCount };
}

/**
 * Sum known attempt costs for ONE entry only. Required because entries in a
 * run are processed concurrently (review-panel-worker.js's panelPool runs up
 * to 3 at once): a run-wide sumAttemptCosts call inside a per-entry report
 * would count sibling entries' still-in-flight attempts as "unknown" and
 * withhold every report's cost line even when THIS entry's own attempts are
 * all known. Same isAttemptCostUnknown predicate, scoped to entry_id.
 */
export async function sumEntryAttemptCosts(entryId, client = sql) {
  const rows = (await client.query(
    `SELECT a.cost_cents, a.cost_state, a.state FROM review_panel_seat_attempts a WHERE a.entry_id=$1`, [entryId])).rows;
  const totalCents = rows.reduce((sum, row) => sum + (isAttemptCostUnknown(row) ? 0 : Number(row.cost_cents)), 0);
  const unknownCount = rows.filter(isAttemptCostUnknown).length;
  return { totalCents, unknownCount };
}

// ─────────────────────────────────────────────────────────────────────────
// Panel / run / entry primitives (slice 2). review_panel_runs carries the
// SAME single-global-lease model as cycle_dossier_runs: at most one run holds
// a live lease across the whole table at any time (claimReviewPanelRun's
// advisory lock + `locked_until>NOW()` guard mirror claimDossierRun exactly).
// Entries are persisted rows (unlike the dossier's in-JSON items) because the
// seat-attempt ledger already needs entry_id as a real FK; entry state
// changes therefore go through the SAME lease fence as attempt creation
// (assertCurrentLease against the parent run), not a separate mechanism.
// ─────────────────────────────────────────────────────────────────────────

export async function createReviewPanel(owner) {
  const result = await sql.query(
    `INSERT INTO review_panels(id, owner_profile_id) VALUES($1,$2)
     ON CONFLICT(owner_profile_id) DO UPDATE SET owner_profile_id=EXCLUDED.owner_profile_id RETURNING *`,
    [randomUUID(), owner]);
  return result.rows[0];
}

export async function saveReviewPanelSelection(owner, selection) {
  return (await sql.query(
    `UPDATE review_panels SET selection=$2::jsonb, updated_at=NOW() WHERE owner_profile_id=$1 RETURNING *`,
    [owner, JSON.stringify(selection)])).rows[0];
}

export async function createReviewPanelRun({ owner, panelId, idempotencyKey, launchHash, data }, client = sql) {
  await client.query(
    `INSERT INTO review_panel_runs(id, owner_profile_id, panel_id, idempotency_key, launch_hash, data)
     VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(owner_profile_id, idempotency_key) DO NOTHING`,
    [randomUUID(), owner, panelId, idempotencyKey, launchHash, JSON.stringify(data)]);
  const row = (await client.query(
    'SELECT * FROM review_panel_runs WHERE owner_profile_id=$1 AND idempotency_key=$2', [owner, idempotencyKey])).rows[0];
  if (row.launch_hash !== launchHash) throw reviewPanelError('That launch key was already used for a different selection or budget.');
  return row;
}

export async function findReviewPanelLaunch(owner, key) {
  return (await sql.query('SELECT * FROM review_panel_runs WHERE owner_profile_id=$1 AND idempotency_key=$2', [owner, key])).rows[0] || null;
}

export async function listReviewPanelRuns(owner) {
  return (await sql.query('SELECT * FROM review_panel_runs WHERE owner_profile_id=$1 ORDER BY created_at DESC LIMIT 30', [owner])).rows;
}

export async function readReviewPanelRun(owner, id) {
  const row = (await sql.query('SELECT * FROM review_panel_runs WHERE id=$1 AND owner_profile_id=$2', [id, owner])).rows[0];
  if (!row) throw reviewPanelError('Run not found.', 404);
  return row;
}

/**
 * Generic run-row mutator, mirrors cycle-dossier-store's mutateDossierRun:
 * locks the row, requires and checks the caller's CURRENT lease, re-asserts
 * the run owner is still an active superuser (assertReviewPanelActor, same
 * as mutateDossierRun does via assertDossierActor — a run's owner may have
 * been deactivated/demoted between launch and this mutation), calls
 * `fn(row, client)`, writes back status/data. leaseToken is required
 * (never optional): unlike an optional check that a falsy value could
 * bypass, every run-state mutation must go through the fence.
 */
export async function mutateReviewPanelRun(id, fn, { owner, leaseToken } = {}) {
  if (typeof leaseToken !== 'string' || !leaseToken.trim()) throw reviewPanelError('A worker lease token is required.', 400);
  return withReviewPanelTransaction(async client => {
    const row = (await client.query('SELECT * FROM review_panel_runs WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!row || (owner != null && Number(row.owner_profile_id) !== Number(owner))) throw reviewPanelError('Run not found.', 404);
    if (row.lease_token !== leaseToken || !row.locked_until || new Date(row.locked_until).getTime() <= Date.now()) {
      throw reviewPanelError('Worker lease expired.');
    }
    await assertReviewPanelActor(row.owner_profile_id, client);
    await fn(row, client);
    await client.query(
      `UPDATE review_panel_runs SET status=$2,data=$3::jsonb,lease_token=$4,locked_until=$5,updated_at=NOW() WHERE id=$1`,
      [id, row.status, JSON.stringify(row.data), row.lease_token, row.locked_until]);
    return row;
  });
}

/** Claim the single global review-panel worker lease. Mirrors claimDossierRun: an advisory lock serializes the claim decision; at most one run holds a live lease at once. */
export async function claimReviewPanelRun({ leaseMs = 280000 } = {}) {
  return withReviewPanelTransaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('review-panel-worker'),0)");
    const control = await readReviewPanelControl(client);
    if (!control || control.stop_requested) return null;
    const active = await client.query('SELECT id FROM review_panel_runs WHERE locked_until>NOW() LIMIT 1');
    if (active.rows.length) return null;
    const row = (await client.query(
      `SELECT * FROM review_panel_runs WHERE status IN ('queued','running')
       ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`)).rows[0];
    if (!row) return null;
    row.lease_token = randomUUID();
    row.locked_until = new Date(Date.now() + leaseMs).toISOString();
    if (row.status === 'queued') row.status = 'running';
    await client.query(
      `UPDATE review_panel_runs SET status=$2,lease_token=$3,locked_until=$4,updated_at=NOW() WHERE id=$1`,
      [row.id, row.status, row.lease_token, row.locked_until]);
    return row;
  });
}

export async function releaseReviewPanelRun(id, token) {
  await sql.query(`UPDATE review_panel_runs SET lease_token=NULL, locked_until=NULL WHERE id=$1 AND lease_token=$2`, [id, token]);
}

/** Create a pending entry for a request under a run. Requires the run's current lease (an entry is a run-state change, same fence as createAttempt). */
export async function createReviewPanelEntry({ runId, requestId, leaseToken, createdBy, data = {} }) {
  return withReviewPanelTransaction(async client => {
    const runRow = (await client.query('SELECT lease_token, locked_until FROM review_panel_runs WHERE id=$1 FOR UPDATE', [runId])).rows[0];
    if (!runRow) throw reviewPanelError('Run not found.', 404);
    assertCurrentLease(runRow, leaseToken);
    try {
      return (await client.query(
        `INSERT INTO review_panel_entries(id, run_id, request_id, request_revision, data, created_by)
         VALUES($1,$2,$3,(SELECT COALESCE(MAX(request_revision),0)+1 FROM review_panel_entries WHERE request_id=$3),$4::jsonb,$5)
         RETURNING *`,
        [randomUUID(), runId, requestId, JSON.stringify(data), createdBy])).rows[0];
    } catch (error) {
      if (error?.code === '23505') throw reviewPanelError('Another launch just reserved a revision for this request. Preview again.', 409);
      throw error;
    }
  });
}

export async function listReviewPanelEntries(runId, client = sql) {
  return (await client.query('SELECT * FROM review_panel_entries WHERE run_id=$1 ORDER BY created_at ASC', [runId])).rows;
}

export async function readReviewPanelEntry(id, client = sql) {
  return (await client.query('SELECT * FROM review_panel_entries WHERE id=$1', [id])).rows[0] || null;
}

export async function listAttemptsForEntry(entryId, client = sql) {
  return (await client.query('SELECT * FROM review_panel_seat_attempts WHERE entry_id=$1 ORDER BY seat_key, attempt_no ASC', [entryId])).rows;
}

/** Mutate one entry's status/data. Requires the run's current lease (entry state is a run-state change, same fence as createAttempt/selectWinners). */
// Locks the RUN row (FOR UPDATE OF r), exactly like createAttempt/selectWinners
// — not the entry row — so this stays serialized against every other
// lease-fenced writer through the SAME lock. `winners_json` is intentionally
// never written back here: selectWinners is its one writer (fence (1)'s
// header comment); a caller merging a stale in-memory copy of it back would
// risk clobbering a concurrent selectWinners merge.
export async function mutateReviewPanelEntry(entryId, fn, leaseToken) {
  return withReviewPanelTransaction(async client => {
    const row = (await client.query(
      `SELECT e.*, r.lease_token AS run_lease_token, r.locked_until AS run_locked_until
       FROM review_panel_entries e JOIN review_panel_runs r ON r.id = e.run_id WHERE e.id=$1 FOR UPDATE OF r`, [entryId])).rows[0];
    if (!row) throw reviewPanelError('Entry not found.', 404);
    assertCurrentLease({ lease_token: row.run_lease_token, locked_until: row.run_locked_until }, leaseToken);
    const entry = { id: row.id, run_id: row.run_id, request_id: row.request_id, request_revision: row.request_revision,
      status: row.status, data: row.data, winners_json: row.winners_json, created_by: row.created_by };
    await fn(entry);
    // retry_requested_at is always cleared here: this is the one place an
    // entry's status/data changes under the lease, and the marker's only
    // purpose is to survive from requestReviewPanelRetry (no lease held) to
    // the worker's next lease-fenced pass (retryFailedEntries -> this call).
    // Clearing it unconditionally on every mutation is a no-op for entries
    // that never had it set.
    return (await client.query(
      `UPDATE review_panel_entries SET status=$2,data=$3::jsonb,retry_requested_at=NULL,updated_at=NOW() WHERE id=$1 RETURNING *`,
      [entryId, entry.status, JSON.stringify(entry.data)])).rows[0];
  });
}

/**
 * Operator-initiated retry request from the route (no worker lease held).
 * Mirrors cycle-dossier-service.js's retry settle-check
 * (`source.lease_token || ['queued','running'].includes(source.status)`):
 * the run must be fully settled before a retry can be queued. Marks only the
 * chosen entries that are currently `failed` with `retry_requested_at`, and
 * flips the run back to `queued` so the worker picks it up on its next pass.
 * The worker (retryFailedEntries, called under its own lease) creates the
 * fresh attempts and clears the marker via mutateReviewPanelEntry above —
 * this function never creates an attempt itself, so a route call can never
 * mint a paid call directly.
 */
export async function requestReviewPanelRetry(runId, owner, entryIds) {
  if (!Array.isArray(entryIds) || !entryIds.length) throw reviewPanelError('At least one entry id is required.', 400);
  return withReviewPanelTransaction(async client => {
    const run = (await client.query('SELECT * FROM review_panel_runs WHERE id=$1 AND owner_profile_id=$2 FOR UPDATE', [runId, owner])).rows[0];
    if (!run) throw reviewPanelError('Run not found.', 404);
    await assertReviewPanelActor(owner, client);
    // 'cancelled' is an explicit operator stop, not merely "unsettled" — a
    // retry must never resurrect a run the operator deliberately ended.
    if (run.lease_token || ['queued', 'running', 'cancelled'].includes(run.status)) {
      throw reviewPanelError(run.status === 'cancelled' ? 'This run was cancelled by the operator and cannot be retried.' : 'Wait for this run to settle before retrying.');
    }
    const eligible = (await client.query(
      `SELECT id FROM review_panel_entries WHERE run_id=$1 AND id = ANY($2::uuid[]) AND status='failed'`,
      [runId, entryIds])).rows;
    if (!eligible.length) throw reviewPanelError('None of the selected entries are eligible for retry.', 400);
    await client.query(
      `UPDATE review_panel_entries SET retry_requested_at=NOW(), updated_at=NOW() WHERE id = ANY($1::uuid[])`,
      [eligible.map((r) => r.id)]);
    return (await client.query(
      `UPDATE review_panel_runs SET status='queued', updated_at=NOW() WHERE id=$1 RETURNING *`, [runId])).rows[0];
  });
}

/** Entries in a run still carrying a retry marker, oldest first — read-only, used by the worker to decide which ids to hand to retryFailedEntries. */
export async function listRetryRequestedEntries(runId, client = sql) {
  return (await client.query(
    `SELECT id FROM review_panel_entries WHERE run_id=$1 AND retry_requested_at IS NOT NULL ORDER BY created_at ASC`, [runId])).rows.map((r) => r.id);
}

/**
 * Operator "stop this run" (cancel), from the route (no worker lease held).
 * A run currently held by an active worker lease cannot be cancelled here —
 * the operator stop flag (setReviewPanelOperatorStop) is the correct tool for
 * interrupting in-flight work; this only settles a run that is queued or
 * idle-running with no live lease (e.g. between drain passes).
 */
export async function requestReviewPanelCancel(runId, owner) {
  return withReviewPanelTransaction(async client => {
    const run = (await client.query('SELECT * FROM review_panel_runs WHERE id=$1 AND owner_profile_id=$2 FOR UPDATE', [runId, owner])).rows[0];
    if (!run) throw reviewPanelError('Run not found.', 404);
    await assertReviewPanelActor(owner, client);
    if (run.lease_token && run.locked_until && new Date(run.locked_until).getTime() > Date.now()) {
      throw reviewPanelError('Wait for the active worker pass to release this run before stopping it.');
    }
    if (!['queued', 'running'].includes(run.status)) throw reviewPanelError('This run is already settled.');
    const data = { ...run.data, error: 'Cancelled by operator.' };
    return (await client.query(
      `UPDATE review_panel_runs SET status='cancelled', data=$2::jsonb, updated_at=NOW() WHERE id=$1 RETURNING *`,
      [runId, JSON.stringify(data)])).rows[0];
  });
}

/**
 * Worker-side: the run owner lost superuser access mid-drain (checked by
 * assertReviewPanelActor immediately after claim and again immediately
 * before every paid dispatch — review-panel-worker.js). Deliberately does
 * NOT call assertReviewPanelActor — that is exactly the check that just
 * failed, so re-running it here would only throw again and leave the run
 * stuck lease-held forever. Mirrors cycle-dossier-store.js's
 * stopRevokedDossierRun: a raw, actor-gate-free UPDATE, fenced only on the
 * lease token the worker still holds. Fails the run outright (never
 * "paused" — restoring the owner's role doesn't retroactively make a
 * mid-flight dispatch decision safe to resume) and releases the lease so no
 * further dispatch is possible.
 */
export async function stopRevokedReviewPanelRun(id, token, message) {
  await sql.query(
    `UPDATE review_panel_runs SET status='failed', data = data || jsonb_build_object('error', $3::text),
       lease_token=NULL, locked_until=NULL, updated_at=NOW()
     WHERE id=$1 AND lease_token=$2`,
    [id, token, message]);
}
