'use strict';

/**
 * Contract test for lib/services/reviewer-institution-measurement.js —
 * Stage 3 item 2 (wave 2 slice A), docs/plans/POSTGRES_ACCESS_LAYER_MIGRATION_PLAN_2026-09-23.md.
 *
 * Copies the shape of tests/pg-contract/explorer-store.test.js (template):
 * PG_CONTRACT_URL gating, a direct pg Client for setup/verification/cleanup,
 * assertNoOpenTransactionAnywhere, tracked keys before writes, afterAll with
 * bounded lock_timeout/statement_timeout, child-first deletes in
 * try/finally, and a Promise.allSettled close of both the direct client and
 * the shim pool.
 *
 * reviewer_institution_measurement_events has no FK (scripts/setup-database.js
 * v52, ~:1155) so there is nothing to seed beyond the row itself.
 *
 * Fail-open (best-effort) telemetry writer (plan §7): recordInstitutionMeasurement
 * must never throw. The DISCRIMINATING test below proves buildRow's
 * pre-write captureSource guard: an out-of-domain captureSource is
 * 'skipped' before any INSERT is attempted, never reaching the database
 * and never landing a row -- it does not itself force a real
 * independent_identity (or any other) CHECK violation through the planner.
 */

const crypto = require('node:crypto');
const { Client } = require('pg');
const { getPool: getShimPool } = require('./support/vercel-postgres-pg-shim.js');

const PG_CONTRACT_URL = process.env.PG_CONTRACT_URL;
const describeIfDb = PG_CONTRACT_URL ? describe : describe.skip;

describeIfDb('reviewer-institution-measurement: contract', () => {
  let client;
  const insertedCaseKeys = [];
  const ORIGINAL_ENV = process.env.REVIEWER_INSTITUTION_MEASUREMENT;

  beforeAll(async () => {
    process.env.REVIEWER_INSTITUTION_MEASUREMENT = 'on';
    client = new Client({ connectionString: PG_CONTRACT_URL });
    await client.connect();
  });

  afterAll(async () => {
    if (ORIGINAL_ENV === undefined) delete process.env.REVIEWER_INSTITUTION_MEASUREMENT;
    else process.env.REVIEWER_INSTITUTION_MEASUREMENT = ORIGINAL_ENV;

    let deleteError;
    try {
      await client.query(`SET lock_timeout = '5s'`);
      await client.query(`SET statement_timeout = '10s'`);
      if (insertedCaseKeys.length) {
        await client.query(
          'DELETE FROM reviewer_institution_measurement_events WHERE case_key = ANY($1::char(64)[])',
          [insertedCaseKeys]
        );
      }
    } catch (err) {
      deleteError = err;
    } finally {
      await Promise.allSettled([client.end(), getShimPool().end()]);
    }
    if (deleteError) throw deleteError;
  });

  const { recordInstitutionMeasurement, _internals } = require('../../lib/services/reviewer-institution-measurement');

  function digest(value) {
    return require('crypto').createHash('sha256').update(value).digest('hex');
  }

  async function assertNoOpenTransactionAnywhere() {
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND state LIKE 'idle in transaction%'`
    );
    expect(rows[0].n).toBe(0);
  }

  async function pollForRow(caseKey, { retries = 20, delayMs = 100 } = {}) {
    for (let i = 0; i < retries; i += 1) {
      const { rows } = await client.query(
        'SELECT * FROM reviewer_institution_measurement_events WHERE case_key = $1 ORDER BY id DESC LIMIT 1',
        [caseKey]
      );
      if (rows.length) return rows[0];
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    throw new Error(`reviewer-institution-measurement: no row for case_key ${caseKey} after ${retries * delayMs}ms`);
  }

  test('recordInstitutionMeasurement (trusted server_applicant source) binds every column', async () => {
    const requestId = `req_${crypto.randomBytes(6).toString('hex')}`;
    const candidateKey = `cand_${crypto.randomBytes(6).toString('hex')}`;
    const caseKey = digest(`${requestId}\0${candidateKey}`);
    insertedCaseKeys.push(caseKey);

    const input = {
      requestId,
      candidate: {
        candidateKey,
        suggestedInstitution: 'Institution A',
        affiliation: 'Dept A',
        institutionMismatch: true,
        institutionPresentation: { version: 2 },
        // provenanceKindOf reads candidate.sourceKind/provenance-ish fields;
        // leaving source_kind unresolved is fine (nullable column) — the
        // test asserts the resolvable, trusted-branch columns below.
        additionalAffiliations: ['x', 'y', 'z'],
      },
      eventType: 'save_saved',
      captureSource: 'server_applicant',
      assessment: {
        evidenceAssertion: { sourceType: 'publication', currentness: 'current', authorSpecific: true },
        recordedAssertion: { sourceType: 'official_profile', currentness: 'historical' },
        // Anti-correlated: relationship != evidenceContext categories so a
        // mutant that swaps which assessment field feeds which column is
        // caught by stored value, not by the two columns coincidentally
        // matching.
        relationship: 'sibling',
        evidenceContext: 'historical_related',
        additionalAffiliations: ['x', 'y', 'z'],
      },
      legacyHold: true,
      outcomeCategory: 'saved',
    };

    const outcome = await recordInstitutionMeasurement(input);
    expect(outcome).toBe('inserted');

    const row = await pollForRow(caseKey);
    expect(row.case_key).toBe(caseKey);
    expect(row.card_snapshot_digest).toHaveLength(64);
    expect(row.event_type).toBe('save_saved');
    expect(row.capture_source).toBe('server_applicant');
    expect(row.legacy_hold).toBe(true);
    expect(row.relationship).toBe('sibling');
    expect(row.evidence_context).toBe('historical_related');
    expect(row.evidence_source_type).toBe('publication');
    expect(row.evidence_currentness).toBe('current');
    expect(row.evidence_author_specific).toBe('true');
    expect(row.recorded_source_type).toBe('official_profile');
    expect(row.recorded_currentness).toBe('historical');
    expect(row.additional_affiliation_count).toBe(3);
    expect(row.independent_identity).toBe('not_evaluable');
    expect(row.additional_coi).toBe('not_screened');
    expect(row.proposed_action).toBe('not_evaluable');
    expect(row.outcome_category).toBe('saved');
    await assertNoOpenTransactionAnywhere();
  });

  test('recordInstitutionMeasurement (untrusted roster_unverified source) nulls trusted-only columns', async () => {
    const requestId = `req_${crypto.randomBytes(6).toString('hex')}`;
    const candidateKey = `cand_${crypto.randomBytes(6).toString('hex')}`;
    const caseKey = digest(`${requestId}\0${candidateKey}`);
    insertedCaseKeys.push(caseKey);

    const outcome = await recordInstitutionMeasurement({
      requestId,
      candidate: { candidateKey },
      eventType: 'roster_upsert',
      captureSource: 'roster_unverified',
      assessment: {
        relationship: 'same',
        evidenceContext: 'compatible',
        evidenceAssertion: { sourceType: 'publication', currentness: 'current' },
      },
      legacyHold: true,
      outcomeCategory: 'other',
    });
    expect(outcome).toBe('inserted');

    const row = await pollForRow(caseKey);
    expect(row.capture_source).toBe('roster_unverified');
    // Untrusted source: legacy_hold/relationship/evidence_context/evidence_*
    // must all be null even though truthy-looking values were supplied
    // above — proves the `trusted` gate, not just field presence.
    expect(row.legacy_hold).toBeNull();
    expect(row.relationship).toBeNull();
    expect(row.evidence_context).toBeNull();
    expect(row.evidence_source_type).toBeNull();
    expect(row.evidence_currentness).toBeNull();
    expect(row.additional_affiliation_count).toBeNull();
    expect(row.outcome_category).toBe('other');
    await assertNoOpenTransactionAnywhere();
  });

  // DISCRIMINATING: buildRow returns null (and the function returns
  // 'skipped', never touching the database) when captureSource is not in
  // the allowed SOURCES set. A mutant that drops the captureSource
  // membership check in buildRow's guard would instead attempt an INSERT
  // with capture_source outside the CHECK (capture_source IN (...))
  // constraint (scripts/setup-database.js ~:1160) and either throw
  // (caught -> 'failed') or, if the guard were dropped differently, land a
  // row — both distinguishable from the real 'skipped' outcome and the
  // absence of any row for this case_key.
  test('DISCRIMINATING: an out-of-domain captureSource is skipped before any write, never inserted or failed', async () => {
    const requestId = `req_${crypto.randomBytes(6).toString('hex')}`;
    const candidateKey = `cand_${crypto.randomBytes(6).toString('hex')}`;
    const caseKey = digest(`${requestId}\0${candidateKey}`);
    insertedCaseKeys.push(caseKey); // no-op cleanup target; row is never created

    const outcome = await recordInstitutionMeasurement({
      requestId,
      candidate: { candidateKey },
      eventType: 'roster_upsert',
      captureSource: 'not-a-real-source',
      outcomeCategory: 'other',
    });
    expect(outcome).toBe('skipped');

    const { rows } = await client.query(
      'SELECT * FROM reviewer_institution_measurement_events WHERE case_key = $1',
      [caseKey]
    );
    expect(rows).toHaveLength(0);
    await assertNoOpenTransactionAnywhere();
  });

  test('measurementEnabled() and _internals.resetBreaker() are exercised for coverage of exported surface', () => {
    // eslint-disable-next-line global-require
    const { measurementEnabled } = require('../../lib/services/reviewer-institution-measurement');
    expect(measurementEnabled()).toBe(true);
    _internals.resetBreaker();
    expect(_internals.breaker.failures).toBe(0);
    expect(_internals.breaker.suspendedUntil).toBe(0);
  });
});
