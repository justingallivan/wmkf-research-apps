'use strict';

/**
 * Minimal `@vercel/postgres` stand-in backed by plain `pg` against a real
 * Postgres instance, for the contract lane only (jest.pg-contract.config.js
 * moduleNameMapper + the setup-database.js child-process preload).
 *
 * `@vercel/postgres` is Neon's serverless driver over WebSocket
 * (node_modules/@vercel/postgres -> @neondatabase/serverless) and cannot
 * reach a plain container Postgres. This shim implements only the surface
 * the census files actually use:
 *   - `sql` tagged template -> parameterized pg query, returns {rows, rowCount}
 *   - `sql.query(text, params)`
 *   - `db.connect()` -> a pg PoolClient (`.query`, `.release`)
 *
 * See docs/plans/POSTGRES_ACCESS_LAYER_MIGRATION_PLAN_2026-09-23.md §3 Q1/Q1b.
 */

const { Pool } = require('pg');

let pool;

function getPool() {
  if (!pool) {
    // PG_CONTRACT_URL only — never POSTGRES_URL. This process (and any
    // setup-database.js/apply-migrations.js child it spawns) may have
    // POSTGRES_URL set in its environment for unrelated reasons (a decoy
    // database, or worse, a real Neon/Vercel database from an inherited
    // .env.local); every store call made through this shim must go to the
    // disposable contract container regardless of what POSTGRES_URL holds.
    const connectionString = process.env.PG_CONTRACT_URL;
    if (!connectionString) {
      throw new Error('vercel-postgres-pg-shim: PG_CONTRACT_URL is not set');
    }
    pool = new Pool({ connectionString });
  }
  return pool;
}

function toParamText(strings, values) {
  let text = '';
  strings.forEach((chunk, i) => {
    text += chunk;
    if (i < values.length) text += `$${i + 1}`;
  });
  return text;
}

async function sql(strings, ...values) {
  const text = toParamText(strings, values);
  return getPool().query(text, values);
}

sql.query = async function query(text, params) {
  return getPool().query(text, params || []);
};

const db = {
  async connect() {
    return getPool().connect();
  },
};

module.exports = { sql, db, getPool };
