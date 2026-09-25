import { db, sql } from '@vercel/postgres';

/**
 * Thin db adapters for lib/services/test-requests/run-ledger.js.
 *
 * createRunLedger(db) takes an injected `{ query(text, params) -> { rows },
 * transaction(fn) }` interface so the store itself never imports a specific
 * Postgres client. This file supplies two concrete adapters:
 *
 *   - vercelPostgresLedgerDb() — production/preview, built on `@vercel/postgres`,
 *     following the `db.connect()` + `client.query('BEGIN'/'COMMIT'/'ROLLBACK')`
 *     transaction convention already used by
 *     lib/services/consultant-feedback-service.js.
 *   - pgLedgerDb(connectionString) — local proofs only, built on the `pg`
 *     package the same way scripts/apply-migrations.js does (`new Client(...)`).
 *     Used by tests/integration/test-request-run-ledger.pg.test.js.
 *
 * Both adapters expose the identical shape so run-ledger.js's SQL (with
 * $1/$2/... placeholders) works unchanged against either.
 */

export function vercelPostgresLedgerDb() {
  return {
    async query(text, params = []) {
      return sql.query(text, params);
    },
    async transaction(fn) {
      const client = await db.connect();
      let failed = null;
      try {
        await client.query('BEGIN');
        const result = await fn({
          query: (text, params = []) => client.query(text, params),
        });
        await client.query('COMMIT');
        return result;
      } catch (error) {
        failed = error;
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        // A failed transaction may sit on a broken connection: passing the
        // error discards it instead of returning it to the pool.
        if (failed) client.release(failed); else client.release();
      }
    },
  };
}

export function pgLedgerDb(connectionString) {
  // `pg` is loaded lazily and via dynamic import so this module stays valid
  // under native Node ESM (the .mjs rehearsal CLI) as well as Next and Jest,
  // and so the driver is never bundled into anything that does not call it.
  let poolPromise = null;
  const getPool = () => {
    if (!poolPromise) {
      poolPromise = import('pg').then((mod) => {
        const { Pool } = mod.default ?? mod;
        return new Pool({ connectionString });
      });
    }
    return poolPromise;
  };

  return {
    async query(text, params = []) {
      const pool = await getPool();
      return pool.query(text, params);
    },
    async transaction(fn) {
      const pool = await getPool();
      const client = await pool.connect();
      let failed = null;
      try {
        await client.query('BEGIN');
        const result = await fn({
          query: (text, params = []) => client.query(text, params),
        });
        await client.query('COMMIT');
        return result;
      } catch (error) {
        failed = error;
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        // A failed transaction may sit on a broken connection: passing the
        // error discards it instead of returning it to the pool.
        if (failed) client.release(failed); else client.release();
      }
    },
    async end() {
      if (poolPromise) await (await poolPromise).end();
    },
  };
}
