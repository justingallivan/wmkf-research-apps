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
  // Tracked BEFORE each logQuery() call (not after polling succeeds) so a
  // fire-and-forget insert that lands only after a poll timeout in a
  // failed run still gets swept by request_id in afterAll -- an id-based
  // array populated from the poll result would miss exactly that case.
  const insertedRequestIds = [];

  beforeAll(async () => {
    client = new Client({ connectionString: PG_CONTRACT_URL });
    await client.connect();
  });

  afterAll(async () => {
    let deleteError;
    try {
      // Fail fast instead of hanging this suite's afterAll if another
      // --runInBand suite is holding a lock on one of these tables.
      await client.query(`SET lock_timeout = '5s'`);
      await client.query(`SET statement_timeout = '10s'`);
      // Children first (FK order): dynamics_query_log rows are matched by
      // request_id (see insertedRequestIds above), not by row id.
      if (insertedRequestIds.length) {
        await client.query('DELETE FROM dynamics_query_log WHERE request_id = ANY($1::uuid[])', [insertedRequestIds]);
      }
      if (insertedRestrictionIds.length) {
        await client.query('DELETE FROM dynamics_restrictions WHERE id = ANY($1::int[])', [insertedRestrictionIds]);
      }
      if (insertedUserProfileIds.length) {
        await client.query('DELETE FROM dynamics_user_roles WHERE user_profile_id = ANY($1::int[])', [insertedUserProfileIds]);
        await client.query('DELETE FROM user_profiles WHERE id = ANY($1::int[])', [insertedUserProfileIds]);
      }
    } catch (err) {
      deleteError = err;
    } finally {
      // Always close both handles, even if a DELETE above threw --
      // otherwise a cleanup failure also leaks the connection/pool and
      // hangs --detectOpenHandles on top of losing the real error.
      await Promise.allSettled([client.end(), getShimPool().end()]);
    }
    if (deleteError) throw deleteError;
  });

  // Discriminating check (Stage 2 hygiene, mirrors postgres-client.test.js):
  // a mutant that leaves a transaction open on the shared pool would
  // otherwise only surface, slowly, as later tests/suites blocking on a
  // lock under --runInBand. Note: the pg_stat_activity count is
  // database-wide (every connection to current_database(), not just this
  // suite's), which is fine as long as this contract lane runs a single
  // --runInBand process against a disposable container.
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

    // DISCRIMINATING (Codex addendum): dynamics_user_roles.user_profile_id
    // is INTEGER; comparing it to a non-numeric string makes the real
    // Postgres planner raise 22P02 (invalid input syntax for type
    // integer) -- a genuine planner error, not a mock -- which
    // getUserRole's try/catch must swallow into the 'read_only' default.
    // This is the only fixture that actually reaches the catch block
    // against the real database, so it is the only one that kills the
    // `catchdefault` mutant (catch returns 'admin' instead of
    // 'read_only'); the two tests above kill `default` and `falsydefault`
    // via their own return-value branches but never touch the catch path.
    test('DISCRIMINATING: a real 22P02 planner error on a non-integer id is caught and falls back to read_only', async () => {
      const role = await getUserRole('not-an-integer');
      expect(role).toBe('read_only');
    });
  });

  describe('getActiveRestrictions', () => {
    // Deviation from the brief: dynamics_restrictions (scripts/setup-database.js
    // ~:204-211) has no is_active/active column -- every row is always
    // "active"; there is no soft-delete/enable flag for this store to
    // filter on. getActiveRestrictions selects every row unconditionally,
    // so this test proves ordering/shape only, not an active/inactive
    // filter that does not exist in the schema.
    test('returns restrictions ordered by table_name (anti-correlated fixture kills orderfield/orderreason/orderdesc/noorder mutants)', async () => {
      const suffix = crypto.randomBytes(6).toString('hex');
      const tableFirst = `zz_explorer_contract_${suffix}_a`; // must sort FIRST by table_name
      const tableSecond = `zz_explorer_contract_${suffix}_b`; // must sort SECOND by table_name

      // Anti-correlated AND insertion-order-inverted on purpose:
      // - tableFirst (sorts first by table_name) gets 'field_z'/'z reason'
      //   (sorts LAST alphabetically) -- a mutant that orders by
      //   field_name or reason instead of table_name puts tableSecond
      //   first, flipping ours[0]/ours[1] and failing the assertions
      //   below (kills orderfield, orderreason).
      // - tableSecond is inserted BEFORE tableFirst in the VALUES list, so
      //   a mutant that drops ORDER BY entirely is not rescued by
      //   insertion/heap-scan order coincidentally matching table_name
      //   order (kills noorder).
      // - Relying on ASC table_name order (tableFirst before tableSecond)
      //   means a mutant that reverses to DESC also flips the pair and
      //   fails (kills orderdesc).
      const { rows } = await client.query(
        `INSERT INTO dynamics_restrictions (table_name, field_name, restriction_type, reason)
         VALUES ($1, 'field_a', 'block', 'a reason'),
                ($2, 'field_z', 'block', 'z reason')
         RETURNING id, table_name`,
        [tableSecond, tableFirst]
      );
      rows.forEach((r) => insertedRestrictionIds.push(r.id));

      const restrictions = await getActiveRestrictions();
      const ours = restrictions.filter((r) => r.table_name === tableFirst || r.table_name === tableSecond);
      expect(ours).toHaveLength(2);
      expect(ours[0].table_name).toBe(tableFirst);
      expect(ours[1].table_name).toBe(tableSecond);
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

    test('fire-and-forget insert binds every column, including a real user_profile_id', async () => {
      const requestId = crypto.randomUUID();
      insertedRequestIds.push(requestId);
      const userProfileId = await insertUserProfile();
      const queryParams = { entity: 'contact', filter: { status: 'active' } };

      const result = logQuery({
        requestId,
        requestRound: 2,
        userProfileId,
        sessionId: 'contract-session',
        queryType: 'query',
        tableName: 'contact',
        queryParams,
        recordCount: 3,
        executionTime: 42,
        wasDenied: false,
      });
      expect(result).toBeUndefined();

      const row = await pollForLogRow(requestId);

      expect(row.query_params).toEqual(queryParams);
      expect(row.request_id).toBe(requestId);
      expect(row.request_round).toBe(2);
      expect(row.session_id).toBe('contract-session');
      expect(row.record_count).toBe(3);
      // Previously always null in this fixture, which let mutants swap
      // query_type/table_name, zero executionTime, force wasDenied=true,
      // or drop userProfileId to null all survive undetected -- asserted
      // explicitly now (kills swapqt, exectime, wasdenied, nouserid).
      expect(row.user_profile_id).toBe(userProfileId);
      expect(row.query_type).toBe('query');
      expect(row.table_name).toBe('contact');
      expect(row.execution_time_ms).toBe(42);
      expect(row.was_denied).toBe(false);
      await assertNoOpenTransactionAnywhere();
    });

    // DISCRIMINATING FIXTURE: requestRound: '3' (a numeric STRING), not
    // 'abc'. A totally non-numeric string is NULL under both the real
    // `Number.isInteger(requestRound) ? requestRound : null` guard AND a
    // mutant `Number(requestRound) || null` guard (Number('abc') is NaN
    // either way) -- indistinguishable by stored value, and the
    // dropped-guard mutant (`${requestRound}` with no guard at all) would
    // only die slowly via the 2s poll timeout on a planner rejection.
    // '3' kills all of them by stored VALUE instead:
    //   - real code: Number.isInteger('3') === false -> stores NULL.
    //   - numcoerce mutant: Number('3') === 3 (truthy) -> stores 3.
    //   - noguard mutant: binds the raw string '3' into a SMALLINT column
    //     -> Postgres casts it and stores 3.
    // Both mutants store 3; the real code stores NULL; this test asserts
    // NULL, so it fails against either mutant.
    test('DISCRIMINATING: a numeric-string requestRound ("3") is stored as NULL, never coerced to 3', async () => {
      const requestId = crypto.randomUUID();
      insertedRequestIds.push(requestId);

      const result = logQuery({
        requestId,
        requestRound: '3',
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
      expect(row.request_round).toBeNull();
      await assertNoOpenTransactionAnywhere();
    });
  });
});
