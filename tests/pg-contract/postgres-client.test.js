'use strict';

/**
 * Contract tests for the Postgres driver seam (lib/postgres/client.js)
 * against a real Postgres planner, plan §4 item 1 / Stage 2 (fresh-context
 * review, docs/plans/POSTGRES_ACCESS_LAYER_MIGRATION_PLAN_2026-09-23.md).
 *
 * Lane fact: jest.pg-contract.config.js's moduleNameMapper swaps only
 * `^@vercel/postgres$` for tests/pg-contract/support/vercel-postgres-pg-shim.js,
 * so the seam's `withClient`/`withTransaction` (built on the shim's `db`,
 * imported internally by the seam and not part of its public exports)
 * hit the real container automatically when this file requires the real,
 * unmodified lib/postgres/client.js source.
 *
 * `getPool()` is different: it imports `pg` directly (not shimmed) and
 * reads `POSTGRES_URL || DATABASE_URL`, which this lane deliberately never
 * sets (see vercel-postgres-pg-shim.js's header). This file therefore sets
 * `process.env.POSTGRES_URL = process.env.PG_CONTRACT_URL` INSIDE this test
 * file, immediately before loading the seam under `jest.isolateModules`,
 * and never reads or sets any other URL. The global-setup preload has
 * already enforced loopback on `PG_CONTRACT_URL` (assertLocalHost), so
 * pointing `getPool()` at that same value is safe; this file must never
 * copy this pattern to point `getPool()` at a non-loopback URL.
 */

const crypto = require('node:crypto');
const { Client } = require('pg');

const PG_CONTRACT_URL = process.env.PG_CONTRACT_URL;
const describeIfDb = PG_CONTRACT_URL ? describe : describe.skip;

describeIfDb('lib/postgres/client: contract', () => {
  // Real, unmodified source; @vercel/postgres resolves to the pg shim via
  // jest.pg-contract.config.js's moduleNameMapper, so withClient/withTransaction
  // (built on the shim's db) reach the real container without further setup.
  const { withClient, withTransaction } = require('../../lib/postgres/client');
  // Same shim pool that db.connect()/withClient ultimately borrow from
  // (support/vercel-postgres-pg-shim.js) -- ended in afterAll alongside the
  // probe client and the getPool() test's own seam pool, mirroring
  // site-visit-collection-store.test.js's afterAll shape, so this file
  // never leaves an open handle for --runInBand.
  const { getPool: getShimPool } = require('./support/vercel-postgres-pg-shim.js');

  let client;
  let seamPool;
  const tableName = `pg_contract_probe_${crypto.randomBytes(6).toString('hex')}`;

  beforeAll(async () => {
    client = new Client({ connectionString: PG_CONTRACT_URL });
    await client.connect();
    await client.query(`CREATE TABLE ${tableName} (id text PRIMARY KEY)`);
  });

  afterAll(async () => {
    // End pools before the DROP: a lingering checked-out connection with
    // an open transaction on the probe table would otherwise make the
    // DROP hang. The statement_timeout on the DROP itself is the second
    // line of defense -- a real bug (e.g. a missing ROLLBACK) fails this
    // suite fast instead of hanging --runInBand.
    await getShimPool().end();
    if (seamPool) await seamPool.end();
    await client.query('SET statement_timeout = 5000');
    await client.query(`DROP TABLE IF EXISTS ${tableName}`);
    await client.end();
  });

  async function rowCount() {
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${tableName}`);
    return rows[0].n;
  }

  // Discriminating check (P2-1): a mutant that skips ROLLBACK but still
  // plain-releases the client would otherwise only be caught, slowly, by
  // the afterAll DROP hanging on a lock. This asserts directly that no
  // transaction is left open anywhere in the pool: a fresh withClient
  // call sees no assigned transaction id, and the server has zero
  // sessions idle inside an open transaction.
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

  test('withTransaction commits an insert and returns fn value', async () => {
    const id = crypto.randomUUID();
    const result = await withTransaction(async (c) => {
      await c.query(`INSERT INTO ${tableName} (id) VALUES ($1)`, [id]);
      return 'committed';
    });
    expect(result).toBe('committed');
    const { rows } = await client.query(`SELECT id FROM ${tableName} WHERE id = $1`, [id]);
    expect(rows).toHaveLength(1);
    await assertNoOpenTransactionAnywhere();
  });

  test('withTransaction rolls back an insert on throw', async () => {
    const id = crypto.randomUUID();
    const before = await rowCount();
    await expect(
      withTransaction(async (c) => {
        await c.query(`INSERT INTO ${tableName} (id) VALUES ($1)`, [id]);
        throw new Error('force rollback');
      })
    ).rejects.toThrow('force rollback');
    const { rows } = await client.query(`SELECT id FROM ${tableName} WHERE id = $1`, [id]);
    expect(rows).toHaveLength(0);
    expect(await rowCount()).toBe(before);
    await assertNoOpenTransactionAnywhere();
  });

  test('withTransaction rolls back a nested-throw case unchanged (probe table untouched)', async () => {
    const id = crypto.randomUUID();
    const before = await rowCount();

    async function helperThatThrowsAfterInsert(c) {
      await c.query(`INSERT INTO ${tableName} (id) VALUES ($1)`, [id]);
      throw new Error('nested failure after insert');
    }

    await expect(
      withTransaction(async (c) => helperThatThrowsAfterInsert(c))
    ).rejects.toThrow('nested failure after insert');

    expect(await rowCount()).toBe(before);
    await assertNoOpenTransactionAnywhere();
  });

  test('withClient runs a query and releases the connection back to the pool', async () => {
    const result = await withClient(async (c) => {
      const { rows } = await c.query('SELECT 1 AS one');
      return rows[0].one;
    });
    expect(result).toBe(1);

    // Released clients return to the pool's idle set; if release() were
    // never called (or the client were left checked out), idleCount would
    // stay below totalCount.
    const shimPool = getShimPool();
    expect(shimPool.idleCount).toBe(shimPool.totalCount);
  });

  describe('getPool', () => {
    const ORIGINAL_POSTGRES_URL = process.env.POSTGRES_URL;

    afterEach(() => {
      if (ORIGINAL_POSTGRES_URL === undefined) delete process.env.POSTGRES_URL;
      else process.env.POSTGRES_URL = ORIGINAL_POSTGRES_URL;
    });

    test('runs SELECT 1 against the real container and is a singleton across calls; end() is not part of the public surface', async () => {
      await jest.isolateModulesAsync(async () => {
        process.env.POSTGRES_URL = PG_CONTRACT_URL;
        const seam = require('../../lib/postgres/client');
        expect(Object.keys(seam)).not.toContain('end');
        const pool = seam.getPool();
        const poolAgain = seam.getPool();
        const { rows } = await pool.query('SELECT 1 AS one');
        expect(rows[0].one).toBe(1);
        expect(poolAgain).toBe(pool);
        // Held at describe scope so the outer afterAll ends it -- this
        // isolated module registry's pool is not reachable once
        // isolateModulesAsync returns.
        seamPool = pool;
      });
    });
  });
});
