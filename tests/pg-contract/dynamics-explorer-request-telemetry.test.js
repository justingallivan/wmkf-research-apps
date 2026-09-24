'use strict';

/**
 * Contract test for lib/services/dynamics-explorer-request-telemetry.js —
 * Stage 3 item 4 (wave 2 slice A), docs/plans/POSTGRES_ACCESS_LAYER_MIGRATION_PLAN_2026-09-23.md.
 *
 * Copies the template shape (tests/pg-contract/explorer-store.test.js):
 * PG_CONTRACT_URL gating, a direct pg Client for setup/verification/cleanup,
 * assertNoOpenTransactionAnywhere, tracked keys before writes, afterAll with
 * bounded lock_timeout/statement_timeout, child-first deletes in
 * try/finally, and a Promise.allSettled close of both the direct client and
 * the shim pool.
 *
 * dynamics_explorer_requests (scripts/setup-database.js ~:229) has a real FK
 * to user_profiles(id) ON DELETE SET NULL; every write test below seeds a
 * user_profiles row and asserts it lands as user_profile_id.
 *
 * Only tests/unit/dynamics-explorer-request-telemetry.test.js mocks
 * `@vercel/postgres` directly; dynamics-explorer-chat-characterization.test.js
 * and tests/integration/dynamics-explorer-tool-serialization.test.js mock
 * this module's own export, so neither loads real source and neither is
 * affected by the import-path swap.
 */

const crypto = require('node:crypto');
const { Client } = require('pg');
const { getPool: getShimPool } = require('./support/vercel-postgres-pg-shim.js');

const PG_CONTRACT_URL = process.env.PG_CONTRACT_URL;
const describeIfDb = PG_CONTRACT_URL ? describe : describe.skip;

describeIfDb('dynamics-explorer-request-telemetry: contract', () => {
  const {
    DynamicsExplorerRequestTelemetry,
    normalizeRequestId,
    normalizeSessionId,
  } = require('../../lib/services/dynamics-explorer-request-telemetry');

  let client;
  const insertedUserProfileIds = [];
  const insertedRequestIds = [];

  beforeAll(async () => {
    client = new Client({ connectionString: PG_CONTRACT_URL });
    await client.connect();
  });

  afterAll(async () => {
    let deleteError;
    try {
      await client.query(`SET lock_timeout = '5s'`);
      await client.query(`SET statement_timeout = '10s'`);
      if (insertedRequestIds.length) {
        await client.query('DELETE FROM dynamics_explorer_requests WHERE request_id = ANY($1::uuid[])', [insertedRequestIds]);
      }
      if (insertedUserProfileIds.length) {
        await client.query('DELETE FROM user_profiles WHERE id = ANY($1::int[])', [insertedUserProfileIds]);
      }
    } catch (err) {
      deleteError = err;
    } finally {
      await Promise.allSettled([client.end(), getShimPool().end()]);
    }
    if (deleteError) throw deleteError;
  });

  async function assertNoOpenTransactionAnywhere() {
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND state LIKE 'idle in transaction%'`
    );
    expect(rows[0].n).toBe(0);
  }

  async function insertUserProfile() {
    const name = `dert_contract_${crypto.randomBytes(6).toString('hex')}`;
    const { rows } = await client.query(`INSERT INTO user_profiles (name) VALUES ($1) RETURNING id`, [name]);
    const id = rows[0].id;
    insertedUserProfileIds.push(id);
    return id;
  }

  async function fetchRow(requestId) {
    const { rows } = await client.query('SELECT * FROM dynamics_explorer_requests WHERE request_id = $1', [requestId]);
    return rows[0] || null;
  }

  test('startRequest binds every column, including a real user_profile_id, and defaults outcome/rounds', async () => {
    const requestId = crypto.randomUUID();
    insertedRequestIds.push(requestId);
    const userProfileId = await insertUserProfile();

    const started = await DynamicsExplorerRequestTelemetry.startRequest({
      requestId,
      userProfileId,
      sessionId: 'contract-session-1',
    });
    expect(started).toBe(true);

    const row = await fetchRow(requestId);
    expect(row.request_id).toBe(requestId);
    expect(row.user_profile_id).toBe(userProfileId);
    expect(row.session_id).toBe('contract-session-1');
    expect(row.outcome).toBe('running');
    expect(row.rounds_used).toBe(0);
    expect(row.completed_at).toBeNull();
    await assertNoOpenTransactionAnywhere();
  });

  test('startRequest returns false without touching the database for an invalid (non-UUID) request id', async () => {
    const started = await DynamicsExplorerRequestTelemetry.startRequest({
      requestId: 'not-a-uuid',
      sessionId: 'x',
    });
    expect(started).toBe(false);
    expect(normalizeRequestId('not-a-uuid')).toBeNull();
  });

  test('startRequest ON CONFLICT DO NOTHING: a second start for the same request_id returns false and does not clobber the row', async () => {
    const requestId = crypto.randomUUID();
    insertedRequestIds.push(requestId);
    const userProfileId = await insertUserProfile();

    const first = await DynamicsExplorerRequestTelemetry.startRequest({ requestId, userProfileId, sessionId: 'first' });
    expect(first).toBe(true);

    const second = await DynamicsExplorerRequestTelemetry.startRequest({ requestId, userProfileId, sessionId: 'second' });
    expect(second).toBe(false);

    const row = await fetchRow(requestId);
    // Proves ON CONFLICT DO NOTHING actually fired: session_id kept the
    // FIRST value, not the second attempt's -- kills a mutant that turns
    // this into an upsert.
    expect(row.session_id).toBe('first');
    await assertNoOpenTransactionAnywhere();
  });

  test('finalizeRequest (UPDATE path): binds outcome/rounds/model/stop_reason/error_stage and sets completed_at, only from the running state', async () => {
    const requestId = crypto.randomUUID();
    insertedRequestIds.push(requestId);
    const userProfileId = await insertUserProfile();
    await DynamicsExplorerRequestTelemetry.startRequest({ requestId, userProfileId, sessionId: 'to-finalize' });

    const finalized = await DynamicsExplorerRequestTelemetry.finalizeRequest({
      requestId,
      outcome: 'error',
      roundsUsed: 4,
      model: 'contract-model',
      stopReason: 'contract-stop-reason',
      errorStage: 'tool',
    });
    expect(finalized).toBe(true);

    const row = await fetchRow(requestId);
    expect(row.outcome).toBe('error');
    expect(row.rounds_used).toBe(4);
    expect(row.model).toBe('contract-model');
    expect(row.stop_reason).toBe('contract-stop-reason');
    expect(row.error_stage).toBe('tool');
    expect(row.completed_at).not.toBeNull();
    await assertNoOpenTransactionAnywhere();
  });

  test('finalizeRequest nulls error_stage when outcome is not "error", even if a valid stage was supplied', async () => {
    const requestId = crypto.randomUUID();
    insertedRequestIds.push(requestId);
    const userProfileId = await insertUserProfile();
    await DynamicsExplorerRequestTelemetry.startRequest({ requestId, userProfileId, sessionId: 'not-error' });

    const finalized = await DynamicsExplorerRequestTelemetry.finalizeRequest({
      requestId,
      outcome: 'completed',
      roundsUsed: 1,
      // Valid ERROR_STAGES member, but outcome !== 'error' -- must be
      // dropped to NULL. Kills a mutant that stores errorStage whenever
      // it's a recognized value regardless of outcome.
      errorStage: 'tool',
    });
    expect(finalized).toBe(true);

    const row = await fetchRow(requestId);
    expect(row.outcome).toBe('completed');
    expect(row.error_stage).toBeNull();
    await assertNoOpenTransactionAnywhere();
  });

  test('finalizeRequest (INSERT recovery path): a request with no start row is created directly in a terminal state', async () => {
    const requestId = crypto.randomUUID();
    insertedRequestIds.push(requestId);
    const userProfileId = await insertUserProfile();

    const finalized = await DynamicsExplorerRequestTelemetry.finalizeRequest({
      requestId,
      userProfileId,
      sessionId: 'recovered-session',
      outcome: 'client_disconnected',
      roundsUsed: 2,
    });
    expect(finalized).toBe(true);

    const row = await fetchRow(requestId);
    expect(row.user_profile_id).toBe(userProfileId);
    expect(row.session_id).toBe('recovered-session');
    expect(row.outcome).toBe('client_disconnected');
    expect(row.rounds_used).toBe(2);
    expect(row.completed_at).not.toBeNull();
    await assertNoOpenTransactionAnywhere();
  });

  test('finalizeRequest is a no-op (false) against an already-terminal row and does not overwrite it', async () => {
    const requestId = crypto.randomUUID();
    insertedRequestIds.push(requestId);
    const userProfileId = await insertUserProfile();
    await DynamicsExplorerRequestTelemetry.finalizeRequest({
      requestId, userProfileId, outcome: 'completed', roundsUsed: 1,
    });

    // Second finalize on the same already-terminal request_id: UPDATE's
    // WHERE outcome = 'running' guard must exclude it, and the INSERT
    // fallback's ON CONFLICT DO NOTHING must not touch the existing row.
    // A mutant dropping the WHERE outcome='running' clause would instead
    // overwrite outcome/rounds_used here.
    const second = await DynamicsExplorerRequestTelemetry.finalizeRequest({
      requestId, userProfileId, outcome: 'error', roundsUsed: 9,
    });
    expect(second).toBe(false);

    const row = await fetchRow(requestId);
    expect(row.outcome).toBe('completed');
    expect(row.rounds_used).toBe(1);
    await assertNoOpenTransactionAnywhere();
  });

  test('normalizeSessionId rejects an empty string and an over-length string', () => {
    expect(normalizeSessionId('')).toBeNull();
    expect(normalizeSessionId('x'.repeat(101))).toBeNull();
    expect(normalizeSessionId('x'.repeat(100))).toBe('x'.repeat(100));
  });

  // DISCRIMINATING: rounds_used is a real SMALLINT column (scripts/setup-database.js
  // ~:236, max 32767). normalizeRounds only guards "is a non-negative
  // integer" -- it does not cap the upper bound -- so roundsUsed: 99999
  // passes the app-level guard but is a genuine planner rejection (22003,
  // smallint out of range) once it reaches the INSERT recovery path (no
  // start row exists for this request_id, so finalizeRequest goes straight
  // to INSERT). This proves the try/catch in finalizeRequest reaches the
  // database call, not just the two early-return guards: a mutant that
  // removed it would make this call reject instead of resolving false.
  test('DISCRIMINATING: an out-of-range SMALLINT roundsUsed is a real planner rejection that resolves false, never throws', async () => {
    const requestId = crypto.randomUUID();
    insertedRequestIds.push(requestId); // no-op cleanup target; row is never created

    await expect(
      DynamicsExplorerRequestTelemetry.finalizeRequest({
        requestId,
        outcome: 'completed',
        roundsUsed: 99999,
      })
    ).resolves.toBe(false);

    const row = await fetchRow(requestId);
    expect(row).toBeNull();
    await assertNoOpenTransactionAnywhere();
  });
});
