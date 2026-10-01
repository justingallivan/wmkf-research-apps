/**
 * Thin db adapter for lib/services/test-requests/run-ledger.js.
 *
 * createRunLedger(db) takes an injected `{ query(text, params) -> { rows },
 * transaction(fn) }` interface so the store itself never imports a specific
 * Postgres client. pgLedgerDb is the one concrete adapter, built on the `pg`
 * package. (The former `@vercel/postgres` adapter bound the shared app
 * database, which must never be the ledger; it was deleted, owner decision 9.)
 */

/**
 * @param {string|object} connectionStringOrConfig - a ledger connection
 *   string, OR an already-built explicit pg config object (e.g. from
 *   buildLedgerClientConfig). A string is ALWAYS routed through
 *   lib/db/ledger-registry.js's buildLedgerClientConfig before reaching
 *   `pg.Pool` (Opus round-2 item 1), so every existing caller that passes a
 *   raw ledger URL keeps working unchanged while picking up the explicit,
 *   ambient-PG*-variable-proof config automatically.
 * @param {{ pool?: { max?: number, idleTimeoutMillis?: number, connectionTimeoutMillis?: number } }} [options]
 *   optional Pool settings merged into the config (the deployed admin form
 *   bounds its pool; the CLI passes nothing and is unchanged).
 */
export function pgLedgerDb(connectionStringOrConfig, options = {}) {
  // `pg` is loaded lazily and via dynamic import so this module stays valid
  // under native Node ESM (the .mjs rehearsal CLI) as well as Next and Jest,
  // and so the driver is never bundled into anything that does not call it.
  let poolPromise = null;
  const getPool = () => {
    if (!poolPromise) {
      poolPromise = Promise.all([import('pg'), import('../../db/ledger-registry.js')]).then(([pgMod, registryMod]) => {
        const { Pool } = pgMod.default ?? pgMod;
        const config = typeof connectionStringOrConfig === 'string'
          ? registryMod.buildLedgerClientConfig(connectionStringOrConfig)
          : connectionStringOrConfig;
        return new Pool({ ...config, ...(options.pool ?? {}) });
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
