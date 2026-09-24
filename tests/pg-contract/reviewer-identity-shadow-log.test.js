'use strict';

/**
 * Contract test for lib/services/reviewer-identity-shadow-log.js — Stage 3
 * item 2 (wave 2 slice A), docs/plans/POSTGRES_ACCESS_LAYER_MIGRATION_PLAN_2026-09-23.md.
 *
 * Copies the shape of tests/pg-contract/explorer-store.test.js (template):
 * PG_CONTRACT_URL gating, a direct pg Client for setup/verification/cleanup,
 * assertNoOpenTransactionAnywhere, tracked keys before writes, afterAll with
 * bounded lock_timeout/statement_timeout, child-first deletes in
 * try/finally, and a Promise.allSettled close of both the direct client and
 * the shim pool.
 *
 * reviewer_identity_shadow_log has no FK (scripts/setup-database.js v36) so
 * there is nothing to seed beyond the row itself.
 *
 * This is a fail-open (best-effort) telemetry writer (plan §7): the module
 * must never throw to the caller even when the insert statement itself is
 * rejected by the planner. recordShadowComparison/recordShadowError always
 * resolve, and the "DISCRIMINATING: constraint violation" test below proves
 * a real planner rejection (event_type CHECK violation via the internal
 * insertRow helper) resolves 'failed' rather than throwing or hanging.
 */

const crypto = require('node:crypto');
const { Client } = require('pg');
const { getPool: getShimPool } = require('./support/vercel-postgres-pg-shim.js');

const PG_CONTRACT_URL = process.env.PG_CONTRACT_URL;
const describeIfDb = PG_CONTRACT_URL ? describe : describe.skip;

describeIfDb('reviewer-identity-shadow-log: contract', () => {
  const {
    recordShadowComparison,
    recordShadowError,
    _internals,
  } = require('../../lib/services/reviewer-identity-shadow-log');

  let client;
  const insertedRunIds = [];

  beforeAll(async () => {
    client = new Client({ connectionString: PG_CONTRACT_URL });
    await client.connect();
  });

  afterEach(() => {
    _internals.resetBreaker();
  });

  afterAll(async () => {
    let deleteError;
    try {
      await client.query(`SET lock_timeout = '5s'`);
      await client.query(`SET statement_timeout = '10s'`);
      if (insertedRunIds.length) {
        await client.query(
          'DELETE FROM reviewer_identity_shadow_log WHERE run_id = ANY($1::text[])',
          [insertedRunIds]
        );
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

  async function pollForRow(runId, { retries = 20, delayMs = 100 } = {}) {
    for (let i = 0; i < retries; i += 1) {
      const { rows } = await client.query(
        'SELECT * FROM reviewer_identity_shadow_log WHERE run_id = $1 ORDER BY id DESC LIMIT 1',
        [runId]
      );
      if (rows.length) return rows[0];
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    throw new Error(`reviewer-identity-shadow-log: no row for run_id ${runId} after ${retries * delayMs}ms`);
  }

  test('recordShadowComparison binds every column, including a non-null anchors_agree', async () => {
    const runId = `contract_${crypto.randomBytes(6).toString('hex')}`;
    insertedRunIds.push(runId);

    const outcome = await recordShadowComparison({
      runId,
      resolverMode: 'shadow-mode',
      candidateKey: 'candidate-key-abc',
      legacyDecision: 'accept',
      worksDecision: 'reject',
      combinedDecision: 'accept',
      combinedReason: 'legacy-wins',
      // Anti-correlated boolean: legacyDecision !== worksDecision above
      // (so a mutant that derives anchorsAgree from decision equality
      // would compute false here) while we assert true explicitly, so
      // a dropped/coerced anchorsAgree is caught by stored value, not by
      // accidental agreement between the two decision fields.
      anchorsAgree: true,
    });
    expect(outcome).toBe('inserted');

    const row = await pollForRow(runId);
    expect(row.resolver_mode).toBe('shadow-mode');
    expect(row.event_type).toBe('comparison');
    expect(row.candidate_key).toBe('candidate-key-abc');
    expect(row.legacy_decision).toBe('accept');
    expect(row.works_decision).toBe('reject');
    expect(row.combined_decision).toBe('accept');
    expect(row.combined_reason).toBe('legacy-wins');
    expect(row.anchors_agree).toBe(true);
    expect(row.error_code).toBeNull();
    await assertNoOpenTransactionAnywhere();
  });

  test('recordShadowError binds run_id/resolver_mode/candidate_key/error_code and leaves decision fields null', async () => {
    const runId = `contract_${crypto.randomBytes(6).toString('hex')}`;
    insertedRunIds.push(runId);

    const outcome = await recordShadowError({
      runId,
      resolverMode: 'shadow-mode-2',
      candidateKey: 'candidate-key-err',
      errorCode: 'ProviderTimeout',
    });
    expect(outcome).toBe('inserted');

    const row = await pollForRow(runId);
    expect(row.event_type).toBe('error');
    expect(row.resolver_mode).toBe('shadow-mode-2');
    expect(row.candidate_key).toBe('candidate-key-err');
    expect(row.error_code).toBe('ProviderTimeout');
    expect(row.legacy_decision).toBeNull();
    expect(row.works_decision).toBeNull();
    expect(row.combined_decision).toBeNull();
    expect(row.combined_reason).toBeNull();
    expect(row.anchors_agree).toBeNull();
    await assertNoOpenTransactionAnywhere();
  });

  // DISCRIMINATING: reviewer_identity_shadow_log.event_type has
  // CHECK (event_type IN ('comparison', 'error')) (scripts/setup-database.js
  // v36). insertRow is the module's only write path; calling it directly
  // with an out-of-domain event_type forces a REAL planner rejection
  // (23514 check_violation) rather than a mocked error, proving the
  // fail-open contract holds against an actual constraint failure, not
  // just a simulated JS throw. A mutant that lets the insert throw
  // synchronously (dropping the try/catch around `sql\`...\``) or that
  // never resolves (dropping the timeout race) would fail this test by
  // rejecting the returned promise or timing out the test itself.
  test('DISCRIMINATING: a real constraint violation (invalid event_type) resolves "failed", never throws', async () => {
    const runId = `contract_${crypto.randomBytes(6).toString('hex')}`;
    insertedRunIds.push(runId); // no-op cleanup target; row is never created

    await expect(
      _internals.insertRow({
        runId,
        resolverMode: 'shadow',
        eventType: 'not-a-real-event-type',
        candidateKey: null,
        legacyDecision: null,
        worksDecision: null,
        combinedDecision: null,
        combinedReason: null,
        anchorsAgree: null,
        errorCode: null,
      })
    ).resolves.toBe('failed');

    const { rows } = await client.query(
      'SELECT * FROM reviewer_identity_shadow_log WHERE run_id = $1',
      [runId]
    );
    expect(rows).toHaveLength(0);
    await assertNoOpenTransactionAnywhere();
  });
});
