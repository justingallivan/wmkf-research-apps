'use strict';

/**
 * Contract test for lib/services/dynamics-explorer/explorer-store.js —
 * Stage 3 item 1 (also the template commit later Stage 3 items copy),
 * docs/plans/POSTGRES_ACCESS_LAYER_MIGRATION_PLAN_2026-09-23.md.
 *
 * This store has no unit test of its own (only source-text /
 * characterization coverage via chat.js and chat-session.js), so per
 * plan §2 rule 9 and the Stage 3 "tests before" note, this contract test
 * IS the tests-before requirement — no characterization unit test is
 * added in addition.
 *
 * Real, unmodified source; @vercel/postgres resolves to the pg shim via
 * jest.pg-contract.config.js's moduleNameMapper (support/vercel-postgres-pg-shim.js),
 * so getUserRole/getActiveRestrictions/logQuery reach the real container
 * without further setup, both before and after the driver-import ->
 * lib/postgres/client swap (the seam itself requires '@vercel/postgres'
 * internally, which the same moduleNameMapper intercepts).
 *
 * The 42703 legacy-column fallback insert in logQuery is unreachable
 * against this fresh schema (dynamics_query_log already has request_id/
 * request_round) — left uncovered here per the Stage 3 log note; it is
 * exercised only by the mocked characterization test.
 */

const crypto = require('node:crypto');
const { Client } = require('pg');
const { withClient } = require('../../lib/postgres/client');
const { getPool: getShimPool } = require('./support/vercel-postgres-pg-shim.js');

const PG_CONTRACT_URL = process.env.PG_CONTRACT_URL;
const describeIfDb = PG_CONTRACT_URL ? describe : describe.skip;

describeIfDb('dynamics-explorer/explorer-store: contract', () => {
  const { getUserRole, getActiveRestrictions, logQuery } = require('../../lib/services/dynamics-explorer/explorer-store');

  let client;
  const insertedUserProfileIds = [];
  const insertedRestrictionIds = [];
  const insertedQueryLogIds = [];

  beforeAll(async () => {
    client = new Client({ connectionString: PG_CONTRACT_URL });
    await client.connect();
  });

  afterAll(async () => {
    if (insertedQueryLogIds.length) {
      await client.query('DELETE FROM dynamics_query_log WHERE id = ANY($1::int[])', [insertedQueryLogIds]);
    }
    if (insertedRestrictionIds.length) {
      await client.query('DELETE FROM dynamics_restrictions WHERE id = ANY($1::int[])', [insertedRestrictionIds]);
    }
    if (insertedUserProfileIds.length) {
      await client.query('DELETE FROM dynamics_user_roles WHERE user_profile_id = ANY($1::int[])', [insertedUserProfileIds]);
      await client.query('DELETE FROM user_profiles WHERE id = ANY($1::int[])', [insertedUserProfileIds]);
    }
    await client.end();
    await getShimPool().end();
  });

  // Discriminating check (Stage 2 hygiene, mirrors postgres-client.test.js):
  // a mutant that leaves a transaction open on the shared pool would
  // otherwise only surface, slowly, as later tests/suites blocking on a
  // lock under --runInBand.
  async function assertNoOpenTransactionAnywhere() {
    const xact = await withClient(async (c) => {
      const { rows } = await c.query('SELECT pg_current_xact_id_if_assigned() AS x');
      return rows[0].x;
    });
    expect(xact).toBeNull();

    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND state LIKE 'idle in transaction%'`
    );
    expect(rows[0].n).toBe(0);
  }

  async function insertUserProfile() {
    const name = `explorer_store_contract_${crypto.randomBytes(6).toString('hex')}`;
    const { rows } = await client.query(
      `INSERT INTO user_profiles (name) VALUES ($1) RETURNING id`,
      [name]
    );
    const id = rows[0].id;
    insertedUserProfileIds.push(id);
    return id;
  }

  describe('getUserRole', () => {
    test('returns the seeded role for a known user_profile_id', async () => {
      const userProfileId = await insertUserProfile();
      await client.query(
        `INSERT INTO dynamics_user_roles (user_profile_id, role) VALUES ($1, $2)`,
        [userProfileId, 'admin']
      );

      const role = await getUserRole(userProfileId);
      expect(role).toBe('admin');
      await assertNoOpenTransactionAnywhere();
    });

    test('returns the default read_only role when no row exists for the user', async () => {
      const userProfileId = await insertUserProfile();
      const role = await getUserRole(userProfileId);
      expect(role).toBe('read_only');
      await assertNoOpenTransactionAnywhere();
    });

    test('returns read_only without querying when userProfileId is falsy', async () => {
      const role = await getUserRole(null);
      expect(role).toBe('read_only');
    });
  });

  describe('getActiveRestrictions', () => {
    // Deviation from the brief: dynamics_restrictions (scripts/setup-database.js
    // ~:204-211) has no is_active/active column -- every row is always
    // "active"; there is no soft-delete/enable flag for this store to
    // filter on. getActiveRestrictions selects every row unconditionally.
    // This test therefore seeds two rows and a third that is a genuine
    // DELETEd row (never returned by any SELECT, active or not) to prove
    // shape and ordering rather than an active/inactive filter that does
    // not exist in the schema.
    test('returns restrictions ordered by table_name; a deleted row never appears', async () => {
      const suffix = crypto.randomBytes(6).toString('hex');
      const tableA = `zz_explorer_contract_${suffix}_a`;
      const tableB = `zz_explorer_contract_${suffix}_b`;
      const tableDeleted = `zz_explorer_contract_${suffix}_deleted`;

      const { rows } = await client.query(
        `INSERT INTO dynamics_restrictions (table_name, field_name, restriction_type, reason)
         VALUES ($1, 'field_b', 'block', 'row b'),
                ($2, 'field_a', 'block', 'row a'),
                ($3, 'field_c', 'block', 'to be deleted')
         RETURNING id, table_name`,
        [tableB, tableA, tableDeleted]
      );
      rows.forEach((r) => insertedRestrictionIds.push(r.id));

      const deletedRow = rows.find((r) => r.table_name === tableDeleted);
      await client.query('DELETE FROM dynamics_restrictions WHERE id = $1', [deletedRow.id]);
      insertedRestrictionIds.splice(insertedRestrictionIds.indexOf(deletedRow.id), 1);

      const restrictions = await getActiveRestrictions();
      const ours = restrictions.filter((r) => r.table_name === tableA || r.table_name === tableB);
      expect(ours).toHaveLength(2);
      // ORDER BY table_name -> tableA before tableB (shared suffix, 'a' < 'b')
      expect(ours[0].table_name).toBe(tableA);
      expect(ours[1].table_name).toBe(tableB);
      expect(restrictions.some((r) => r.table_name === tableDeleted)).toBe(false);
      await assertNoOpenTransactionAnywhere();
    });
  });

  describe('logQuery', () => {
    async function pollForLogRow(requestId, { retries = 20, delayMs = 100 } = {}) {
      for (let i = 0; i < retries; i += 1) {
        const { rows } = await client.query(
          'SELECT * FROM dynamics_query_log WHERE request_id = $1',
          [requestId]
        );
        if (rows.length) return rows[0];
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      throw new Error(`logQuery: no row for request_id ${requestId} after ${retries * delayMs}ms`);
    }

    test('fire-and-forget insert persists query_params JSONB and binds request_id/request_round', async () => {
      const requestId = crypto.randomUUID();
      const queryParams = { entity: 'contact', filter: { status: 'active' } };

      const result = logQuery({
        requestId,
        requestRound: 2,
        userProfileId: null,
        sessionId: 'contract-session',
        queryType: 'query',
        tableName: 'contact',
        queryParams,
        recordCount: 3,
        executionTime: 42,
      });
      expect(result).toBeUndefined();

      const row = await pollForLogRow(requestId);
      insertedQueryLogIds.push(row.id);

      expect(row.query_params).toEqual(queryParams);
      expect(row.request_id).toBe(requestId);
      expect(row.request_round).toBe(2);
      expect(row.session_id).toBe('contract-session');
      expect(row.record_count).toBe(3);
      await assertNoOpenTransactionAnywhere();
    });

    // DISCRIMINATING FIXTURE: a non-integer requestRound must be stored as
    // NULL (Number.isInteger(requestRound) ? requestRound : null in the
    // source), never coerced to a number and never rejected by the planner.
    test('DISCRIMINATING: a non-integer requestRound is stored as NULL, not coerced or errored', async () => {
      const requestId = crypto.randomUUID();

      const result = logQuery({
        requestId,
        requestRound: 'abc',
        userProfileId: null,
        sessionId: 'contract-session-bad-round',
        queryType: 'query',
        tableName: 'contact',
        queryParams: { entity: 'contact' },
        recordCount: 0,
        executionTime: 1,
      });
      expect(result).toBeUndefined();

      const row = await pollForLogRow(requestId);
      insertedQueryLogIds.push(row.id);

      expect(row.request_round).toBeNull();
      await assertNoOpenTransactionAnywhere();
    });
  });
});
